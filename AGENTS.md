# Repository Guidelines

## Project Structure & Module Organization
The extension ships entirely from `extension/`. Browser entry points live in `pages/new-tab.html` and `pages/settings.html`, while background logic and shared utilities sit in `scripts/` (e.g. `scripts/arena.js`, `scripts/background.js`). Styling is centralized in `styles/style.css`, and icons or SVGs stay under `assets/`. Use the `docs/` folder for reference material (`GETTING_STARTED.md`, `style-ref.css`) only—do not include it when packaging the add-on.

## Build, Test, and Development Commands
There is no bundler; load the unpacked `extension/` directory directly in Chrome or Firefox (`chrome://extensions` → Load unpacked, or `about:debugging` → Load Temporary Add-on). Run `node --check extension/scripts/<file>.js` before committing to catch syntax regressions. Use `web-ext run --source-dir extension` if you have Mozilla’s tooling installed for faster iteration, though it remains optional.

## Coding Style & Naming Conventions
All JavaScript is plain ES modules with four-space indentation, dangling semicolons, and camelCase identifiers. Export shared utilities via `scripts/*.js`; keep DOM selectors and constants grouped near the top of modules. Static assets follow kebab-case filenames, while storage keys and enums stay in `SNAKE_CASE` within `scripts/constants.js`. Update `styles/style.css` directly and avoid introducing separate stylesheets unless the change spans an entire view.

## Testing Guidelines
No automated test suite exists today. Validate changes by: 1) loading the unpacked extension; 2) saving settings with test channels to confirm cache refreshes; 3) toggling themes and header/footer options to ensure layout consistency; and 4) clearing `chrome.storage.local` (DevTools > Application) between scenarios to reproduce first-run flows. Document edge-case coverage in the PR description whenever manual testing is required.

## Commit & Pull Request Guidelines
Follow the current history: single-line, present-tense summaries that explain the user-facing effect (e.g. “Add block size selection and improve layout handling”). Group related work per commit. For PRs, describe motivation, implementation notes, and manual test results, and include before/after screenshots or recordings for UI updates. Link relevant Are.na channels or issues so reviewers can verify API expectations.
