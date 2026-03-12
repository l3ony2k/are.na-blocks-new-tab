import { BLOCK_TYPES } from "./constants.js";
import { fetchArenaBlock, fetchArenaChannel, fetchArenaChannelContentsPage } from "./arena-client.js";
import { sanitizeHtml, toPlainText } from "./sanitize.js";

const PER_PAGE = 100;
const MAX_PAGES = 10;

const safeUrl = (url) => {
    if (!url) return null;
    try {
        const inspected = new URL(url);
        return inspected.protocol.startsWith("http") ? inspected.toString() : null;
    } catch {
        return null;
    }
};
const getRenderedHtml = (value) => sanitizeHtml(value?.html || "");
const getRenderedPlainText = (value) => value?.plain || toPlainText(value?.html || "") || value?.markdown || "";

const deriveTitle = (item) =>
    item.title || item.source?.title || getRenderedPlainText(item.content) || getRenderedPlainText(item.description) || `${item.type || "Block"} ${item.id}`;

const buildArenaUrl = (item) => {
    if (!item) return null;
    if (item.type === "Channel" && item.owner?.slug && item.slug) {
        return `https://www.are.na/${encodeURIComponent(item.owner.slug)}/${encodeURIComponent(item.slug)}`;
    }
    if (item.id) {
        return `https://www.are.na/block/${item.id}`;
    }
    return null;
};

const normalizeOwner = (owner) => {
    if (!owner) return null;
    return {
        id: owner.id ? `${owner.id}` : null,
        type: owner.type || null,
        name: owner.name || null,
        slug: owner.slug || null,
        avatarUrl: safeUrl(owner.avatar),
        initials: owner.initials || null
    };
};

const normalizeSource = (source) => {
    if (!source) return null;
    return {
        url: safeUrl(source.url),
        title: source.title || null,
        provider: source.provider
            ? {
                  name: source.provider.name || null,
                  url: safeUrl(source.provider.url)
              }
            : null
    };
};

const normalizeConnection = (connection) => {
    if (!connection) return null;
    return {
        id: connection.id ? `${connection.id}` : null,
        position: Number.isFinite(connection.position) ? connection.position : null,
        pinned: Boolean(connection.pinned),
        connectedAt: connection.connected_at || null,
        connectedBy: normalizeOwner(connection.connected_by)
    };
};

const normalizeCounts = (counts) => {
    if (!counts) return null;
    return {
        blocks: Number.isFinite(counts.blocks) ? counts.blocks : 0,
        channels: Number.isFinite(counts.channels) ? counts.channels : 0,
        contents: Number.isFinite(counts.contents) ? counts.contents : 0,
        collaborators: Number.isFinite(counts.collaborators) ? counts.collaborators : 0
    };
};

const extractImageVersions = (image) => {
    if (!image) return null;

    const readVersion = (version) => {
        if (!version) return null;
        const src = safeUrl(version.src);
        const src2x = safeUrl(version.src_2x);

        if (!src && !src2x) {
            return null;
        }

        return {
            src,
            src2x,
            width: Number.isFinite(version.width) ? version.width : null,
            height: Number.isFinite(version.height) ? version.height : null
        };
    };

    return {
        original: {
            src: safeUrl(image.src),
            width: Number.isFinite(image.width) ? image.width : null,
            height: Number.isFinite(image.height) ? image.height : null
        },
        small: readVersion(image.small),
        medium: readVersion(image.medium),
        large: readVersion(image.large),
        square: readVersion(image.square)
    };
};

const extractImage = (item) =>
    safeUrl(
        item.image?.small?.src_2x ||
        item.image?.small?.src ||
        item.image?.medium?.src ||
        item.image?.large?.src ||
        item.image?.src
    );

const extractAttachment = (item) => {
    if (!item.attachment) return null;
    const { url, filename, file_name, file_extension, extension, content_type, file_size } = item.attachment;
    return {
        url: safeUrl(url),
        fileName: filename || file_name || null,
        extension: file_extension || extension || null,
        contentType: content_type || null,
        fileSize: Number.isFinite(file_size) ? file_size : null
    };
};

const extractEmbed = (item) => {
    if (!item.embed) return null;
    const { url, html, type, title, author_name, author_url, thumbnail_url, width, height } = item.embed;
    return {
        url: safeUrl(url),
        html: sanitizeHtml(html || ""),
        type: type || null,
        title: title || null,
        authorName: author_name || null,
        authorUrl: safeUrl(author_url),
        thumbnailUrl: safeUrl(thumbnail_url),
        width: Number.isFinite(width) ? width : null,
        height: Number.isFinite(height) ? height : null
    };
};

const normalizeArenaItem = (item, context = {}) => {
    const kind = item.type || item.base_type || "Unknown";
    const descriptionHtml = getRenderedHtml(item.description);
    const contentHtml = getRenderedHtml(item.content);
    const descriptionText = getRenderedPlainText(item.description);
    const contentText = getRenderedPlainText(item.content);
    const owner = normalizeOwner(item.owner || item.user);
    const source = normalizeSource(item.source);
    const sourceChannel = context.sourceChannel || null;
    const channel = kind === "Channel"
        ? {
              title: item.title || null,
              slug: item.slug || null
          }
        : sourceChannel;

    return {
        id: `${item.id}`,
        kind,
        type: kind,
        slug: item.slug || null,
        title: deriveTitle(item),
        arenaUrl: buildArenaUrl(item),
        descriptionHtml,
        descriptionText,
        contentHtml,
        contentText,
        createdAt: item.created_at || null,
        updatedAt: item.updated_at || null,
        state: item.state || null,
        visibility: item.visibility || null,
        commentCount: Number.isFinite(item.comment_count) ? item.comment_count : 0,
        owner,
        author: owner?.name || null,
        source,
        linkUrl: source?.url || null,
        imageUrl: extractImage(item),
        imageVersions: extractImageVersions(item.image),
        imageAlt: item.image?.alt_text || null,
        imageAspectRatio: Number.isFinite(item.image?.aspect_ratio) ? item.image.aspect_ratio : null,
        attachment: extractAttachment(item),
        embed: extractEmbed(item),
        channel,
        sourceChannel,
        connection: normalizeConnection(item.connection),
        counts: normalizeCounts(item.counts)
    };
};

export const fetchChannelBlocks = async (slug, signal, onProgress) => {
    const [channel, firstPage] = await Promise.all([
        fetchArenaChannel(slug, { signal }),
        fetchArenaChannelContentsPage(slug, { page: 1, per: PER_PAGE, sort: "position_asc", signal })
    ]);

    const totalPages = Math.min(firstPage?.meta?.total_pages || 1, MAX_PAGES);
    const pageRequests = [];

    for (let page = 2; page <= totalPages; page += 1) {
        pageRequests.push(
            fetchArenaChannelContentsPage(slug, { page, per: PER_PAGE, sort: "position_asc", signal })
                .then((payload) => ({ page, payload }))
        );
    }

    const remainingPages = await Promise.all(pageRequests);
    const orderedPages = [
        { page: 1, payload: firstPage },
        ...remainingPages
    ].sort((left, right) => left.page - right.page);

    const normalized = [];
    for (const { page, payload } of orderedPages) {
        const contents = Array.isArray(payload?.data) ? payload.data : [];
        normalized.push(
            ...contents.map((item) => normalizeArenaItem(item, {
                sourceChannel: {
                    title: channel.title,
                    slug: channel.slug
                }
            }))
        );

        if (typeof onProgress === "function") {
            onProgress({
                slug,
                page,
                total: payload?.meta?.total_count || channel.counts?.contents || normalized.length
            });
        }
    }

    return normalized;
};

export const fetchBlocksById = async (ids, signal) => {
    const responses = await Promise.all(ids.map((id) => fetchArenaBlock(id, { signal })));
    return responses.map((item) => normalizeArenaItem(item));
};

export const buildCache = async ({ channelSlugs = [], blockIds = [], filters = BLOCK_TYPES, signal, onProgress }) => {
    const allowedTypes = new Set(filters?.length ? filters : BLOCK_TYPES);
    const map = new Map();

    const addBlocks = (blocks) => {
        for (const block of blocks) {
            if (allowedTypes.has(block.kind)) {
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
