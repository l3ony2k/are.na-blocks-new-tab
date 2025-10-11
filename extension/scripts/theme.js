const THEME_CLASSES = ["theme-light", "theme-dark"];

export function applyTheme(mode = "system") {
    const root = document.documentElement;
    root.classList.remove(...THEME_CLASSES);
    root.dataset.theme = mode;
    if (mode === "light") {
        root.classList.add("theme-light");
    } else if (mode === "dark") {
        root.classList.add("theme-dark");
    }
}

export function nextTheme(current = "system") {
    const order = ["system", "light", "dark"];
    const index = order.indexOf(current);
    return order[(index + 1) % order.length];
}

export function watchSystemTheme(listener) {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => listener(media.matches ? "dark" : "light");
    if (typeof media.addEventListener === "function") {
        media.addEventListener("change", handler);
    } else if (typeof media.addListener === "function") {
        media.addListener(handler);
    }
    return () => {
        if (typeof media.removeEventListener === "function") {
            media.removeEventListener("change", handler);
        } else if (typeof media.removeListener === "function") {
            media.removeListener(handler);
        }
    };
}