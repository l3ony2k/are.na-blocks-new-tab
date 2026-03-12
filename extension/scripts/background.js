import { runtime } from "./extension-api.js";
import { CACHE_STATE, MESSAGES } from "./constants.js";
import { saveCacheMeta, getCache } from "./storage.js";
import { refreshCache } from "./cache-refresh.js";

let isRefreshing = false;

runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== MESSAGES.refreshCache) {
        return false;
    }
    handleRefreshRequest(message.payload || {})
        .then((result) => sendResponse({ ok: true, summary: result }))
        .catch((error) => {
            console.error("Cache refresh failed", error);
            sendResponse({ ok: false, error: error.message });
        });
    return true;
});

async function handleRefreshRequest(options) {
    if (isRefreshing) {
        throw new Error("Cache refresh already in progress");
    }

    isRefreshing = true;

    try {
        return await refreshCache({
            ...options,
            onStateChange: updateCacheMeta
        });
    } catch (error) {
        throw error;
    } finally {
        isRefreshing = false;
    }
}

async function updateCacheMeta(meta) {
    await saveCacheMeta(meta);
    try {
        await runtime.sendMessage({
            type: MESSAGES.cacheStatus,
            payload: meta
        });
    } catch (error) {
        const message = (error && error.message) || "";
        if (/receiving end/i.test(message) || /message port closed/i.test(message)) {
            return;
        }
        console.warn("cacheStatus broadcast failed", error);
    }
}

runtime.onInstalled.addListener(async () => {
    const { cache } = await getCache();
    if (!cache.blockIds.length) {
        await updateCacheMeta({ state: CACHE_STATE.idle, lastUpdated: 0, lastError: null });
    }
});
