import { BLOCK_TYPES, CACHE_STATE, DEFAULT_SETTINGS, MESSAGES, STORAGE_KEYS } from "./constants.js";
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
    tileSize: document.getElementById("tile-size"),
    showHeader: document.getElementById("show-header"),
    showFooter: document.getElementById("show-footer"),
    filters: document.querySelectorAll("input[name='filters']"),
    themeRadios: document.querySelectorAll("input[name='theme']"),
    cacheInfo: document.getElementById("cache-info"),
    testButton: document.getElementById("test-sources"),
    refreshButton: document.getElementById("refresh-sources")
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
    elements.channelSlugs.value = state.settings.channelSlugs.join(", ");
    elements.blockIds.value = state.settings.blockIds.join(", ");
    elements.blockCount.value = state.settings.blockCount;
    elements.tileSize.value = state.settings.tileSize;
    elements.showHeader.checked = state.settings.showHeader;
    elements.showFooter.checked = state.settings.showFooter;

    const selectedFilters = new Set(state.settings.filters);
    elements.filters.forEach((checkbox) => {
        checkbox.checked = selectedFilters.has(checkbox.value) || (!selectedFilters.size && BLOCK_TYPES.includes(checkbox.value));
    });

    elements.themeRadios.forEach((radio) => {
        radio.checked = radio.value === state.settings.theme;
    });
}

function wireEvents() {
    elements.form?.addEventListener("submit", handleSubmit);
    elements.form?.addEventListener("reset", handleReset);
    elements.themeRadios?.forEach((radio) => {
        radio.addEventListener("change", (event) => {
            if (event.target.checked) {
                state.settings.theme = event.target.value;
                updateTheme();
            }
        });
    });
    elements.testButton?.addEventListener("click", handleTestSources);
    elements.refreshButton?.addEventListener("click", handleRefreshClick);

    if (runtime?.onMessage) {
        runtime.onMessage.addListener(handleRuntimeMessage);
    }
    if (storage?.onChanged) {
        storage.onChanged.addListener(handleStorageChange);
    }
}

function gatherFormSettings() {
    const channelSlugs = parseChannelSlugs(elements.channelSlugs.value);
    const blockIds = parseBlockIds(elements.blockIds.value);
    let blockCount = Number(elements.blockCount.value) || DEFAULT_SETTINGS.blockCount;
    blockCount = Math.min(6, Math.max(1, blockCount));
    const showHeader = elements.showHeader.checked;
    const showFooter = elements.showFooter.checked;
    const tileSize = elements.tileSize?.value || DEFAULT_SETTINGS.tileSize;
    let filters = Array.from(document.querySelectorAll("input[name='filters']:checked"), (input) => input.value);
    if (!filters.length) {
        filters = [...BLOCK_TYPES];
    }
    const themeRadio = document.querySelector("input[name='theme']:checked");
    const theme = themeRadio ? themeRadio.value : DEFAULT_SETTINGS.theme;

    return { channelSlugs, blockIds, blockCount, showHeader, showFooter, filters, theme, tileSize };
}

async function handleSubmit(event) {
    event.preventDefault();
    if (state.working) {
        return;
    }
    const nextSettings = gatherFormSettings();
    updateWorking(true, "Saving settings...");
    try {
        const saved = await saveSettings(nextSettings);
        state.settings = saved;
        updateTheme();
        showStatus("Settings saved. Refreshing cache...");
        const response = await requestCacheRefresh({ reason: "settings-save" });
        if (response?.ok) {
            const count = response.summary?.blockCount || 0;
            showStatus(`Cache updated with ${count} block${count === 1 ? "" : "s"}.`);
        } else if (response?.error) {
            showStatus(`Cache refresh reported: ${response.error}`);
        }
    } catch (error) {
        console.error("Failed to save settings", error);
        showStatus(`Save failed: ${error.message}`);
    } finally {
        updateWorking(false);
    }
}

function handleReset(event) {
    event.preventDefault();
    populateForm();
    updateTheme();
    updateCacheInfo();
    showStatus("Reset to stored settings");
}

async function handleTestSources() {
    if (state.working) {
        return;
    }
    const snapshot = gatherFormSettings();
    updateWorking(true, "Testing sources...");
    try {
        const result = await requestCacheRefresh({ reason: "test", testOnly: true, settingsOverride: snapshot });
        if (result?.ok) {
            const count = result.summary?.blockCount || 0;
            showStatus(`Test succeeded. ${count} block${count === 1 ? "" : "s"} found.`);
        } else {
            showStatus("Test completed.");
        }
    } catch (error) {
        console.error("Test failed", error);
        showStatus(`Test failed: ${error.message}`);
    } finally {
        updateWorking(false);
    }
}

async function handleRefreshClick() {
    if (state.working) {
        return;
    }
    updateWorking(true, "Refreshing cache...");
    try {
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
    if (elements.testButton) {
        elements.testButton.disabled = isWorking;
    }
    if (elements.refreshButton) {
        elements.refreshButton.disabled = isWorking;
    }
    if (elements.form) {
        elements.form.querySelectorAll("button, input, textarea, select").forEach((node) => {
            if (node.dataset.persistent === "true") {
                return;
            }
            if (isWorking) {
                node.setAttribute("data-prev-disabled", node.disabled ? "1" : "0");
                if (node.type !== "submit" && node !== elements.testButton && node !== elements.refreshButton) {
                    node.disabled = true;
                }
            } else {
                if (node.hasAttribute("data-prev-disabled")) {
                    const wasDisabled = node.getAttribute("data-prev-disabled") === "1";
                    node.disabled = wasDisabled;
                    node.removeAttribute("data-prev-disabled");
                } else if (node !== elements.testButton && node !== elements.refreshButton) {
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

init();