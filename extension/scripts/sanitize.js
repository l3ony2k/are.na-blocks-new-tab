const BLOCKED_TAGS = new Set(["script", "style", "template", "object", "embed"]);
const HAS_DOM = typeof DOMParser !== "undefined" && typeof document !== "undefined";

const basicSanitize = (html) => (html || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");

const cleanAttributes = (element) => {
    for (const attr of Array.from(element.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (name.startsWith("on")) {
            element.removeAttribute(attr.name);
        } else if ((name === "href" || name === "src") && value.startsWith("javascript:")) {
            element.removeAttribute(attr.name);
        }
    }
};

const walk = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) {
        node.childNodes.forEach(walk);
        return;
    }
    
    const tagName = node.tagName.toLowerCase();
    if (BLOCKED_TAGS.has(tagName)) {
        node.remove();
        return;
    }
    
    if (tagName === "iframe") {
        const src = node.getAttribute("src") || "";
        if (!/^https:\/\//i.test(src)) {
            node.remove();
            return;
        }
        node.setAttribute("loading", "lazy");
        node.setAttribute("referrerpolicy", "no-referrer");
        node.setAttribute("sandbox", "allow-same-origin allow-scripts allow-popups");
    }
    
    cleanAttributes(node);
    node.childNodes.forEach(walk);
};

export const sanitizeHtml = (html) => {
    if (!html) return "";
    if (!HAS_DOM) return basicSanitize(html);
    
    const doc = new DOMParser().parseFromString(html, "text/html");
    walk(doc.body);
    return doc.body.innerHTML;
};

export const toPlainText = (html) => {
    if (!html) return "";
    if (!HAS_DOM) return basicSanitize(html).replace(/<[^>]+>/g, "");
    
    return new DOMParser().parseFromString(html, "text/html").body.textContent || "";
};
