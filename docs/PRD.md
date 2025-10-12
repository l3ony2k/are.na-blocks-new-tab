Of course. Here is a structured Product Requirements Document (PRD) based on your request for a new tab browser extension for Are.na.

***

## Product Requirements Document: are.na blocks new tab (ABNT)

### 1. Overview
This document outlines the requirements for a cross-browser (Chrome & Firefox) new tab extension designed for [Are.na](https://www.are.na/) users. The extension will replace the default new tab page with a dynamic display of random blocks from user-specified Are.na channels or block lists. The goal is to provide users with a personalized, inspirational, and functional start page that surfaces their saved content and provides quick access to browser bookmarks.

---

### 2. Goals & Objectives
* **Provide Inspiration:** Surface random, forgotten, or new content from a user's collection to spark creativity and new ideas.
* **Enhance Productivity:** Integrate essential browser bookmarks directly into the new tab page for quick access.
* **Increase Engagement:** Create a deeper, more frequent connection with a user's own curated content on Are.na.
* **Offer Personalization:** Give users robust control over the look, feel, and content of their new tab page.

---

### 3. Target Audience
This extension is for active Are.na users, including designers, researchers, artists, students, and anyone who uses the platform for collection and inspiration. They value aesthetics, customization, and seamless integration with their existing workflows.

---

### 4. Core Features

#### **4.1 Main New Tab View**
The main view is the default screen a user sees when opening a new tab. It is composed of three configurable sections.

* **Header Bar:**
    * Displays the user's native browser bookmarks bar for easy navigation.
    * This section can be toggled on/off in the settings.

* **Main Display Area:**
    * Displays one or more random blocks fetched from the user-defined sources.
    * Each block is presented within a container that has a defined `max-width` and `max-height` to ensure a clean layout.
    * Each displayed block must contain:
        * **Block Content:** The image, text, or a representation of the link/attachment.
        * **Block Title:** The title of the block.
        * **Block Description:** The description text, if available.
        * **Are.na Link:** An Are.na logo or icon that links directly to the original block on the Are.na website. 

* **Footer Bar:**
    * Displays "About" information for the extension (e.g., version, developer, link to a project page).
    * Contains a "Settings" or gear icon button that opens the Settings page.
    * This section can be toggled on/off in the settings.

#### **4.2 Settings Page**
The settings page allows the user to customize the extension's behavior and appearance.

* **Content Source Configuration:**
    * Users must define a source for the blocks.
    * **Input Field for Channels:** A text area where users can input one or more Are.na channel **slugs**, separated by commas (e.g., `design-inspiration, architectural-brutalism`).
    * **Input Field for Blocks:** A text area where users can input one or more specific block **IDs**, separated by commas.
    * *Logic Note:* The system will pull from all specified sources to create a unified pool of blocks to choose from.

* **Display & Layout Customization:**
    * **Number of Blocks:** A setting (e.g., a number input or dropdown) to select how many blocks are displayed on the new tab page at once (e.g., 1, 3, 5).
    * **Header Bar Toggle:** A switch to show or hide the Header Bar.
    * **Footer Bar Toggle:** A switch to show or hide the Footer Bar.

* **Content Filtering:**
    * A set of checkboxes allowing users to filter which block types they want to see. Options must include:
        * `Image`
        * `Text`
        * `Link`
        * `Attachment`
        * `Embed`
        * `Channel`

* **Theme Selection:**
    * Radio buttons for theme selection with three options:
        * **Light:** Forces a light theme.
        * **Dark:** Forces a dark theme.
        * **System:** Automatically syncs with the user's operating system theme.

---

### 5. Technical Logic & Requirements

* **Cross-Browser Compatibility:** The extension must be built using the **WebExtensions API** to ensure compatibility with both Google Chrome and Mozilla Firefox.

* **Are.na API Integration:**
    * The extension will use the public Are.na API to fetch data for channels and blocks.
    * No user authentication (OAuth) is required for V1, as it will only access public channels.

* **Randomization Logic:**
    * On each new tab load, the extension will randomly select one or more block IDs from the cached pool of available blocks.
    * It will then display the content for the selected block(s).

* **Caching Strategy:**
    1.  **Initial Fetch:** When a user saves their source settings (channel/block slugs), the extension will make API calls to fetch all the block IDs from the specified sources.
    2.  **Local Storage:** This compiled list of block IDs and their essential metadata (title, type, etc.) will be stored in the browser's local storage (`chrome.storage` or `localStorage`). This becomes the **source cache**.
    3.  **New Tab Load:** On a new tab load, the extension reads directly from the local cache instead of making a new API call. This ensures the page loads instantly and respects API rate limits.
    4.  **Cache Refresh:** A mechanism should be in place to refresh the cache. This could be a manual "Refresh Sources" button in the settings or an automatic refresh that runs periodically (e.g., every 24 hours).

---

### 6. Out of Scope (Future Enhancements)
* User authentication (OAuth) to access private and secret channels.
* Advanced layout options (e.g., masonry grid, feed).
* Ability to "pin" a block to keep it on the new tab page.
* In-extension actions (e.g., add a displayed block to another channel).
