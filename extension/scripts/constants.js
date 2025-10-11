export const STORAGE_KEYS = {
    settings: "settings",
    cache: "blockCache",
    cacheMeta: "blockCacheMeta"
};

export const DEFAULT_SETTINGS = {
    channelSlugs: [],
    blockIds: [],
    blockCount: 3,
    showHeader: true,
    showFooter: true,
    filters: ["Image", "Text", "Link", "Attachment", "Embed", "Channel"],
    theme: "system"
};

export const CACHE_VERSION = 1;

export const ARENA_API_ROOT = "https://api.are.na/v2";

export const BLOCK_TYPES = ["Image", "Text", "Link", "Attachment", "Embed", "Channel"];

export const CACHE_STATE = {
    idle: "idle",
    working: "working",
    error: "error"
};

export const MESSAGES = {
    refreshCache: "arena-cache-refresh",
    cacheStatus: "arena-cache-status",
    themeChanged: "arena-theme-changed"
};