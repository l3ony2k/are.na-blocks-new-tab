const BLOCKED_TAGS = new Set(["script", "style", "template", "object", "embed"]);
const HAS_DOM = typeof DOMParser !== "undefined" && typeof document !== "undefined";

function basicSanitize(html) {
    return (html || "")
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
        .replace(/on[a-z]+\s*=\s*"[^"]*"/gi, "")
        .replace(/on[a-z]+\s*=\s*'[^']*'/gi, "")
        .replace(/javascript:/gi, "");
}

function cleanAttributes(element) {
    for (const attr of Array.from(element.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (name.startsWith("on")) {
            element.removeAttribute(attr.name);
            continue;
        }
        if ((name === "href" || name === "src") && value.startsWith("javascript:")) {
            element.removeAttribute(attr.name);
        }
    }
}

function walk(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
        if (BLOCKED_TAGS.has(node.tagName.toLowerCase())) {
            node.remove();
            return;
        }
        if (node.tagName.toLowerCase() === "iframe") {
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
    }
    for (const child of Array.from(node.childNodes)) {
        walk(child);
    }
}

export function sanitizeHtml(html) {
    if (!html) {
        return "";
    }
    if (!HAS_DOM) {
        return basicSanitize(html);
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    walk(doc.body);
    return doc.body.innerHTML;
}

export function toPlainText(html) {
    if (!html) {
        return "";
    }
    if (!HAS_DOM) {
        return basicSanitize(html).replace(/<[^>]+>/g, "");
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return doc.body.textContent || "";
}
