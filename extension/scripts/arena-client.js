import { ARENA_API_ROOT } from "./constants.js";

const JSON_HEADERS = { Accept: "application/json" };
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000;

const isRetryableError = (status) => status >= 500 || status === 429;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildQuery = (params = {}) => {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") {
            return;
        }
        searchParams.set(key, `${value}`);
    });

    const query = searchParams.toString();
    return query ? `?${query}` : "";
};

const buildHeaders = (token) => {
    const headers = { ...JSON_HEADERS };
    if (typeof token === "string" && token.trim()) {
        headers.Authorization = `Bearer ${token.trim()}`;
    }
    return headers;
};

export const fetchArenaJson = async (path, { signal, token } = {}) => {
    let lastError;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        try {
            const response = await fetch(`${ARENA_API_ROOT}${path}`, {
                headers: buildHeaders(token),
                signal
            });

            if (!response.ok) {
                let message = await response.text().catch(() => "");
                if (message.length > 120) {
                    message = `${message.slice(0, 117)}...`;
                }

                const error = new Error(`Are.na request failed (${response.status}): ${message || response.statusText}`);
                error.status = response.status;

                if (isRetryableError(response.status) && attempt < MAX_RETRIES) {
                    await delay(RETRY_BASE_DELAY * Math.pow(2, attempt));
                    continue;
                }

                throw error;
            }

            return response.json();
        } catch (error) {
            lastError = error;

            if (signal?.aborted || error.name === "AbortError") {
                throw error;
            }

            const isNetworkError = !error.status && (
                error.message?.includes("fetch") ||
                error.message?.includes("network") ||
                error.name === "TypeError"
            );

            if (isNetworkError && attempt < MAX_RETRIES) {
                await delay(RETRY_BASE_DELAY * Math.pow(2, attempt));
                continue;
            }

            throw error;
        }
    }

    throw lastError;
};

export const fetchArenaChannel = (id, options = {}) =>
    fetchArenaJson(`/channels/${encodeURIComponent(id)}`, options);

export const fetchArenaChannelContentsPage = (id, { page = 1, per = 100, sort = "position_asc", userId, ...options } = {}) =>
    fetchArenaJson(
        `/channels/${encodeURIComponent(id)}/contents${buildQuery({
            page,
            per,
            sort,
            user_id: userId
        })}`,
        options
    );

export const fetchArenaBlock = (id, options = {}) =>
    fetchArenaJson(`/blocks/${encodeURIComponent(id)}`, options);
