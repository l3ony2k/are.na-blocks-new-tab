import { BLOCK_TYPES, CACHE_STATE, DEFAULT_SETTINGS, MESSAGES, STORAGE_KEYS, TILE_SIZE_OPTIONS } from "./constants.js";
import { runtime, storage } from "./extension-api.js";
import { getCache, getSettings, parseBlockIds, parseChannelSlugs, saveSettings } from "./storage.js";
import { applyTheme } from "./theme.js";
import { formatRelativeTime } from "./time.js";

const state = {
    settings: { ...DEFAULT_SETTINGS },
    cache: null,
    cacheMeta: {
        state: CACHE_STATE.idle,
        lastUpdated: 0,
        lastError: null
    },
    working: false
};

const elements = {
    form: document.getElementById("settings-form"),
    channelSlugs: document.getElementById("channel-slugs"),
    blockIds: document.getElementById("block-ids"),
    blockCount: document.getElementById("block-count"),
    blockCountOutput: document.getElementById("block-count-output"),
    tileSize: document.getElementById("tile-size"),
    tileSizeOutput: document.getElementById("tile-size-output"),
    showHeader: document.getElementById("show-header"),
    showFooter: document.getElementById("show-footer"),
    filters: document.querySelectorAll("input[name='filters']"),
    themeRadios: document.querySelectorAll("input[name='theme']"),
    cacheInfo: document.getElementById("cache-info"),
    sourcesSaveButton: document.getElementById("save-refresh"),
    displaySaveButton: document.getElementById("save-display")
};

const TILE_SIZE_LABEL_MAP = {
    auto: "Auto",
    xs: "Extra small",
    s: "Small",
    m: "Medium",
    l: "Large",
    xl: "Extra large"
};

async function init() {
    try {
        await hydrateState();
        populateForm();
        updateTheme();
        updateCacheInfo();
        wireEvents();
    } catch (error) {
        console.error("Failed to init settings", error);
        showStatus(`Error: ${error.message}`);
    }
}

async function hydrateState() {
    state.settings = await getSettings();
    const { cache, meta } = await getCache();
    state.cache = cache;
    state.cacheMeta = { ...state.cacheMeta, ...meta, lastUpdated: meta.lastUpdated || cache.fetchedAt || 0 };
}

function populateForm() {
    if (elements.channelSlugs) {
        elements.channelSlugs.value = state.settings.channelSlugs.join(", ");
    }
    if (elements.blockIds) {
        elements.blockIds.value = state.settings.blockIds.join(", ");
    }
    if (elements.blockCount) {
        elements.blockCount.value = String(state.settings.blockCount);
        updateBlockCountOutput();
    }
    if (elements.tileSize) {
        const tileIndex = Math.max(0, TILE_SIZE_OPTIONS.indexOf(state.settings.tileSize));
        elements.tileSize.value = String(tileIndex);
        updateTileSizeOutput();
    }
    if (elements.showHeader) {
        elements.showHeader.checked = state.settings.showHeader;
    }
    if (elements.showFooter) {
        elements.showFooter.checked = state.settings.showFooter;
    }

    const selectedFilters = new Set(state.settings.filters);
    elements.filters.forEach((checkbox) => {
        checkbox.checked = selectedFilters.has(checkbox.value) || (!selectedFilters.size && BLOCK_TYPES.includes(checkbox.value));
    });

    elements.themeRadios.forEach((radio) => {
        radio.checked = radio.value === state.settings.theme;
    });
}

function wireEvents() {
    elements.form?.addEventListener("reset", handleReset);
    elements.blockCount?.addEventListener("input", updateBlockCountOutput);
    elements.tileSize?.addEventListener("input", updateTileSizeOutput);
    elements.themeRadios?.forEach((radio) => {
        radio.addEventListener("change", (event) => {
            if (event.target.checked) {
                state.settings.theme = event.target.value;
                updateTheme();
            }
        });
    });
    elements.sourcesSaveButton?.addEventListener("click", handleSourcesSave);
    elements.displaySaveButton?.addEventListener("click", handleDisplaySave);

    if (runtime?.onMessage) {
        runtime.onMessage.addListener(handleRuntimeMessage);
    }
    if (storage?.onChanged) {
        storage.onChanged.addListener(handleStorageChange);
    }
}

const gatherSourceSettings = () => {
    const filters = Array.from(document.querySelectorAll("input[name='filters']:checked"), input => input.value);
    return {
        channelSlugs: parseChannelSlugs(elements.channelSlugs?.value || ""),
        blockIds: parseBlockIds(elements.blockIds?.value || ""),
        filters: filters.length ? filters : [...BLOCK_TYPES]
    };
};

const gatherDisplaySettings = () => {
    const blockCount = Math.min(6, Math.max(1, Number(elements.blockCount?.value || DEFAULT_SETTINGS.blockCount)));
    const tileIndex = Number(elements.tileSize?.value || 0);
    const themeRadio = document.querySelector("input[name='theme']:checked");
    
    return {
        blockCount,
        showHeader: Boolean(elements.showHeader?.checked),
        showFooter: Boolean(elements.showFooter?.checked),
        tileSize: TILE_SIZE_OPTIONS[tileIndex] || DEFAULT_SETTINGS.tileSize,
        theme: themeRadio?.value || DEFAULT_SETTINGS.theme
    };
};

const gatherFormSettings = () => ({
    ...gatherSourceSettings(),
    ...gatherDisplaySettings()
});

async function handleDisplaySave(event) {
    event.preventDefault();
    if (state.working) {
        return;
    }
    const displaySettings = gatherDisplaySettings();
    const nextSettings = { ...state.settings, ...displaySettings };
    if (settingsEqual(nextSettings, state.settings)) {
        showStatus("Display settings are already saved.");
        return;
    }
    updateWorking(true, "Saving display settings...");
    try {
        const saved = await saveSettings(nextSettings);
        state.settings = saved;
        updateTheme();
        updateCacheInfo();
        showStatus("Display settings saved.");
    } catch (error) {
        console.error("Failed to save settings", error);
        showStatus(`Save failed: ${error.message}`);
    } finally {
        updateWorking(false);
    }
}

function handleReset(event) {
    event.preventDefault();
    state.settings = { ...DEFAULT_SETTINGS };
    populateForm();
    updateTheme();
    updateCacheInfo();
    showStatus("Reset to default settings. Save to apply.");
}

async function handleSourcesSave(event) {
    event?.preventDefault?.();
    if (state.working) {
        return;
    }
    const formValues = gatherFormSettings();
    const snapshot = { ...state.settings, ...formValues };
    const settingsChanged = !settingsEqual(snapshot, state.settings);
    updateWorking(true, settingsChanged ? "Saving content settings..." : "Refreshing cache...");
    try {
        if (settingsChanged) {
            const saved = await saveSettings(snapshot);
            state.settings = saved;
            updateTheme();
            updateCacheInfo();
            showStatus("Content settings saved. Refreshing cache...");
        } else {
            showStatus("Refreshing cache...");
        }
        const response = await requestCacheRefresh({ reason: "manual" });
        if (response?.ok) {
            const count = response.summary?.blockCount || 0;
            showStatus(`Cache refreshed with ${count} block${count === 1 ? "" : "s"}.`);
        } else if (response?.error) {
            showStatus(`Refresh reported: ${response.error}`);
        }
    } catch (error) {
        console.error("Refresh failed", error);
        showStatus(`Refresh failed: ${error.message}`);
    } finally {
        updateWorking(false);
    }
}

function updateTheme() {
    applyTheme(state.settings.theme);
}

function updateWorking(isWorking, message) {
    state.working = isWorking;
    if (elements.form) {
        elements.form.querySelectorAll("button, input, textarea, select").forEach((node) => {
            if (node.dataset.persistent === "true") {
                return;
            }
            if (isWorking) {
                node.setAttribute("data-prev-disabled", node.disabled ? "1" : "0");
                node.disabled = true;
            } else {
                if (node.hasAttribute("data-prev-disabled")) {
                    const wasDisabled = node.getAttribute("data-prev-disabled") === "1";
                    node.disabled = wasDisabled;
                    node.removeAttribute("data-prev-disabled");
                } else {
                    node.disabled = false;
                }
            }
        });
    }
    if (message) {
        showStatus(message);
    }
}

async function requestCacheRefresh(payload = {}) {
    if (!runtime?.sendMessage) {
        throw new Error("Background messaging unavailable");
    }
    const response = await runtime.sendMessage({
        type: MESSAGES.refreshCache,
        payload
    });
    return response;
}

function updateCacheInfo() {
    if (!elements.cacheInfo) {
        return;
    }
    const { cache } = state;
    const blockTotal = cache?.blockIds?.length || 0;
    const timestamp = state.cacheMeta.lastUpdated;
    if (state.cacheMeta.state === CACHE_STATE.working) {
        elements.cacheInfo.textContent = "Cache refresh in progress...";
    } else if (state.cacheMeta.state === CACHE_STATE.error) {
        elements.cacheInfo.textContent = state.cacheMeta.lastError || "Cache error";
    } else if (blockTotal) {
        const relative = formatRelativeTime(timestamp);
        elements.cacheInfo.textContent = `${blockTotal} cached block${blockTotal === 1 ? "" : "s"} · updated ${relative}`;
    } else {
        elements.cacheInfo.textContent = "No cached blocks yet.";
    }
}

function showStatus(message) {
    if (elements.cacheInfo) {
        elements.cacheInfo.textContent = message;
    }
}

function handleRuntimeMessage(message) {
    if (message?.type === MESSAGES.cacheStatus) {
        state.cacheMeta = { ...state.cacheMeta, ...message.payload };
        updateCacheInfo();
    }
    return false;
}

function handleStorageChange(changes, area) {
    if (area !== "local") {
        return;
    }
    if (changes[STORAGE_KEYS.cache] || changes[STORAGE_KEYS.cacheMeta]) {
        getCache().then(({ cache, meta }) => {
            state.cache = cache;
            state.cacheMeta = { ...state.cacheMeta, ...meta, lastUpdated: meta.lastUpdated || cache.fetchedAt || state.cacheMeta.lastUpdated };
            updateCacheInfo();
        });
    }
    if (changes[STORAGE_KEYS.settings]) {
        getSettings().then((settings) => {
            state.settings = settings;
            populateForm();
            updateTheme();
            updateCacheInfo();
        });
    }
}

function updateBlockCountOutput() {
    if (!elements.blockCountOutput || !elements.blockCount) {
        return;
    }
    elements.blockCountOutput.textContent = elements.blockCount.value;
}

function updateTileSizeOutput() {
    if (!elements.tileSizeOutput || !elements.tileSize) {
        return;
    }
    const index = Number(elements.tileSize.value || 0);
    const label = TILE_SIZE_OPTIONS[index] || TILE_SIZE_OPTIONS[0];
    const displayLabel = label === "auto" ? "AUTO" : label.toUpperCase();
    const ariaLabel = TILE_SIZE_LABEL_MAP[label] || label.toUpperCase();
    elements.tileSizeOutput.textContent = displayLabel;
    elements.tileSize.setAttribute("aria-valuetext", ariaLabel);
}

function settingsEqual(next, current) {
    if (!current) {
        return false;
    }
    return (
        arraysEqual(next.channelSlugs, current.channelSlugs) &&
        arraysEqual(next.blockIds, current.blockIds) &&
        arraysEqual(next.filters, current.filters) &&
        next.blockCount === current.blockCount &&
        next.showHeader === current.showHeader &&
        next.showFooter === current.showFooter &&
        next.theme === current.theme &&
        next.tileSize === current.tileSize
    );
}

function arraysEqual(a = [], b = []) {
    if (a.length !== b.length) {
        return false;
    }
    return a.every((value, index) => value === b[index]);
}

init();
