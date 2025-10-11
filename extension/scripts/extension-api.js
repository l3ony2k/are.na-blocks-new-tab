const isBrowserStyle = typeof browser !== "undefined" && !!browser.storage;
const api = isBrowserStyle ? browser : typeof chrome !== "undefined" ? chrome : null;

if (!api) {
    throw new Error("No extension API detected. This code must run in a WebExtension context.");
}

function promisify(namespace, methodName) {
    const method = namespace[methodName];
    if (typeof method !== "function") {
        throw new Error(`Missing method ${methodName}`);
    }
    if (isBrowserStyle) {
        return (...args) => method.apply(namespace, args);
    }
    return (...args) => new Promise((resolve, reject) => {
        try {
            method.call(namespace, ...args, (result) => {
                const error = api.runtime && api.runtime.lastError;
                if (error) {
                    reject(new Error(error.message));
                } else {
                    resolve(result);
                }
            });
        } catch (err) {
            reject(err);
        }
    });
}

export const extensionApi = api;

export const storage = {
    get: promisify(api.storage.local, "get"),
    set: promisify(api.storage.local, "set"),
    remove: promisify(api.storage.local, "remove"),
    clear: promisify(api.storage.local, "clear"),
    onChanged: api.storage.onChanged
};

export const runtime = {
    sendMessage: promisify(api.runtime, "sendMessage"),
    getURL: (...args) => api.runtime.getURL(...args),
    onMessage: api.runtime.onMessage,
    onInstalled: api.runtime.onInstalled
};

export const bookmarks = api.bookmarks
    ? {
          getTree: promisify(api.bookmarks, "getTree"),
          getChildren: promisify(api.bookmarks, "getChildren")
      }
    : null;

export const alarms = api.alarms
    ? {
          create: promisify(api.alarms, "create"),
          clear: promisify(api.alarms, "clear"),
          onAlarm: api.alarms.onAlarm
      }
    : null;

export function addListenerSafe(event, listener) {
    if (event && typeof event.addListener === "function") {
        event.addListener(listener);
    }
}