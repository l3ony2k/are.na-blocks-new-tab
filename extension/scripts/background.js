import { runtime } from "./extension-api.js";
import { buildCache } from "./arena.js";
import { CACHE_STATE, MESSAGES } from "./constants.js";
import { getSettings, saveCache, saveCacheMeta, getCache } from "./storage.js";

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

    const { testOnly = false, settingsOverride = null } = options;
    isRefreshing = true;

    try {
        await updateCacheMeta({ state: CACHE_STATE.working, lastError: null });
        const settings = settingsOverride || (await getSettings());
        const cache = await buildCache({
            channelSlugs: settings.channelSlugs,
            blockIds: settings.blockIds,
            filters: settings.filters
        });

        if (!testOnly) {
            await saveCache(cache);
            await updateCacheMeta({
                state: CACHE_STATE.idle,
                lastUpdated: cache.fetchedAt,
                lastError: null,
                blockCount: cache.blockIds.length
            });
        } else {
            await updateCacheMeta({
                state: CACHE_STATE.idle,
                blockCount: cache.blockIds.length
            });
        }

        return {
            blockCount: cache.blockIds.length,
            fetchedAt: cache.fetchedAt
        };
    } catch (error) {
        await updateCacheMeta({ state: CACHE_STATE.error, lastError: error.message, lastUpdated: Date.now() });
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