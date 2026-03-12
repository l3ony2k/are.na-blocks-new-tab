import { buildCache } from "./arena.js";
import { CACHE_STATE } from "./constants.js";
import { getSettings, saveCache, saveCacheMeta } from "./storage.js";

const notify = async (meta, onStateChange) => {
    if (typeof onStateChange === "function") {
        await onStateChange(meta);
        return;
    }
    await saveCacheMeta(meta);
};

export const refreshCache = async ({ testOnly = false, settingsOverride = null, onStateChange } = {}) => {
    await notify({ state: CACHE_STATE.working, lastError: null }, onStateChange);

    try {
        const settings = settingsOverride || (await getSettings());
        const cache = await buildCache({
            channelSlugs: settings.channelSlugs,
            blockIds: settings.blockIds,
            filters: settings.filters
        });

        if (!testOnly) {
            await saveCache(cache);
        }

        await notify({
            state: CACHE_STATE.idle,
            lastUpdated: cache.fetchedAt,
            lastError: null,
            blockCount: cache.blockIds.length
        }, onStateChange);

        return {
            blockCount: cache.blockIds.length,
            fetchedAt: cache.fetchedAt
        };
    } catch (error) {
        await notify({
            state: CACHE_STATE.error,
            lastError: error.message,
            lastUpdated: Date.now()
        }, onStateChange);
        throw error;
    }
};
