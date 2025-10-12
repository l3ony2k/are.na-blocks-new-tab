import { CACHE_STATE, MESSAGES, STORAGE_KEYS, TILE_SIZE_OPTIONS } from "./constants.js";
import { formatRelativeTime, formatExactDate } from "./time.js";
import { bookmarks, runtime, storage } from "./extension-api.js";
import { chooseRandomBlocks } from "./arena.js";
import { getCache, getSettings } from "./storage.js";
import { applyTheme } from "./theme.js";
import { toPlainText } from "./sanitize.js";

const TILE_SIZE_MAP = {
    xs: 180,
    s: 220,
    m: 260,
    l: 320,
    xl: 380
};

const AUTO_TILE_SIZES = [360, 320, 280, 240, 200, 180];
const TILE_GAP = 18;
const INFO_HEIGHT = 150;
const RESIZE_DEBOUNCE = 150;

const state = {
    settings: null,
    cache: null,
    cacheMeta: {
        state: CACHE_STATE.idle,
        lastUpdated: 0,
        lastError: null,
        blockCount: 0
    },
    currentBlocks: []
};

const elements = {
    contentArea: document.getElementById("content-area"),
    header: document.getElementById("header-bar"),
    footer: document.getElementById("footer-bar"),
    bookmarkStrip: document.getElementById("bookmark-strip"),
    blocksContainer: document.getElementById("blocks-container"),
    cacheLed: document.getElementById("cache-led"),
    cacheLabel: document.getElementById("cache-label"),
    blockTemplate: document.getElementById("block-card-template"),
    emptyTemplate: document.querySelector("[data-empty-state]"),
    bookmarkEmptyTemplate: document.getElementById("bookmark-empty-template")
};

let resizeTimer = null;
const openBookmarkFolders = new Set();

async function init() {
    try {
        await hydrateState();
        wireEvents();
        await renderAll();
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

function wireEvents() {
    if (storage?.onChanged) {
        storage.onChanged.addListener(handleStorageChange);
    }
    if (runtime?.onMessage) {
        runtime.onMessage.addListener(handleRuntimeMessage);
    }
    window.addEventListener("resize", handleResize, { passive: true });
    if (elements.bookmarkStrip) {
        elements.bookmarkStrip.addEventListener("wheel", handleBookmarkWheel, { passive: false });
    }
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
    strip.textContent = "";
    strip.classList.remove("scrolling");
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
            if (strip.scrollWidth > strip.clientWidth) {
                strip.classList.add("scrolling");
            }
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
    link.target = "_blank";
    link.rel = "noopener";
    link.title = node.title || node.url;

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

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "bookmark-trigger";
    trigger.title = node.title || "Folder";
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");
    trigger.textContent = node.title || "Folder";

    const menu = buildBookmarkMenu(node.children || [], 0);
    if (!menu.childElementCount) {
        trigger.disabled = true;
        trigger.setAttribute("aria-disabled", "true");
        container.appendChild(trigger);
        return container;
    }

    menu.hidden = true;
    container.appendChild(trigger);
    container.appendChild(menu);

    const controller = {
        close() {
            trigger.setAttribute("aria-expanded", "false");
            container.classList.remove("is-open");
            menu.hidden = true;
            openBookmarkFolders.delete(controller);
        }
    };

    controller.open = () => {
        closeAllBookmarkFolders(controller);
        container.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
        menu.hidden = false;
        menu.scrollTop = 0;
        openBookmarkFolders.add(controller);
    };

    trigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (container.classList.contains("is-open")) {
            controller.close();
        } else {
            controller.open();
        }
    });

    trigger.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!container.classList.contains("is-open")) {
                controller.open();
            }
            const firstItem = menu.querySelector("a, button");
            firstItem?.focus();
        } else if (event.key === "Escape") {
            controller.close();
        }
    });

    container.addEventListener("mouseleave", (event) => {
        if (!container.contains(event.relatedTarget)) {
            controller.close();
        }
    });

    return container;
}

function buildBookmarkMenu(nodes, level = 0) {
    const menu = document.createElement("ul");
    menu.className = level === 0 ? "bookmark-menu" : "bookmark-submenu";
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

    function openSubmenu() {
        item.classList.add("submenu-open");
        submenu.hidden = false;
        button.setAttribute("aria-expanded", "true");
    }

    function closeSubmenu() {
        item.classList.remove("submenu-open");
        submenu.hidden = true;
        button.setAttribute("aria-expanded", "false");
    }

    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (item.classList.contains("submenu-open")) {
            closeSubmenu();
        } else {
            openSubmenu();
            const firstItem = submenu.querySelector("a, button");
            firstItem?.focus();
        }
    });

    button.addEventListener("mouseenter", openSubmenu);
    button.addEventListener("focus", openSubmenu);
    item.addEventListener("mouseleave", (event) => {
        if (!item.contains(event.relatedTarget)) {
            closeSubmenu();
        }
    });

    button.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight") {
            event.preventDefault();
            openSubmenu();
            const firstItem = submenu.querySelector("a, button");
            firstItem?.focus();
        } else if (event.key === "ArrowLeft" || event.key === "Escape") {
            event.preventDefault();
            closeSubmenu();
            button.focus();
        }
    });

    item.appendChild(button);
    item.appendChild(submenu);
    return item;
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
    if (!event.target.closest(".bookmark-folder")) {
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
    linkEl.textContent = "View on Are.na";
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
    if (!elements.cacheLabel) {
        return;
    }
    const status = state.cacheMeta?.state || CACHE_STATE.idle;
    elements.cacheLed?.classList.toggle("is-online", status === CACHE_STATE.working);

    switch (status) {
        case CACHE_STATE.working:
            elements.cacheLabel.textContent = "Refreshing cache";
            break;
        case CACHE_STATE.error:
            elements.cacheLabel.textContent = state.cacheMeta.lastError || "Cache error";
            break;
        default: {
            const timestamp = state.cacheMeta.lastUpdated || state.cache?.fetchedAt;
            const blockCount = state.cacheMeta.blockCount ?? state.cache?.blockIds?.length ?? 0;
            if (timestamp && blockCount) {
                elements.cacheLabel.textContent = `${blockCount} block${blockCount === 1 ? "" : "s"} - ${formatRelativeTime(timestamp)}`;
            } else if (timestamp) {
                elements.cacheLabel.textContent = `Cached ${formatRelativeTime(timestamp)}`;
            } else {
                elements.cacheLabel.textContent = "Cache idle";
            }
        }
    }
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
            renderBlocks();
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
    if (!state.currentBlocks.length) {
        return;
    }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        renderLayout(state.currentBlocks);
    }, RESIZE_DEBOUNCE);
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
