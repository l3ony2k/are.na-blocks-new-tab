import { storage } from "./extension-api.js";
import { STORAGE_KEYS, DEFAULT_SETTINGS, CACHE_VERSION } from "./constants.js";

const DEFAULT_CACHE = {
    version: CACHE_VERSION,
    fetchedAt: 0,
    blockIds: [],
    blocksById: {},
    sources: {
        channels: [],
        blockIds: []
    }
};

const DEFAULT_CACHE_META = {
    state: "idle",
    lastUpdated: 0,
    lastError: null,
    blockCount: 0
};

function normalizeCommaList(value) {
    return (value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

export function parseChannelSlugs(input) {
    return normalizeCommaList(input.toLowerCase());
}

export function parseBlockIds(input) {
    return normalizeCommaList(input).map((id) => id.replace(/[^0-9]/g, ""))
        .filter(Boolean);
}

export async function getSettings() {
    const raw = await storage.get(STORAGE_KEYS.settings);
    const stored = raw?.[STORAGE_KEYS.settings];
    if (!stored) {
        return { ...DEFAULT_SETTINGS };
    }
    return {
        ...DEFAULT_SETTINGS,
        ...stored,
        channelSlugs: Array.isArray(stored.channelSlugs) ? stored.channelSlugs : normalizeCommaList(stored.channelSlugs),
        blockIds: Array.isArray(stored.blockIds) ? stored.blockIds : parseBlockIds(stored.blockIds)
    };
}

export async function saveSettings(settings) {
    const payload = {
        ...DEFAULT_SETTINGS,
        ...settings,
        channelSlugs: Array.isArray(settings.channelSlugs)
            ? settings.channelSlugs.map((slug) => slug.trim()).filter(Boolean)
            : [],
        blockIds: Array.isArray(settings.blockIds)
            ? settings.blockIds.map((id) => `${id}`.trim()).filter(Boolean)
            : []
    };
    await storage.set({
        [STORAGE_KEYS.settings]: payload
    });
    return payload;
}

export async function getCache() {
    const raw = await storage.get([STORAGE_KEYS.cache, STORAGE_KEYS.cacheMeta]);
    const cache = raw?.[STORAGE_KEYS.cache];
    const meta = raw?.[STORAGE_KEYS.cacheMeta];
    return {
        cache: cache && cache.version === CACHE_VERSION ? cache : { ...DEFAULT_CACHE },
        meta: meta ? { ...DEFAULT_CACHE_META, ...meta } : { ...DEFAULT_CACHE_META }
    };
}

export async function saveCache(cache) {
    await storage.set({
        [STORAGE_KEYS.cache]: {
            ...cache,
            version: CACHE_VERSION
        }
    });
}

export async function saveCacheMeta(meta) {
    await storage.set({
        [STORAGE_KEYS.cacheMeta]: {
            ...DEFAULT_CACHE_META,
            ...meta
        }
    });
}

export async function clearCache() {
    await storage.remove([STORAGE_KEYS.cache, STORAGE_KEYS.cacheMeta]);
}