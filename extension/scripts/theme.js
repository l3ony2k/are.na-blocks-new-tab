const THEME_CLASSES = ["theme-light", "theme-dark"];

export const applyTheme = (mode = "system") => {
    const root = document.documentElement;
    root.classList.remove(...THEME_CLASSES);
    root.dataset.theme = mode;
    if (mode === "light") root.classList.add("theme-light");
    else if (mode === "dark") root.classList.add("theme-dark");
};

export const nextTheme = (current = "system") => {
    const order = ["system", "light", "dark"];
    return order[(order.indexOf(current) + 1) % order.length];
};

export const watchSystemTheme = (listener) => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => listener(media.matches ? "dark" : "light");
    
    const add = media.addEventListener || media.addListener;
    const remove = media.removeEventListener || media.removeListener;
    
    add.call(media, "change", handler);
    return () => remove.call(media, "change", handler);
};