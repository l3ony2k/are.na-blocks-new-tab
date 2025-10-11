import { CACHE_STATE, MESSAGES, STORAGE_KEYS } from "./constants.js";
import { formatRelativeTime, formatExactDate } from "./time.js";
import { bookmarks, runtime, storage } from "./extension-api.js";
import { chooseRandomBlocks } from "./arena.js";
import { getCache, getSettings, saveSettings } from "./storage.js";
import { applyTheme, nextTheme } from "./theme.js";

const state = {
    settings: null,
    cache: null,
    cacheMeta: {
        state: CACHE_STATE.idle,
        lastUpdated: 0,
        lastError: null
    },
    displayedIds: []
};

const elements = {
    header: document.getElementById("header-bar"),
    footer: document.getElementById("footer-bar"),
    bookmarkStrip: document.getElementById("bookmark-strip"),
    blocksContainer: document.getElementById("blocks-container"),
    cacheLed: document.getElementById("cache-led"),
    cacheLabel: document.getElementById("cache-label"),
    refreshButton: document.getElementById("refresh-blocks"),
    themeButton: document.getElementById("theme-toggle"),
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
    updateThemeButton();
    toggleRegions();
}

function wireEvents() {
    elements.refreshButton?.addEventListener("click", handleRefreshClick);
    elements.themeButton?.addEventListener("click", handleThemeToggle);
    elements.blocksContainer?.addEventListener("click", handleBlockActions);

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

function updateThemeButton() {
    if (!elements.themeButton || !state.settings) {
        return;
    }
    const label = state.settings.theme.charAt(0).toUpperCase() + state.settings.theme.slice(1);
    elements.themeButton.textContent = `Theme (${label})`;
}

async function renderBookmarks() {
    const strip = elements.bookmarkStrip;
    if (!strip) {
        return;
    }
    strip.textContent = "";
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
    favicon.src = `chrome://favicon/size/16@2x/${encodeURIComponent(node.url)}`;
    favicon.referrerPolicy = "no-referrer";
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
        showEmptyState();
        return;
    }

    const blockCount = Math.max(1, Number(state.settings?.blockCount) || 1);
    const blocks = chooseRandomBlocks(state.cache, blockCount);
    if (!blocks.length) {
        showEmptyState();
        return;
    }
    state.displayedIds = blocks.map((block) => block.id);
    for (const block of blocks) {
        elements.blocksContainer.appendChild(renderBlockCard(block));
    }
}

function showEmptyState() {
    if (elements.emptyTemplate) {
        elements.blocksContainer.appendChild(elements.emptyTemplate.cloneNode(true));
    } else {
        const fallback = document.createElement("div");
        fallback.className = "block-empty";
        fallback.textContent = "No cached blocks yet. Configure sources in settings.";
        elements.blocksContainer.appendChild(fallback);
    }
    state.displayedIds = [];
}

function renderBlockCard(block) {
    if (!elements.blockTemplate) {
        const fallback = document.createElement("article");
        fallback.className = "block-card";
        fallback.dataset.blockId = block.id;

        const header = document.createElement("header");
        const heading = document.createElement("h2");
        heading.className = "block-title";
        heading.textContent = block.title;
        const meta = document.createElement("p");
        meta.className = "block-meta";
        meta.textContent = formatMeta(block);
        header.append(heading, meta);

        const body = document.createElement("div");
        body.className = "block-body";
        buildBlockBody(body, block);

        const footer = document.createElement("div");
        footer.className = "block-footer";
        const arenaLink = document.createElement("a");
        arenaLink.href = `https://www.are.na/block/${block.id}`;
        arenaLink.target = "_blank";
        arenaLink.rel = "noopener";
        arenaLink.textContent = "Open in Are.na";
        const dismiss = document.createElement("button");
        dismiss.className = "button block-dismiss";
        dismiss.type = "button";
        dismiss.dataset.blockId = block.id;
        dismiss.textContent = "Show another";
        footer.append(arenaLink, dismiss);

        fallback.append(header, body, footer);
        return fallback;
    }

    const fragment = elements.blockTemplate.content.cloneNode(true);
    const article = fragment.querySelector("article");
    if (!article) {
        return fragment;
    }
    article.dataset.blockId = block.id;

    const title = article.querySelector(".block-title");
    if (title) {
        title.textContent = block.title;
    }

    const meta = article.querySelector(".block-meta");
    if (meta) {
        meta.textContent = formatMeta(block);
    }

    const body = article.querySelector(".block-body");
    if (body) {
        body.innerHTML = "";
        buildBlockBody(body, block);
    }

    const link = article.querySelector(".block-link");
    if (link) {
        link.href = `https://www.are.na/block/${block.id}`;
    }

    const dismiss = article.querySelector(".block-dismiss");
    if (dismiss) {
        dismiss.dataset.blockId = block.id;
    }

    return fragment;
}

function buildBlockBody(container, block) {
    switch (block.type) {
        case "Image":
            if (block.imageUrl) {
                const img = document.createElement("img");
                img.src = block.imageUrl;
                img.alt = block.descriptionText || block.title;
                img.loading = "lazy";
                container.appendChild(img);
            }
            break;
        case "Text":
            if (block.contentHtml) {
                const text = document.createElement("div");
                text.innerHTML = block.contentHtml;
                container.appendChild(text);
            }
            break;
        case "Link":
            if (block.linkUrl) {
                container.appendChild(buildLinkRow(block.linkUrl));
            }
            break;
        case "Attachment":
            if (block.attachment?.url) {
                const link = buildLinkRow(block.attachment.url, block.attachment.fileName || "Attachment");
                container.appendChild(link);
            }
            break;
        case "Embed":
            if (block.embed?.html) {
                const wrapper = document.createElement("div");
                wrapper.innerHTML = block.embed.html;
                container.appendChild(wrapper);
            } else if (block.embed?.url) {
                container.appendChild(buildLinkRow(block.embed.url, "Open embed"));
            }
            break;
        case "Channel":
            if (block.channel?.title) {
                container.appendChild(document.createTextNode(`Channel: ${block.channel.title}`));
            } else {
                container.appendChild(document.createTextNode("Channel block"));
            }
            break;
        default:
            container.appendChild(document.createTextNode(block.descriptionText || "Untitled block"));
            break;
    }

    if (block.descriptionHtml) {
        const desc = document.createElement("div");
        desc.className = "block-description";
        desc.innerHTML = block.descriptionHtml;
        container.appendChild(desc);
    }

    if (block.linkUrl && block.type !== "Link") {
        container.appendChild(buildLinkRow(block.linkUrl, "Source link"));
    }
}

function buildLinkRow(url, label) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = label || url;
    return link;
}

function formatMeta(block) {
    const parts = [block.type];
    if (block.channel?.title) {
        parts.push(block.channel.title);
    }
    if (block.createdAt) {
        const exact = formatExactDate(block.createdAt);
        if (exact) {
            parts.push(exact);
        }
    }
    return parts.join(" Â· ");
}

        return date.toISOString().slice(0, 10);
    } catch (_) {
        return "";
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
                elements.cacheLabel.textContent = `${blockCount} block${blockCount === 1 ? "" : "s"} · ${formatRelativeTime(timestamp)}`;
            } else if (timestamp) {
                elements.cacheLabel.textContent = `Cached ${formatRelativeTime(timestamp)}`;
            } else {
                elements.cacheLabel.textContent = "Cache idle";
            }
        }
    }
}

    const minutes = Math.floor(delta / 60000);
    if (minutes < 1) {
        return "just now";
    }
    if (minutes < 60) {
        return `${minutes} min ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `${hours} hr${hours === 1 ? "" : "s"} ago`;
    }
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
}

async function handleRefreshClick() {
    renderBlocks();
}

async function handleThemeToggle() {
    const next = nextTheme(state.settings.theme);
    const updated = await saveSettings({ ...state.settings, theme: next });
    state.settings = updated;
    applyTheme(next);
    updateThemeButton();
}

function handleBlockActions(event) {
    const target = event.target;
    if (target.matches(".block-dismiss")) {
        const blockId = target.dataset.blockId;
        replaceBlock(blockId, target.closest("article"));
    }
}

function replaceBlock(blockId, article) {
    if (!article || !state.cache?.blockIds?.length) {
        return;
    }
    const exclude = state.displayedIds.filter((id) => id !== blockId);
    let [replacement] = chooseRandomBlocks(state.cache, 1, exclude);
    if (!replacement) {
        [replacement] = chooseRandomBlocks(state.cache, 1);
    }
    if (!replacement) {
        return;
    }
    const newNode = renderBlockCard(replacement);
    article.replaceWith(newNode);
    const index = state.displayedIds.indexOf(blockId);
    if (index >= 0) {
        state.displayedIds.splice(index, 1, replacement.id);
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
            updateThemeButton();
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
    const div = document.createElement("div");
    div.className = "block-empty";
    div.textContent = `Error: ${error.message}`;
    elements.blocksContainer.innerHTML = "";
    elements.blocksContainer.appendChild(div);
}

init();