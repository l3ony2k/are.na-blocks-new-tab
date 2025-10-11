import { ARENA_API_ROOT, BLOCK_TYPES } from "./constants.js";
import { sanitizeHtml, toPlainText } from "./sanitize.js";

const PER_PAGE = 100;
const MAX_PAGES = 10;
const JSON_HEADERS = {
    Accept: "application/json"
};

function safeUrl(url) {
    if (!url) {
        return null;
    }
    try {
        const inspected = new URL(url);
        return inspected.protocol.startsWith("http") ? inspected.toString() : null;
    } catch (_) {
        return null;
    }
}

async function fetchJson(path, signal) {
    const response = await fetch(`${ARENA_API_ROOT}${path}`, {
        headers: JSON_HEADERS,
        signal
    });
    if (!response.ok) {
        const message = await response.text().catch(() => "");
        throw new Error(`Are.na request failed (${response.status}): ${message || response.statusText}`);
    }
    return response.json();
}

function deriveTitle(block) {
    return (
        block.title ||
        block.generated_title ||
        block.content ||
        block.source?.title ||
        `Block ${block.id}`
    );
}

function normalizeType(block) {
    return block.class || block.base_class || block.kind || "Unknown";
}

function extractImage(block) {
    const display = block.image?.display?.url;
    const original = block.image?.original?.url;
    return safeUrl(display || original);
}

function extractAttachment(block) {
    if (!block.attachment) {
        return null;
    }
    return {
        url: safeUrl(block.attachment.url),
        fileName: block.attachment.file_name || block.attachment.filename || null,
        extension: block.attachment.extension || null,
        contentType: block.attachment.content_type || null
    };
}

function extractEmbed(block) {
    if (!block.embed) {
        return null;
    }
    return {
        url: safeUrl(block.embed.url || block.embed.src),
        html: sanitizeHtml(block.embed.html || ""),
        type: block.embed.type || null
    };
}

function summarizeBlock(block, context = {}) {
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
}

export async function fetchChannelBlocks(slug, signal, onProgress) {
    const items = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const data = await fetchJson(`/channels/${encodeURIComponent(slug)}/contents?page=${page}&per=${PER_PAGE}`, signal);
        const contents = data.contents || [];
        for (const block of contents) {
            const summary = summarizeBlock(block, {
                channelSlug: slug,
                channelTitle: data.title
            });
            items.push(summary);
        }
        if (typeof onProgress === "function") {
            onProgress({ slug, page, total: data.length || contents.length });
        }
        if (contents.length < PER_PAGE) {
            break;
        }
    }
    return items;
}

export async function fetchBlocksById(ids, signal) {
    const results = [];
    for (const id of ids) {
        const data = await fetchJson(`/blocks/${encodeURIComponent(id)}`, signal);
        results.push(summarizeBlock(data));
    }
    return results;
}

export async function buildCache({ channelSlugs = [], blockIds = [], filters = BLOCK_TYPES, signal, onProgress }) {
    const allowedTypes = new Set(filters && filters.length ? filters : BLOCK_TYPES);
    const map = new Map();

    for (const slug of channelSlugs) {
        const channelBlocks = await fetchChannelBlocks(slug, signal, onProgress);
        for (const block of channelBlocks) {
            if (allowedTypes.has(block.type)) {
                map.set(block.id, block);
            }
        }
    }

    if (blockIds.length) {
        const blocks = await fetchBlocksById(blockIds, signal);
        for (const block of blocks) {
            if (allowedTypes.has(block.type)) {
                map.set(block.id, block);
            }
        }
    }

    const blockIdsList = Array.from(map.keys());
    return {
        blocksById: Object.fromEntries(blockIdsList.map((id) => [id, map.get(id)])),
        blockIds: blockIdsList,
        fetchedAt: Date.now(),
        sources: {
            channels: channelSlugs,
            blockIds
        }
    };
}

export function chooseRandomBlocks(cache, count = 1, exclude = []) {
    const pool = cache?.blockIds || [];
    if (!pool.length) {
        return [];
    }

    const excludeSet = new Set((exclude || []).map(String));
    const filtered = pool.filter((id) => !excludeSet.has(String(id)));
    if (!filtered.length) {
        return [];
    }
    const shuffled = [...filtered];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const selected = shuffled.slice(0, Math.min(count, shuffled.length));
    return selected
        .map((id) => cache.blocksById[id])
        .filter(Boolean);
}