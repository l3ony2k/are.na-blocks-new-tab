import { ARENA_API_ROOT, BLOCK_TYPES } from "./constants.js";
import { sanitizeHtml, toPlainText } from "./sanitize.js";

const PER_PAGE = 100;
const MAX_PAGES = 10;
const JSON_HEADERS = { Accept: "application/json" };

const safeUrl = (url) => {
    if (!url) return null;
    try {
        const inspected = new URL(url);
        return inspected.protocol.startsWith("http") ? inspected.toString() : null;
    } catch {
        return null;
    }
};

const fetchJson = async (path, signal) => {
    const response = await fetch(`${ARENA_API_ROOT}${path}`, { headers: JSON_HEADERS, signal });
    if (!response.ok) {
        let message = await response.text().catch(() => "");
        // Truncate to prevent huge HTML error pages from entering the error flow
        if (message.length > 20) {
            message = message.slice(0, 20) + "...";
        }
        throw new Error(`Are.na request failed (${response.status}): ${message || response.statusText}`);
    }
    return response.json();
};

const deriveTitle = (block) =>
    block.title || block.generated_title || block.content || block.source?.title || `Block ${block.id}`;

const normalizeType = (block) => block.class || block.base_class || block.kind || "Unknown";

const extractImage = (block) => safeUrl(block.image?.display?.url || block.image?.original?.url);

const extractAttachment = (block) => {
    if (!block.attachment) return null;
    const { url, file_name, filename, extension, content_type } = block.attachment;
    return {
        url: safeUrl(url),
        fileName: file_name || filename || null,
        extension: extension || null,
        contentType: content_type || null
    };
};

const extractEmbed = (block) => {
    if (!block.embed) return null;
    const { url, src, html, type } = block.embed;
    return {
        url: safeUrl(url || src),
        html: sanitizeHtml(html || ""),
        type: type || null
    };
};

const summarizeBlock = (block, context = {}) => {
    const type = normalizeType(block);
    return {
        id: `${block.id}`,
        slug: block.slug || null,
        type,
        title: deriveTitle(block),
        descriptionHtml: sanitizeHtml(block.description_html || ""),
        descriptionText: toPlainText(block.description_html || block.description || ""),
        contentHtml: type === "Text" ? sanitizeHtml(block.content_html || block.content || "") : "",
        createdAt: block.created_at || null,
        updatedAt: block.updated_at || null,
        imageUrl: extractImage(block),
        linkUrl: safeUrl(block.external_url || block.source?.url),
        attachment: extractAttachment(block),
        embed: extractEmbed(block),
        channel: {
            title: context.channelTitle || block.connected_to_channel?.title || block.channel?.title || null,
            slug: context.channelSlug || block.connected_to_channel?.slug || block.channel?.slug || null
        },
        author: block.user?.full_name || block.user?.username || null
    };
};

export const fetchChannelBlocks = async (slug, signal, onProgress) => {
    const items = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        const data = await fetchJson(`/channels/${encodeURIComponent(slug)}/contents?page=${page}&per=${PER_PAGE}`, signal);
        const contents = data.contents || [];
        items.push(...contents.map(block => summarizeBlock(block, {
            channelSlug: slug,
            channelTitle: data.title
        })));

        if (typeof onProgress === "function") {
            onProgress({ slug, page, total: data.length || contents.length });
        }
        if (contents.length < PER_PAGE) break;
    }
    return items;
};

export const fetchBlocksById = async (ids, signal) => {
    const results = [];
    for (const id of ids) {
        const data = await fetchJson(`/blocks/${encodeURIComponent(id)}`, signal);
        results.push(summarizeBlock(data));
    }
    return results;
};

export const buildCache = async ({ channelSlugs = [], blockIds = [], filters = BLOCK_TYPES, signal, onProgress }) => {
    const allowedTypes = new Set(filters?.length ? filters : BLOCK_TYPES);
    const map = new Map();

    const addBlocks = (blocks) => {
        for (const block of blocks) {
            if (allowedTypes.has(block.type)) {
                map.set(block.id, block);
            }
        }
    };

    for (const slug of channelSlugs) {
        addBlocks(await fetchChannelBlocks(slug, signal, onProgress));
    }

    if (blockIds.length) {
        addBlocks(await fetchBlocksById(blockIds, signal));
    }

    const blockIdsList = Array.from(map.keys());
    return {
        blocksById: Object.fromEntries(blockIdsList.map(id => [id, map.get(id)])),
        blockIds: blockIdsList,
        fetchedAt: Date.now(),
        sources: { channels: channelSlugs, blockIds }
    };
};

export const chooseRandomBlocks = (cache, count = 1, exclude = []) => {
    const pool = cache?.blockIds || [];
    if (!pool.length) return [];

    const excludeSet = new Set((exclude || []).map(String));
    const filtered = pool.filter(id => !excludeSet.has(String(id)));
    if (!filtered.length) return [];

    const shuffled = [...filtered];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled
        .slice(0, Math.min(count, shuffled.length))
        .map(id => cache.blocksById[id])
        .filter(Boolean);
};