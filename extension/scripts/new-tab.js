import { CACHE_STATE, MESSAGES, STORAGE_KEYS, TILE_SIZE_OPTIONS } from "./constants.js";
import { formatRelativeTime, formatExactDate } from "./time.js";
import { bookmarks, runtime, storage } from "./extension-api.js";
import { chooseRandomBlocks } from "./arena.js";
import { getCache, getSettings } from "./storage.js";
import { applyTheme } from "./theme.js";
import { toPlainText } from "./sanitize.js";

const TILE_SIZE_MAP = {
    xs: 225,
    s: 260,
    m: 310,
    l: 360,
    xl: 420
};

const AUTO_TILE_SIZES = [420, 360, 320, 300, 260, 225];
const TILE_GAP = 18;
const INFO_HEIGHT = 150;
const RESIZE_DEBOUNCE = 150;
const BOOKMARK_MENU_OFFSET = 4;
const BOOKMARK_SUBMENU_OFFSET = 6;
const BOOKMARK_OVERFLOW_TOLERANCE = 2;
const CACHE_STALE_THRESHOLD = 60 * 60 * 1000;

const state = {
    settings: null,
    cache: null,
    cacheMeta: {
        state: CACHE_STATE.idle,
        lastUpdated: 0,
        lastError: null,
        blockCount: 0
    },
    currentBlocks: [],
    bootstrapAttempted: false
};

const elements = {
    contentArea: document.getElementById("content-area"),
    header: document.getElementById("header-bar"),
    footer: document.getElementById("footer-bar"),
    bookmarkStrip: document.getElementById("bookmark-strip"),
    blocksContainer: document.getElementById("blocks-container"),
    cacheButton: document.getElementById("cache-status-button"),
    cacheLabel: document.getElementById("cache-label"),
    blockTemplate: document.getElementById("block-card-template"),
    emptyTemplate: document.querySelector("[data-empty-state]"),
    bookmarkEmptyTemplate: document.getElementById("bookmark-empty-template"),
    bookmarkMenuLayer: document.getElementById("bookmark-menu-layer")
};

let resizeTimer = null;
const openBookmarkFolders = new Set();
let cacheRefreshPromise = null;

function setMenuLayerActive(isActive) {
    const layer = elements.bookmarkMenuLayer;
    if (!layer) {
        return;
    }
    layer.setAttribute("aria-hidden", isActive ? "false" : "true");
    layer.style.pointerEvents = isActive ? "auto" : "none";
}

function positionRootMenu(menu, trigger) {
    if (!menu || !trigger) {
        return;
    }
    const rect = trigger.getBoundingClientRect();
    menu.style.maxHeight = "";
    menu.style.overflowY = "visible";
    menu.style.width = "auto";

    const menuWidth = menu.offsetWidth || 0;
    const menuHeight = menu.offsetHeight || 0;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxWidth = Math.max(8, viewportWidth - 16);
    const maxHeight = Math.max(8, viewportHeight - 16);

    const desiredLeft = rect.left;
    const desiredTop = rect.bottom + BOOKMARK_MENU_OFFSET;

    const clampedLeft = Math.min(Math.max(8, desiredLeft), Math.max(8, viewportWidth - menuWidth - 8));
    const clampedTop = Math.min(Math.max(8, desiredTop), Math.max(8, viewportHeight - menuHeight - 8));

    menu.style.left = `${Math.round(clampedLeft)}px`;
    menu.style.top = `${Math.round(clampedTop)}px`;

    menu.style.maxHeight = `${maxHeight}px`;
    menu.style.overflowY = "auto";
    const targetWidth = Math.min(menuWidth || 200, maxWidth);
    menu.style.width = `${targetWidth}px`;
}

function positionSubMenu(menu, trigger) {
    if (!menu || !trigger) {
        return;
    }
    menu.style.maxHeight = "";
    menu.style.overflowY = "visible";
    menu.style.width = "auto";

    const rect = trigger.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 0;
    const menuHeight = menu.offsetHeight || 0;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxWidth = Math.max(8, viewportWidth - 16);
    const maxHeight = Math.max(8, viewportHeight - 16);

    let desiredLeft = rect.right + BOOKMARK_SUBMENU_OFFSET;
    if (desiredLeft + menuWidth + 8 > viewportWidth) {
        desiredLeft = rect.left - menuWidth - BOOKMARK_SUBMENU_OFFSET;
    }

    const clampedLeft = Math.min(Math.max(8, desiredLeft), Math.max(8, viewportWidth - menuWidth - 8));

    let desiredTop = rect.top;
    if (desiredTop + menuHeight + 8 > viewportHeight) {
        desiredTop = viewportHeight - menuHeight - 8;
    }
    const clampedTop = Math.min(Math.max(8, desiredTop), Math.max(8, viewportHeight - menuHeight - 8));

    menu.style.left = `${Math.round(clampedLeft)}px`;
    menu.style.top = `${Math.round(clampedTop)}px`;

    const targetWidth = Math.min(menuWidth || 200, maxWidth);
    menu.style.width = `${targetWidth}px`;
    menu.style.maxHeight = `${maxHeight}px`;
    menu.style.overflowY = "auto";
}

function repositionOpenMenus() {
    if (!elements.bookmarkMenuLayer || !openBookmarkFolders.size) {
        return;
    }
    for (const controller of openBookmarkFolders) {
        if (typeof controller?.position === "function") {
            controller.position();
        } else if (controller?.menu && controller?.trigger) {
            positionRootMenu(controller.menu, controller.trigger);
        }
    }
}
async function init() {
    try {
        await hydrateState();
        wireEvents();
        await renderAll();
        await maybeBootstrapCache();
        await maybeRefreshStaleCache();
    } catch (error) {
        console.error("Failed to initialise new tab", error);
        renderError(error);
    }
}

async function hydrateState() {
    const { cache, meta } = await getCache();
    state.cache = cache;
    state.cacheMeta = { ...state.cacheMeta, ...meta };
    state.settings = await getSettings();
    applyTheme(state.settings.theme);
    toggleRegions();
}

async function maybeBootstrapCache() {
    if (state.bootstrapAttempted) {
        return;
    }
    state.bootstrapAttempted = true;

    if (!storage?.get || !runtime?.sendMessage) {
        return;
    }

    if (state.cache?.blockIds?.length) {
        try {
            await storage.set({
                [STORAGE_KEYS.bootstrap]: {
                    status: "complete",
                    timestamp: Date.now()
                }
            });
        } catch (_) {
            // ignore
        }
        return;
    }

    try {
        const record = await storage.get(STORAGE_KEYS.bootstrap);
        const previous = record?.[STORAGE_KEYS.bootstrap];
        const status = typeof previous === "string" ? previous : previous?.status;
        if (status === "pending") {
            return;
        }
        if (status === "complete") {
            return;
        }

        await storage.set({
            [STORAGE_KEYS.bootstrap]: {
                status: "pending",
                timestamp: Date.now()
            }
        });

        const success = await triggerCacheRefresh("bootstrap");
        if (success) {
            await storage.set({
                [STORAGE_KEYS.bootstrap]: {
                    status: "complete",
                    timestamp: Date.now()
                }
            });
        } else {
            await storage.set({
                [STORAGE_KEYS.bootstrap]: {
                    status: "error",
                    timestamp: Date.now()
                }
            });
        }
    } catch (error) {
        console.warn("Bootstrap cache request failed", error);
        try {
            await storage.remove([STORAGE_KEYS.bootstrap]);
        } catch (_) {
            // ignore cleanup errors
        }
    }
}

async function maybeRefreshStaleCache() {
    if (state.cacheMeta.state === CACHE_STATE.working || cacheRefreshPromise) {
        return;
    }
    const timestamp = state.cacheMeta.lastUpdated || state.cache?.fetchedAt || 0;
    if (!timestamp) {
        return;
    }
    if (Date.now() - timestamp < CACHE_STALE_THRESHOLD) {
        return;
    }
    await triggerCacheRefresh("stale");
}

function wireEvents() {
    if (storage?.onChanged) {
        storage.onChanged.addListener(handleStorageChange);
    }
    if (runtime?.onMessage) {
        runtime.onMessage.addListener(handleRuntimeMessage);
    }
    window.addEventListener("resize", handleResize, { passive: true });
    window.addEventListener("scroll", handleScroll, { passive: true });
    if (elements.bookmarkStrip) {
        elements.bookmarkStrip.addEventListener("wheel", handleBookmarkWheel, { passive: false });
    }
    elements.cacheButton?.addEventListener("click", handleCacheButtonClick);
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("keydown", handleDocumentKeyDown);
}

async function renderAll() {
    await renderBookmarks();
    renderBlocks();
    updateCacheStatus();
}

function toggleRegions() {
    const showHeader = Boolean(state.settings?.showHeader);
    const showFooter = Boolean(state.settings?.showFooter);
    if (elements.header) {
        elements.header.hidden = !showHeader;
    }
    if (elements.footer) {
        elements.footer.hidden = !showFooter;
    }
}

async function renderBookmarks() {
    const strip = elements.bookmarkStrip;
    if (!strip) {
        return;
    }
    closeAllBookmarkFolders();
    openBookmarkFolders.clear();
    if (elements.bookmarkMenuLayer) {
        elements.bookmarkMenuLayer.innerHTML = "";
        setMenuLayerActive(false);
    }
    strip.textContent = "";
    strip.classList.remove("scrolling");
    strip.classList.remove("has-overflow");
    strip.dataset.hasOverflow = "false";
    if (!state.settings?.showHeader) {
        return;
    }
    if (!bookmarks) {
        strip.textContent = "Bookmarks unavailable";
        return;
    }
    try {
        strip.dataset.state = "loading";
        const tree = await bookmarks.getTree();
        const rootChildren = tree[0]?.children || [];
        const bar = rootChildren.find((node) => node.id === "1" || (node.title && node.title.toLowerCase().includes("bookmark")));
        const nodes = (bar?.children || rootChildren || []).filter(Boolean);
        const fragment = document.createDocumentFragment();
        for (const node of nodes) {
            if (node.type === "separator") {
                continue;
            }
            if (node.url) {
                fragment.appendChild(createBookmarkLink(node));
            } else if (node.children?.length) {
                fragment.appendChild(createBookmarkFolder(node));
            }
        }
        if (!fragment.childElementCount) {
            const template = elements.bookmarkEmptyTemplate?.content?.cloneNode(true);
            if (template) {
                strip.appendChild(template);
            } else {
                strip.textContent = "No bookmarks";
            }
            return;
        }
        strip.appendChild(fragment);
        requestAnimationFrame(() => {
            applyBookmarkOverflow();
        });
    } catch (error) {
        console.error("Failed to load bookmarks", error);
        strip.textContent = "Bookmarks unavailable";
        strip.classList.remove("scrolling");
    } finally {
        strip.dataset.state = "ready";
    }
}

function createBookmarkLink(node, className = "bookmark-link") {
    const link = document.createElement("a");
    link.className = className;
    link.href = node.url;
    link.rel = "noopener";
    link.title = node.title || node.url;
    link.dataset.bookmarkItem = "true";
    link.__bookmarkNode = node;

    const favicon = document.createElement("img");
    favicon.className = "bookmark-favicon";
    favicon.alt = "";
    favicon.src = `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(node.url)}`;
    favicon.referrerPolicy = "no-referrer";
    favicon.decoding = "async";
    favicon.loading = "lazy";
    favicon.onerror = () => favicon.remove();

    const label = document.createElement("span");
    label.textContent = node.title || node.url;

    link.append(favicon, label);
    return link;
}

function createBookmarkFolder(node) {
    const container = document.createElement("div");
    container.className = "bookmark-folder";
    container.dataset.bookmarkItem = "true";
    container.__bookmarkNode = node;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "bookmark-trigger";
    trigger.title = node.title || "Folder";
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");
    trigger.textContent = node.title || "Folder";

    container.appendChild(trigger);

    const menu = buildBookmarkMenu(node.children || [], 0);
    if (!menu.childElementCount) {
        trigger.disabled = true;
        trigger.setAttribute("aria-disabled", "true");
        return container;
    }

    const menuId = `bookmark-menu-${node.id || Math.random().toString(36).slice(2)}`;
    menu.id = menuId;
    trigger.setAttribute("aria-controls", menuId);

    menu.hidden = true;
    menu.setAttribute("hidden", "");
    menu.setAttribute("aria-hidden", "true");

    const menuLayer = elements.bookmarkMenuLayer;
    if (menuLayer) {
        menuLayer.appendChild(menu);
    } else {
        container.appendChild(menu);
    }

    const controller = {
        trigger,
        menu,
        level: 0,
        isOpen: false,
        position() {
            positionRootMenu(menu, trigger);
        },
        close() {
            if (!controller.isOpen) {
                return;
            }
            closeBookmarkMenusFromLevel(controller.level + 1);
            trigger.setAttribute("aria-expanded", "false");
            container.classList.remove("is-open");
            menu.hidden = true;
            menu.setAttribute("hidden", "");
            menu.setAttribute("aria-hidden", "true");
            controller.isOpen = false;
            openBookmarkFolders.delete(controller);
            if (!openBookmarkFolders.size) {
                setMenuLayerActive(false);
            }
        },
        destroy() {
            controller.close();
            if (menu?.parentElement) {
                menu.parentElement.removeChild(menu);
            }
        }
    };

    container.__bookmarkController = controller;

    function focusFirstItem() {
        const firstItem = menu.querySelector("a, button");
        firstItem?.focus();
    }

    controller.open = (focusFirst = false) => {
        if (controller.isOpen) {
            controller.position();
            if (focusFirst) {
                focusFirstItem();
            }
            return;
        }
        closeAllBookmarkFolders(controller);
        container.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
        menu.hidden = false;
        menu.removeAttribute("hidden");
        menu.setAttribute("aria-hidden", "false");
        menu.scrollTop = 0;
        controller.isOpen = true;
        openBookmarkFolders.add(controller);
        if (menuLayer) {
            setMenuLayerActive(true);
            menuLayer.appendChild(menu);
            menu.style.zIndex = "30";
        }
        controller.position();
        if (focusFirst) {
            focusFirstItem();
        }
    };

    trigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (controller.isOpen) {
            controller.close();
        } else {
            controller.open();
        }
    });

    trigger.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            controller.open(true);
        } else if (event.key === "Escape") {
            event.preventDefault();
            controller.close();
            trigger.focus();
        }
    });

    return container;
}

function buildBookmarkMenu(nodes, level = 0) {
    const menu = document.createElement("ul");
    menu.className = level === 0 ? "bookmark-menu" : "bookmark-submenu";
    menu.dataset.level = String(level);
    menu.setAttribute("role", "menu");

    for (const child of nodes) {
        if (!child) {
            continue;
        }
        if (child.type === "separator") {
            const divider = document.createElement("li");
            divider.className = "bookmark-menu-divider";
            menu.appendChild(divider);
            continue;
        }
        if (child.url) {
            menu.appendChild(createBookmarkMenuLink(child));
        } else if (child.children?.length) {
            const folderItem = createBookmarkMenuFolder(child, level + 1);
            if (folderItem) {
                menu.appendChild(folderItem);
            }
        }
    }

    return menu;
}

function createBookmarkMenuLink(node) {
    const item = document.createElement("li");
    item.className = "bookmark-menu-item";
    const link = createBookmarkLink(node, "bookmark-menu-link");
    link.tabIndex = -1;
    item.appendChild(link);
    return item;
}

function createBookmarkMenuFolder(node, level) {
    const item = document.createElement("li");
    item.className = "bookmark-menu-item has-children";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "bookmark-menu-button";
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");
    const label = document.createElement("span");
    label.textContent = node.title || "Folder";
    const arrow = document.createElement("span");
    arrow.className = "bookmark-menu-arrow";
    arrow.textContent = "›";
    button.append(label, arrow);

    const submenu = buildBookmarkMenu(node.children || [], level);
    if (!submenu.childElementCount) {
        return null;
    }
    submenu.hidden = true;
    submenu.setAttribute("hidden", "");
    submenu.setAttribute("aria-hidden", "true");

    const submenuId = `bookmark-menu-${node.id || Math.random().toString(36).slice(2)}`;
    submenu.id = submenuId;
    button.setAttribute("aria-controls", submenuId);

    const menuLayer = elements.bookmarkMenuLayer;
    if (menuLayer) {
        menuLayer.appendChild(submenu);
    } else {
        item.appendChild(submenu);
    }

    function focusFirstItem() {
        const firstItem = submenu.querySelector("a, button");
        firstItem?.focus();
    }

    const controller = {
        trigger: button,
        menu: submenu,
        level,
        isOpen: false,
        position() {
            positionSubMenu(submenu, button);
        },
        close() {
            if (!controller.isOpen) {
                return;
            }
            item.classList.remove("submenu-open");
            button.setAttribute("aria-expanded", "false");
            submenu.hidden = true;
            submenu.setAttribute("hidden", "");
            submenu.setAttribute("aria-hidden", "true");
            controller.isOpen = false;
            closeBookmarkMenusFromLevel(controller.level + 1);
            openBookmarkFolders.delete(controller);
            if (!openBookmarkFolders.size) {
                setMenuLayerActive(false);
            }
        }
    };

    controller.open = (focusFirst = false) => {
        if (controller.isOpen) {
            controller.position();
            if (focusFirst) {
                focusFirstItem();
            }
            return;
        }
        closeBookmarkMenusFromLevel(level, controller);
        item.classList.add("submenu-open");
        button.setAttribute("aria-expanded", "true");
        submenu.hidden = false;
        submenu.removeAttribute("hidden");
        submenu.setAttribute("aria-hidden", "false");
        submenu.scrollTop = 0;
        controller.isOpen = true;
        openBookmarkFolders.add(controller);
        if (menuLayer) {
            menuLayer.appendChild(submenu);
            submenu.style.zIndex = String(30 + level);
        }
        controller.position();
        if (focusFirst) {
            focusFirstItem();
        }
    };

    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (controller.isOpen) {
            controller.close();
        } else {
            controller.open(true);
        }
    });

    button.addEventListener("pointerenter", () => {
        controller.open();
    });

    button.addEventListener("focus", () => {
        controller.open();
    });

    button.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight") {
            event.preventDefault();
            controller.open(true);
        } else if (event.key === "ArrowLeft" || event.key === "Escape") {
            event.preventDefault();
            controller.close();
            button.focus();
        }
    });

    item.appendChild(button);
    return item;
}

function cleanupBookmarkElement(element) {
    if (!element) {
        return;
    }
    const controller = element.__bookmarkController;
    if (controller) {
        controller.destroy();
    }
    if (element.parentElement) {
        element.parentElement.removeChild(element);
    }
}

function closeBookmarkMenusFromLevel(level, except) {
    if (!openBookmarkFolders.size) {
        return;
    }
    const controllers = Array.from(openBookmarkFolders);
    for (const controller of controllers) {
        if (controller === except) {
            continue;
        }
        const controllerLevel = controller?.level ?? 0;
        if (controllerLevel >= level) {
            controller.close();
        }
    }
}

function closeAllBookmarkFolders(except) {
    const controllers = Array.from(openBookmarkFolders);
    for (const controller of controllers) {
        if (controller !== except) {
            controller.close();
        }
    }
    if (!except) {
        openBookmarkFolders.clear();
    }
}

function handleDocumentPointerDown(event) {
    if (!openBookmarkFolders.size) {
        return;
    }
    if (!event.target.closest(".bookmark-folder, .bookmark-menu, .bookmark-submenu")) {
        closeAllBookmarkFolders();
    }
}

function handleDocumentKeyDown(event) {
    if (event.key === "Escape") {
        closeAllBookmarkFolders();
    }
}

function handleBookmarkWheel(event) {
    const strip = elements.bookmarkStrip;
    if (!strip || !strip.classList.contains("scrolling")) {
        return;
    }
    const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
            ? event.deltaX
            : event.deltaY;
    if (!delta) {
        return;
    }
    event.preventDefault();
    strip.scrollLeft += delta;
}

function handleCacheButtonClick(event) {
    event?.preventDefault?.();
    triggerCacheRefresh("manual");
}

function triggerCacheRefresh(reason = "manual") {
    if (!runtime?.sendMessage) {
        return Promise.resolve(false);
    }
    if (cacheRefreshPromise) {
        return cacheRefreshPromise;
    }
    state.cacheMeta = { ...state.cacheMeta, state: CACHE_STATE.working, lastError: null };
    updateCacheStatus();
    cacheRefreshPromise = (async () => {
        try {
            const response = await runtime.sendMessage({
                type: MESSAGES.refreshCache,
                payload: { reason }
            });
            if (response?.ok) {
                const fetchedAt = response.summary?.fetchedAt || Date.now();
                const blockCount = response.summary?.blockCount ?? state.cacheMeta.blockCount ?? 0;
                state.cacheMeta = {
                    ...state.cacheMeta,
                    state: CACHE_STATE.idle,
                    lastError: null,
                    lastUpdated: fetchedAt,
                    blockCount
                };
                updateCacheStatus();
                return true;
            }
            if (response?.error) {
                throw new Error(response.error);
            }
            state.cacheMeta = { ...state.cacheMeta, state: CACHE_STATE.idle };
            updateCacheStatus();
            return true;
        } catch (error) {
            state.cacheMeta = { ...state.cacheMeta, state: CACHE_STATE.error, lastError: error.message };
            updateCacheStatus();
            return false;
        } finally {
            cacheRefreshPromise = null;
        }
    })();
    return cacheRefreshPromise;
}

function getCacheSourceCounts() {
    const cache = state.cache || {};
    const sources = cache.sources || {};
    const blockCount =
        cache.blockIds?.length ??
        state.cacheMeta.blockCount ??
        0;
    const channelCount = Array.isArray(sources.channels)
        ? sources.channels.length
        : Array.isArray(state.settings?.channelSlugs)
        ? state.settings.channelSlugs.length
        : 0;
    const blockIdCount = Array.isArray(sources.blockIds)
        ? sources.blockIds.length
        : Array.isArray(state.settings?.blockIds)
        ? state.settings.blockIds.length
        : 0;
    return {
        blockCount,
        channelCount,
        blockIdCount
    };
}

function formatCount(value, singular, plural = `${singular}s`) {
    return `${value} ${value === 1 ? singular : plural}`;
}

function updateCacheSummaryTooltip() {
    const button = elements.cacheButton;
    if (!button) {
        return;
    }
    const { blockCount, channelCount, blockIdCount } = getCacheSourceCounts();
    let tooltip;
    if (!blockCount) {
        tooltip = "No cached blocks yet. Click to refresh cache.";
    } else {
        tooltip = `Randomly pick from ${formatCount(blockCount, "block")}, sources from ${formatCount(channelCount, "channel")} and ${formatCount(blockIdCount, "specific block", "specific blocks")}.\nClick to refresh cache.`;
    }
    button.title = tooltip;
    button.setAttribute("aria-label", tooltip.replace(/\n/g, " "));
}

function createOverflowButton(nodes) {
    if (!Array.isArray(nodes) || !nodes.length) {
        return null;
    }
    const overflowNode = {
        id: "bookmark-overflow",
        title: "⋯",
        children: nodes
    };
    const container = createBookmarkFolder(overflowNode);
    if (!container) {
        return null;
    }
    container.dataset.bookmarkOverflow = "true";
    container.dataset.bookmarkItem = "overflow";
    container.classList.add("bookmark-overflow");
    container.__bookmarkNode = overflowNode;
    const trigger = container.querySelector(".bookmark-trigger");
    if (trigger) {
        trigger.textContent = "⋯";
        trigger.setAttribute("aria-label", "More bookmarks");
        trigger.title = "More bookmarks";
        trigger.classList.add("bookmark-overflow-trigger");
    }
    return container;
}

function applyBookmarkOverflow() {
    const strip = elements.bookmarkStrip;
    if (!strip || !strip.childElementCount) {
        return;
    }

    const previousOverflow = Array.from(
        strip.querySelectorAll('[data-bookmark-overflow="true"]')
    );
    for (const element of previousOverflow) {
        cleanupBookmarkElement(element);
    }

    const items = Array.from(strip.children).filter(
        (child) => child?.dataset?.bookmarkItem === "true"
    );

    if (!items.length) {
        strip.dataset.hasOverflow = "false";
        return;
    }

    const availableWidth = strip.clientWidth || 0;
    if (!availableWidth) {
        strip.dataset.hasOverflow = "false";
        return;
    }

    const threshold = availableWidth - BOOKMARK_OVERFLOW_TOLERANCE;
    const hiddenNodes = [];

    const showItem = (item) => {
        item.classList.remove("bookmark-overflow-hidden");
        item.removeAttribute("aria-hidden");
    };

    const hideItem = (item, addToFront = false) => {
        if (!item || item.classList.contains("bookmark-overflow-hidden")) {
            return;
        }
        if (item.__bookmarkController) {
            item.__bookmarkController.close();
        }
        item.classList.add("bookmark-overflow-hidden");
        item.setAttribute("aria-hidden", "true");
        const data = item.__bookmarkNode;
        if (data) {
            if (addToFront) {
                hiddenNodes.unshift(data);
            } else {
                hiddenNodes.push(data);
            }
        }
    };

    for (const item of items) {
        showItem(item);
    }

    let cutoff = items.length;
    for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const rectRight = item.offsetLeft + item.offsetWidth;
        if (rectRight > threshold) {
            cutoff = i;
            break;
        }
    }

    if (cutoff < items.length) {
        for (let i = cutoff; i < items.length; i += 1) {
            hideItem(items[i]);
        }
    }

    let overflowContainer = null;

    if (hiddenNodes.length) {
        overflowContainer = createOverflowButton(hiddenNodes);
        if (overflowContainer) {
            strip.appendChild(overflowContainer);
            let index = cutoff - 1;
            while (
                overflowContainer.offsetLeft + overflowContainer.offsetWidth >
                    threshold &&
                index >= 0
            ) {
                const item = items[index];
                hideItem(item, true);
                index -= 1;
                cleanupBookmarkElement(overflowContainer);
                overflowContainer = createOverflowButton(hiddenNodes);
                if (!overflowContainer) {
                    break;
                }
                strip.appendChild(overflowContainer);
            }
        }
    }

    strip.dataset.hasOverflow = hiddenNodes.length ? "true" : "false";
    strip.classList.toggle("has-overflow", hiddenNodes.length > 0);
    if (openBookmarkFolders.size) {
        repositionOpenMenus();
    }
}

function renderBlocks() {
    const container = elements.blocksContainer;
    if (!container) {
        return;
    }

    container.innerHTML = "";

    if (!state.cache?.blockIds?.length) {
        state.currentBlocks = [];
        state.cacheMeta.blockCount = 0;
        showEmptyState();
        return;
    }

    const blockCount = Math.max(1, Number(state.settings?.blockCount) || 1);
    const blocks = chooseRandomBlocks(state.cache, blockCount);
    if (!blocks.length) {
        state.currentBlocks = [];
        showEmptyState();
        return;
    }

    state.currentBlocks = blocks;
    state.cacheMeta.blockCount = state.cache?.blockIds?.length ?? blocks.length;
    renderLayout(blocks);
}

function renderLayout(blocks) {
    const container = elements.blocksContainer;
    const contentArea = elements.contentArea;
    if (!container || !contentArea) {
        return;
    }

    if (!blocks || !blocks.length) {
        state.currentBlocks = [];
        showEmptyState();
        return;
    }

    container.classList.remove("is-empty");
    container.innerHTML = "";

    const viewport = getViewport();
    const { tileSize, layout } = determineLayout(blocks.length, viewport);

    container.style.setProperty("--tile-size", `${tileSize}px`);
    container.style.setProperty("--tile-gap", `${TILE_GAP}px`);
    const isCompact = tileSize <= TILE_SIZE_MAP.s;
    container.style.setProperty("--block-title-size", isCompact ? "0.9rem" : "1rem");
    container.style.setProperty("--block-meta-size", isCompact ? "0.6rem" : "0.7rem");

    let index = 0;
    layout.rows.forEach((columns) => {
        const row = document.createElement("div");
        row.className = "block-row";
        row.dataset.columns = String(columns);
        for (let i = 0; i < columns && index < blocks.length; i += 1) {
            row.appendChild(renderBlockCard(blocks[index]));
            index += 1;
        }
        container.appendChild(row);
    });

    while (index < blocks.length) {
        const fallbackRow = document.createElement("div");
        fallbackRow.className = "block-row";
        fallbackRow.dataset.columns = "1";
        fallbackRow.appendChild(renderBlockCard(blocks[index]));
        container.appendChild(fallbackRow);
        index += 1;
    }

    requestAnimationFrame(() => applyOverflowStates(layout));
    updateCacheStatus();
}

function determineLayout(count, viewport) {
    const requested = state.settings?.tileSize && TILE_SIZE_OPTIONS.includes(state.settings.tileSize)
        ? state.settings.tileSize
        : "auto";

    if (requested !== "auto") {
        const baseSize = TILE_SIZE_MAP[requested] || TILE_SIZE_MAP.m;
        const tileSize = clampTileSize(baseSize, viewport);
        const layout = chooseLayout(count, viewport, tileSize);
        return { tileSize, layout };
    }

    for (const candidate of AUTO_TILE_SIZES) {
        const tileSize = clampTileSize(candidate, viewport);
        const layout = chooseLayout(count, viewport, tileSize);
        if (layout.fitsWidth && layout.fitsHeight) {
            return { tileSize, layout };
        }
    }

    const fallbackSize = clampTileSize(AUTO_TILE_SIZES[AUTO_TILE_SIZES.length - 1], viewport);
    return { tileSize: fallbackSize, layout: chooseLayout(count, viewport, fallbackSize) };
}

function chooseLayout(count, viewport, tileSize) {
    if (count <= 0) {
        return { rows: [], requiredWidth: 0, requiredHeight: 0, fitsWidth: true, fitsHeight: true };
    }

    const widthFor = (cols) => cols * tileSize + (cols - 1) * TILE_GAP;
    const heightForRows = (rows) => rows * (tileSize + INFO_HEIGHT) + (rows - 1) * TILE_GAP;

    const fitsColumns = (cols) => widthFor(cols) <= viewport.width;
    const fitsRows = (rows) => heightForRows(rows) <= viewport.height;

    const ratio = viewport.width / Math.max(viewport.height, 1);
    const superThin = viewport.width < widthFor(2);
    const superWide = viewport.height < heightForRows(2);

    let rows;

    switch (count) {
        case 1:
            rows = [1];
            break;
        case 2:
            rows = (ratio >= 1 && fitsColumns(2)) ? [2] : [1, 1];
            break;
        case 3:
            if (ratio >= 1 && fitsColumns(3)) {
                rows = [3];
            } else if (ratio >= 1 && fitsColumns(2)) {
                rows = [2, 1];
            } else {
                rows = [1, 1, 1];
            }
            break;
        case 4:
            if (superThin) {
                rows = [1, 1, 1, 1];
            } else if (superWide && fitsColumns(4)) {
                rows = [4];
            } else if (fitsColumns(2) && fitsRows(2)) {
                rows = [2, 2];
            } else if (fitsColumns(2)) {
                rows = [2, 1, 1];
            } else {
                rows = [1, 1, 1, 1];
            }
            break;
        case 5:
            if (superThin) {
                rows = [1, 1, 1, 1, 1];
            } else if (superWide && fitsColumns(5)) {
                rows = [5];
            } else if (fitsColumns(2) && !fitsColumns(3)) {
                rows = [2, 2, 1];
            } else if (fitsColumns(3) && fitsRows(2)) {
                rows = [3, 2];
            } else if (fitsColumns(3) && fitsRows(3)) {
                rows = [2, 2, 1];
            } else if (fitsColumns(2)) {
                rows = [2, 2, 1];
            } else {
                rows = [1, 1, 1, 1, 1];
            }
            break;
        case 6:
            if (superThin) {
                rows = [1, 1, 1, 1, 1, 1];
            } else if (superWide && fitsColumns(6)) {
                rows = [6];
            } else {
                const canThreeCols = fitsColumns(3);
                const canTwoCols = fitsColumns(2);
                const preferWide = ratio >= 1;
                if (canThreeCols && preferWide && fitsRows(2)) {
                    rows = [3, 3];
                } else if (canThreeCols && !canTwoCols && fitsRows(2)) {
                    rows = [3, 3];
                } else if (canTwoCols && fitsRows(3)) {
                    rows = [2, 2, 2];
                } else if (canThreeCols) {
                    rows = [3, 3];
                } else if (canTwoCols) {
                    rows = [2, 2, 2];
                } else {
                    rows = [1, 1, 1, 1, 1, 1];
                }
            }
            break;
        default:
            rows = Array.from({ length: count }, () => 1);
            break;
    }

    const rowWidths = rows.map((cols) => widthFor(cols));
    const requiredWidth = Math.max(...rowWidths);
    const requiredHeight = heightForRows(rows.length);

    return {
        rows,
        requiredWidth,
        requiredHeight,
        fitsWidth: requiredWidth <= viewport.width,
        fitsHeight: requiredHeight <= viewport.height
    };
}

function clampTileSize(size, viewport) {
    const maxWidth = Math.max(120, viewport.width - 32);
    const maxHeight = Math.max(120, viewport.height - INFO_HEIGHT - 48);
    const limited = Math.min(size, maxWidth, maxHeight);
    return Math.max(120, Math.floor(limited));
}

function getViewport() {
    const area = elements.contentArea;
    if (!area) {
        return { width: window.innerWidth, height: window.innerHeight };
    }
    const width = area.clientWidth || window.innerWidth;
    const height = area.clientHeight || window.innerHeight;
    return { width, height };
}

function applyOverflowStates(layout) {
    const contentArea = elements.contentArea;
    const container = elements.blocksContainer;
    if (!contentArea || !container) {
        return;
    }

    const containerRect = container.getBoundingClientRect();
    const areaHeight = contentArea.clientHeight;
    const areaWidth = contentArea.clientWidth;

    const verticalOverflow = containerRect.height > areaHeight + 1;
    const horizontalOverflow = containerRect.width > areaWidth + 1;

    contentArea.classList.toggle("is-scroll-y", verticalOverflow);
    contentArea.classList.toggle("is-scroll-x", horizontalOverflow);

    contentArea.style.overflowY = verticalOverflow ? "auto" : "hidden";
    contentArea.style.overflowX = horizontalOverflow ? "auto" : "hidden";

    if (!verticalOverflow) {
        contentArea.scrollTop = 0;
    }
    if (!horizontalOverflow) {
        contentArea.scrollLeft = 0;
    }
}

function showEmptyState() {
    state.currentBlocks = [];
    const container = elements.blocksContainer;
    const contentArea = elements.contentArea;
    if (!container || !contentArea) {
        return;
    }
    container.classList.add("is-empty");
    container.innerHTML = "";
    if (elements.emptyTemplate) {
        container.appendChild(elements.emptyTemplate.cloneNode(true));
    } else {
        const fallback = document.createElement("div");
        fallback.className = "block-empty";
        fallback.textContent = "No cached blocks yet. Configure sources in settings.";
        container.appendChild(fallback);
    }
    contentArea.classList.remove("is-scroll-y", "is-scroll-x");
    contentArea.style.overflow = "hidden";
    contentArea.style.overflowX = "hidden";
    contentArea.style.overflowY = "hidden";
    updateCacheStatus();
}

function renderBlockCard(block) {
    let article;
    if (elements.blockTemplate?.content) {
        const fragment = elements.blockTemplate.content.cloneNode(true);
        article = fragment.querySelector("article");
        populateCard(article, block);
    }
    if (!article) {
        article = buildFallbackCard(block);
    }
    return article;
}

function populateCard(article, block) {
    if (!article) {
        return;
    }
    article.dataset.blockId = block.id;
    const main = article.querySelector("[data-main]");
    const titleEl = article.querySelector(".block-title");
    const descriptionEl = article.querySelector(".block-description");
    const dateEl = article.querySelector(".block-date");
    const typeEl = article.querySelector(".block-type");
    const linkEl = article.querySelector(".block-link");

    if (main) {
        buildMainContent(main, block);
    }

    if (titleEl) {
        titleEl.textContent = block.title || `Block ${block.id}`;
    }

    if (descriptionEl) {
        const text = block.descriptionText?.trim();
        if (text) {
            descriptionEl.textContent = text;
            descriptionEl.classList.remove("is-empty");
        } else {
            descriptionEl.textContent = "";
            descriptionEl.classList.add("is-empty");
        }
    }

    if (dateEl) {
        dateEl.textContent = formatExactDate(block.createdAt) || "";
    }

    if (typeEl) {
        typeEl.textContent = block.type || "Block";
    }

    if (linkEl) {
        linkEl.href = `https://www.are.na/block/${block.id}`;
        linkEl.textContent = `#${block.id}`;
        linkEl.title = `Block ID ${block.id}, click to view on Are.na`;
    }
}

function buildFallbackCard(block) {
    const article = document.createElement("article");
    article.className = "block-card";

    const main = document.createElement("div");
    main.className = "block-main";
    main.dataset.main = "";
    article.appendChild(main);

    const info = document.createElement("div");
    info.className = "block-info";

    const titleEl = document.createElement("h2");
    titleEl.className = "block-title";
    info.appendChild(titleEl);

    const descriptionEl = document.createElement("p");
    descriptionEl.className = "block-description";
    info.appendChild(descriptionEl);

    const metaRow = document.createElement("div");
    metaRow.className = "block-meta-row";

    const dateEl = document.createElement("span");
    dateEl.className = "block-date";
    metaRow.appendChild(dateEl);

    const linkEl = document.createElement("a");
    linkEl.className = "block-link";
    linkEl.target = "_blank";
    linkEl.rel = "noopener";
    linkEl.textContent = "#block";
    metaRow.appendChild(linkEl);

    const typeEl = document.createElement("span");
    typeEl.className = "block-type";
    metaRow.appendChild(typeEl);

    info.appendChild(metaRow);
    article.appendChild(info);

    populateCard(article, block);
    return article;
}

function buildMainContent(container, block) {
    container.innerHTML = "";
    const type = block.type;

    if (type === "Image" && block.imageUrl) {
        const img = document.createElement("img");
        img.src = block.imageUrl;
        img.alt = block.descriptionText || block.title || "Are.na image";
        img.loading = "lazy";
        container.appendChild(img);
        return;
    }

    if (type === "Text") {
        const wrapper = document.createElement("div");
        wrapper.className = "text-tile";
        const content = document.createElement("span");
        content.className = "tile-text-content";
        const raw = block.contentHtml || block.descriptionHtml;
        const textContent = raw ? toPlainText(raw) : block.descriptionText || block.title || "Text";
        content.textContent = textContent.trim() || "Text";
        wrapper.appendChild(content);
        container.appendChild(wrapper);
        return;
    }

    if (type === "Link" && block.linkUrl) {
        container.appendChild(createChip(formatLinkLabel(block.linkUrl)));
        return;
    }

    if (type === "Attachment" && block.attachment?.url) {
        const name = block.attachment.fileName || block.title || "Attachment";
        container.appendChild(createChip(name));
        return;
    }

    if (type === "Embed") {
        const label = block.embed?.type || block.title || "Embed";
        container.appendChild(createChip(label));
        return;
    }

    if (type === "Channel" && block.channel?.title) {
        container.appendChild(createChip(block.channel.title));
        return;
    }

    const fallback = block.descriptionText || block.title || "Untitled";
    container.appendChild(createChip(fallback));
}

function createChip(label) {
    const chip = document.createElement("div");
    chip.className = "tile-chip";
    chip.textContent = label;
    return chip;
}

function formatLinkLabel(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname.replace(/^www\./i, "");
    } catch (_) {
        return url;
    }
}

function updateCacheStatus() {
    const label = elements.cacheLabel;
    const button = elements.cacheButton;
    if (button) {
        button.disabled = state.cacheMeta?.state === CACHE_STATE.working;
    }
    if (!label) {
        return;
    }

    const status = state.cacheMeta?.state || CACHE_STATE.idle;

    switch (status) {
        case CACHE_STATE.working:
            label.textContent = "Refreshing...";
            break;
        case CACHE_STATE.error:
            label.textContent = state.cacheMeta.lastError || "Cache error";
            break;
        default: {
            const timestamp = state.cacheMeta.lastUpdated || state.cache?.fetchedAt;
            const blockCount = state.cacheMeta.blockCount ?? state.cache?.blockIds?.length ?? 0;
            if (timestamp && blockCount) {
                label.textContent = `${blockCount} block${blockCount === 1 ? "" : "s"} - ${formatRelativeTime(timestamp)}`;
            } else if (timestamp) {
                label.textContent = `Cached ${formatRelativeTime(timestamp)}`;
            } else {
                label.textContent = "Cache idle";
            }
        }
    }
    updateCacheSummaryTooltip();
}

function handleStorageChange(changes, area) {
    if (area !== "local") {
        return;
    }
    if (changes[STORAGE_KEYS.settings]) {
        getSettings().then((settings) => {
            state.settings = settings;
            applyTheme(state.settings.theme);
            toggleRegions();
            if (state.currentBlocks.length) {
                renderLayout(state.currentBlocks);
            } else {
                renderBlocks();
            }
            renderBookmarks();
        });
    }
    if (changes[STORAGE_KEYS.cache] || changes[STORAGE_KEYS.cacheMeta]) {
        getCache().then(({ cache, meta }) => {
            state.cache = cache;
            state.cacheMeta = { ...state.cacheMeta, ...meta };
            if (!state.currentBlocks.length) {
                renderBlocks();
            }
            updateCacheStatus();
        });
    }
}

function handleRuntimeMessage(message) {
    if (message?.type === MESSAGES.cacheStatus) {
        state.cacheMeta = { ...state.cacheMeta, ...message.payload };
        updateCacheStatus();
    }
    return false;
}

function handleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (state.currentBlocks.length) {
            renderLayout(state.currentBlocks);
        }
        repositionOpenMenus();
        applyBookmarkOverflow();
    }, RESIZE_DEBOUNCE);
}

function handleScroll() {
    repositionOpenMenus();
}

function renderError(error) {
    state.currentBlocks = [];
    if (!elements.blocksContainer) {
        return;
    }
    elements.blocksContainer.classList.add("is-empty");
    const div = document.createElement("div");
    div.className = "block-empty";
    div.textContent = `Error: ${error.message}`;
    elements.blocksContainer.innerHTML = "";
    elements.blocksContainer.appendChild(div);
}

init();
