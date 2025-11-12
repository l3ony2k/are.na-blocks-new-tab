import { storage } from "./extension-api.js";
import { STORAGE_KEYS, DEFAULT_SETTINGS, CACHE_VERSION, TILE_SIZE_OPTIONS } from "./constants.js";

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

const normalizeCommaList = (value) => (value || "").split(",").map(item => item.trim()).filter(Boolean);

export const parseChannelSlugs = (input) => normalizeCommaList(input.toLowerCase());

export const parseBlockIds = (input) => normalizeCommaList(input).map(id => id.replace(/[^0-9]/g, "")).filter(Boolean);

export const getSettings = async () => {
    const raw = await storage.get(STORAGE_KEYS.settings);
    const stored = raw?.[STORAGE_KEYS.settings];
    
    if (!stored) return { ...DEFAULT_SETTINGS };
    
    return {
        ...DEFAULT_SETTINGS,
        ...stored,
        channelSlugs: Array.isArray(stored.channelSlugs) ? stored.channelSlugs : normalizeCommaList(stored.channelSlugs),
        blockIds: Array.isArray(stored.blockIds) ? stored.blockIds : parseBlockIds(stored.blockIds),
        tileSize: TILE_SIZE_OPTIONS.includes(stored.tileSize) ? stored.tileSize : DEFAULT_SETTINGS.tileSize
    };
};

export const saveSettings = async (settings) => {
    const payload = {
        ...DEFAULT_SETTINGS,
        ...settings,
        channelSlugs: Array.isArray(settings.channelSlugs)
            ? settings.channelSlugs.map(slug => slug.trim()).filter(Boolean)
            : [],
        blockIds: Array.isArray(settings.blockIds)
            ? settings.blockIds.map(id => `${id}`.trim()).filter(Boolean)
            : [],
        tileSize: TILE_SIZE_OPTIONS.includes(settings.tileSize) ? settings.tileSize : DEFAULT_SETTINGS.tileSize
    };
    
    await storage.set({ [STORAGE_KEYS.settings]: payload });
    return payload;
};

export const getCache = async () => {
    const raw = await storage.get([STORAGE_KEYS.cache, STORAGE_KEYS.cacheMeta]);
    const cache = raw?.[STORAGE_KEYS.cache];
    const meta = raw?.[STORAGE_KEYS.cacheMeta];
    
    return {
        cache: cache?.version === CACHE_VERSION ? cache : { ...DEFAULT_CACHE },
        meta: meta ? { ...DEFAULT_CACHE_META, ...meta } : { ...DEFAULT_CACHE_META }
    };
};

export const saveCache = async (cache) => {
    await storage.set({ [STORAGE_KEYS.cache]: { ...cache, version: CACHE_VERSION } });
};

export const saveCacheMeta = async (meta) => {
    await storage.set({ [STORAGE_KEYS.cacheMeta]: { ...DEFAULT_CACHE_META, ...meta } });
};

export const clearCache = async () => {
    await storage.remove([STORAGE_KEYS.cache, STORAGE_KEYS.cacheMeta]);
};
