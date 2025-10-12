export const STORAGE_KEYS = {
    settings: "settings",
    cache: "blockCache",
    cacheMeta: "blockCacheMeta",
    bootstrap: "bootstrapState"
};

export const DEFAULT_SETTINGS = {
    channelSlugs: ["ephemeral-visions", "device-gadget"],
    blockIds: [],
    blockCount: 1,
    showHeader: true,
    showFooter: true,
    filters: ["Image", "Text"],
    theme: "system",
    tileSize: "auto"
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

export const TILE_SIZE_OPTIONS = ["auto", "xs", "s", "m", "l", "xl"];

