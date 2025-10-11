import { CACHE_STATE, MESSAGES, STORAGE_KEYS } from "./constants.js";
import { formatRelativeTime, formatExactDate } from "./time.js";
import { bookmarks, runtime, storage } from "./extension-api.js";
import { chooseRandomBlocks } from "./arena.js";
import { getCache, getSettings } from "./storage.js";
import { applyTheme } from "./theme.js";
import { toPlainText } from "./sanitize.js";

const state = {
    settings: null,
    cache: null,
    cacheMeta: {
        state: CACHE_STATE.idle,
        lastUpdated: 0,
        lastError: null,
        blockCount: 0
    }
};

const elements = {
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
        const collected = [];
        collectBookmarks(bar?.children || rootChildren, collected, 12);
        if (!collected.length) {
            const template = elements.bookmarkEmptyTemplate?.content?.cloneNode(true);
            if (template) {
                strip.appendChild(template);
            } else {
                strip.textContent = "No bookmarks";
            }
            strip.classList.remove("scrolling");
            return;
        }
        for (const item of collected) {
            strip.appendChild(createBookmarkNode(item));
        }
        if (strip.scrollWidth > strip.clientWidth) {
            strip.classList.add("scrolling");
        } else {
            strip.classList.remove("scrolling");
        }
    } catch (error) {
        console.error("Failed to load bookmarks", error);
        strip.textContent = "Bookmarks unavailable";
        strip.classList.remove("scrolling");
    } finally {
        strip.dataset.state = "ready";
    }
}

function collectBookmarks(nodes, bucket, limit) {
    for (const node of nodes) {
        if (bucket.length >= limit) {
            break;
        }
        if (node.url) {
            bucket.push(node);
        } else if (node.children) {
            collectBookmarks(node.children, bucket, limit);
        }
    }
}

function createBookmarkNode(node) {
    const link = document.createElement("a");
    link.className = "bookmark-link";
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

function renderBlocks() {
    if (!elements.blocksContainer) {
        return;
    }
    elements.blocksContainer.innerHTML = "";

    if (!state.cache?.blockIds?.length) {
        state.cacheMeta.blockCount = 0;
        showEmptyState();
        return;
    }

    state.cacheMeta.blockCount = state.cache.blockIds.length;

    const blockCount = Math.max(1, Number(state.settings?.blockCount) || 1);
    const blocks = chooseRandomBlocks(state.cache, blockCount);
    if (!blocks.length) {
        showEmptyState();
        return;
    }

    elements.blocksContainer.classList.remove("is-empty");
    for (const block of blocks) {
        const node = renderBlockCard(block);
        elements.blocksContainer.appendChild(node);
    }
}

function showEmptyState() {
    elements.blocksContainer.classList.add("is-empty");
    if (elements.emptyTemplate) {
        elements.blocksContainer.appendChild(elements.emptyTemplate.cloneNode(true));
    } else {
        const fallback = document.createElement("div");
        fallback.className = "block-empty";
        fallback.textContent = "No cached blocks yet. Configure sources in settings.";
        elements.blocksContainer.appendChild(fallback);
    }
}

function renderBlockCard(block) {
    if (elements.blockTemplate?.content) {
        const fragment = elements.blockTemplate.content.cloneNode(true);
        const article = fragment.querySelector("article");
        populateCard(article, block);
        return fragment;
    }
    return buildFallbackCard(block);
}

function populateCard(article, block) {
    if (!article) {
        return;
    }
    const main = article.querySelector("[data-main]");
    const titleEl = article.querySelector(".block-title");
    const descriptionEl = article.querySelector(".block-description");
    const dateEl = article.querySelector(".block-date");
    const typeEl = article.querySelector(".block-type");
    const linkEl = article.querySelector(".block-link");

    if (main) {
        buildMainContent(main, block);
    }

    const title = block.title || `Block ${block.id}`;
    if (titleEl) {
        titleEl.textContent = title;
    }

    if (descriptionEl) {
        if (block.descriptionText) {
            descriptionEl.textContent = block.descriptionText;
            descriptionEl.classList.remove("is-empty");
        } else {
            descriptionEl.textContent = "";
            descriptionEl.classList.add("is-empty");
        }
    }

    if (dateEl) {
        const exact = formatExactDate(block.createdAt);
        dateEl.textContent = exact || "";
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
    buildMainContent(main, block);

    const info = document.createElement("div");
    info.className = "block-info";

    const titleEl = document.createElement("h2");
    titleEl.className = "block-title";
    titleEl.textContent = block.title || `Block ${block.id}`;

    const descriptionEl = document.createElement("p");
    descriptionEl.className = "block-description";
    if (block.descriptionText) {
        descriptionEl.textContent = block.descriptionText;
    } else {
        descriptionEl.classList.add("is-empty");
    }

    const metaRow = document.createElement("div");
    metaRow.className = "block-meta-row";

    const dateEl = document.createElement("span");
    dateEl.className = "block-date";
    dateEl.textContent = formatExactDate(block.createdAt) || "";

    const linkEl = document.createElement("a");
    linkEl.className = "block-link";
    linkEl.href = `https://www.are.na/block/${block.id}`;
    linkEl.target = "_blank";
    linkEl.rel = "noopener";
    linkEl.textContent = "View on Are.na";

    const typeEl = document.createElement("span");
    typeEl.className = "block-type";
    typeEl.textContent = block.type || "Block";

    metaRow.append(dateEl, linkEl, typeEl);
    info.append(titleEl, descriptionEl, metaRow);
    article.append(main, info);
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
        content.textContent = textContent.trim();
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
            renderBlocks();
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

function renderError(error) {
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
