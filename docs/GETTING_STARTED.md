# Are.na New Tab Extension — Getting Started

This project extends Chrome and Firefox with a custom new tab page styled after the `style-ref.css` reference. It surfaces random Are.na blocks from the channels and block IDs you choose, and keeps a local cache so each tab opens instantly.

## Project Layout

```
extension/
├── assets/              # Icons and SVG assets used across pages
├── pages/
│   ├── new-tab.html     # New tab entry point (chrome_url_overrides)
│   └── settings.html    # Options UI exposed via manifest options_ui
├── scripts/             # Shared ES modules used by pages and background
│   ├── arena.js         # Are.na API integration & cache builder
│   ├── background.js    # Service worker orchestrating cache refreshes
│   ├── constants.js     # Shared enums/defaults/storage keys
│   ├── extension-api.js # WebExtension API wrappers with promise support
│   ├── new-tab.js       # Front-end logic for the new tab
│   ├── sanitize.js      # HTML sanitisation helpers (worker-safe)
│   ├── settings.js      # Options page behaviour
│   ├── storage.js       # Storage helpers + parsing utilities
│   ├── theme.js         # Theme helpers (system / light / dark)
│   └── time.js          # Relative/absolute time formatting
└── styles/
    └── style.css        # Adapted styling to match the provided reference
```

All extension files live under `extension/`. The top-level `docs/` directory still contains the original PRD and `style-ref.css` for reference.

## Installing the Extension Locally

### Chrome / Chromium

1. Open `chrome://extensions/`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `extension/` directory in this repository.
4. Open a new tab to verify the Are.na layout loads. Use the **Settings** button in the header to configure your sources.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select any file inside the `extension/` directory (e.g., `manifest.json`).
4. Open a new tab to exercise the page. Firefox keeps temporary add-ons active until the browser restarts.

## First-Time Configuration

1. Open the settings page via the footer link on the new tab or from the browser’s extension manager.
2. Provide one or more Are.na channel slugs (comma-separated) in **Channel slugs**. Example: `design-inspiration, architectural-brutalism`.
3. Optionally list individual block IDs if you want to seed specific blocks.
4. Choose the number of blocks to surface per tab (1–6).
5. Pick the block types you want included. Leaving everything checked mirrors Are.na’s default types.
6. Toggle the header/footer visibility and theme to match your preference.
7. Click **Save settings**. The background service worker fetches content from Are.na, caches the results, and broadcasts status back to the UI (look for the cache badge in the footer).

> **Tip:** Use **Test sources** first if you’re unsure your slugs/IDs are valid. The extension will perform a dry run and show how many blocks it would cache, without overwriting existing data.

## What to Expect on the New Tab

- Header bar: Mirrors the typography and height from `style-ref.css`, and shows a horizontal strip of your bookmark bar entries. If you store bookmarks inside folders, the first level of bookmark children is flattened so the strip always has something to show.
- Main content: Random blocks pulled from the cached pool. Each card includes the block title, type/channel metadata, sanitized content (text/images/attachments), and an “Open in Are.na” link. “Show another” swaps a single block without refreshing the page.
- Footer: Displays extension version info and a live cache badge. When the background worker is refreshing data, the LED flips to an “active” state and the label switches to “Refreshing cache”.

## Refresh & Caching Model

- **Initial fetch**: Triggered automatically after a successful save in settings.
- **Manual refresh**: Click **Refresh cache** in settings or use the **Refresh** button on the new tab to pull a new set of random blocks from the existing cache.
- **Storage**: `chrome.storage.local` holds both settings (`settings`) and cache data (`blockCache` + `blockCacheMeta`). Cache meta tracks state, last updated timestamp, and block counts.
- **API usage**: Only public Are.na endpoints are used. If a channel is private or rate-limited, the refresh job surfaces the error message in the UI.

## Styling Notes

- The CSS keeps the same monochrome palette, background dot grid, 35px header/footer height, and sharp edges as `style-ref.css`.
- Theme helpers apply `theme-light` / `theme-dark` classes on the `<html>` element for deterministic overrides.
- Scrollbars, buttons, and badges reuse the same neutral colours and straight edges; no border radius is introduced.

## Development Tips

- All scripts are ES modules. When editing or adding features, stick with `import`/`export` and keep shared logic in `scripts/` so both the background worker and UI can reuse it.
- Use `node --check <file>` to sanity-check syntax as shown above; there is no bundler or transpiler layer.
- If you need to expand caching (e.g., add auto-refresh), `scripts/background.js` is the place to hook alarms or timed jobs.
- The sanitiser in `scripts/sanitize.js` automatically downgrades to a regex-based fallback when running inside the service worker (where `DOMParser` is unavailable). When adding new renderers, continue to pass raw Are.na HTML through `sanitizeHtml` / `toPlainText` before injecting into the DOM.

## Next Steps

- Package for the Chrome Web Store and Firefox Add-ons by zipping the `extension/` directory (after updating metadata such as version, description, and icons if desired).
- Keep an eye on API responses. If Are.na introduces auth requirements for public content, the background worker is the right spot to capture and surface credential prompts.
- Consider adding lightweight telemetry or logging (to storage) if you need to inspect refresh failures over time.

That’s it—load the unpacked extension, configure a few channels, and the new tab will serve a steady rotation of Are.na inspiration in the requested aesthetic.