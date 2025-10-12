# are.na blocks new tab

## Overview
This extension replaces the browser’s default new tab with a grid of random Are.na blocks sourced from your favourite channels. Out of the box it shows one block at a time pulled from the `ephemeral-visions` and `device-gadget` channels, and it keeps your existing bookmarks accessible with a scrollable strip and nested folder menus (overflowing items sit behind a `⋯` button).

## Installation
- **Chrome Web Store:** Visit the listing for “are.na blocks new tab” and click `Add to Chrome`. The extension starts working immediately after the install prompt.
- **Manual install (development builds):**
  1. Clone or download this repository.
  2. Open `chrome://extensions/`, enable *Developer mode*, and choose *Load unpacked*.
  3. Select the `extension/` directory to load the unpacked build. Reload the page after pulling updates.

## Using the New Tab
- Open a new tab to see a fresh block; the layout adapts automatically to the viewport and your display settings.
- Use the bookmark strip across the top to launch saved links or drill into folders. If the strip overflows the header, the `⋯` button reveals the hidden bookmarks in the same dropdown style as nested folders.
- The footer shows the current cache status message and links to the settings page. On the first launch the extension saves the default settings and immediately refreshes the cache so the grid is never blank.

## Settings Page
- **Content Sources:** Configure channel slugs, specific block IDs, and the block types (filters) to include. Click **Save & Refresh** to store the changes and fetch a fresh cache in one step.
- **Display:** Adjust the number of blocks, tile size preset, theme, and whether the header or footer is visible. Click **Save display settings** to apply without triggering a cache refresh.
- **Global actions:** Use **Reset to defaults** to load the out-of-box configuration into the form (Image/Text filters, default channels, one block, auto sizing). Choose **Open new tab preview** to view the layout in a separate tab while tweaking options.

