export const formatRelativeTime = (timestamp) => {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return "just now";
    
    const delta = Date.now() - value;
    if (delta < 0) return "just now";
    
    const minutes = Math.floor(delta / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
    
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
    
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks} wk${weeks === 1 ? "" : "s"} ago`;
    
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} mo${months === 1 ? "" : "s"} ago`;
    
    const years = Math.floor(days / 365);
    return `${years} yr${years === 1 ? "" : "s"} ago`;
};

export const formatExactDate = (value) => {
    try {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
    } catch {
        return "";
    }
};