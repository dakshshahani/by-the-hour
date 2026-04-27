# ByTheHour

ByTheHour is a Chrome extension for LinkedIn Jobs that filters results by posting recency after the page renders.

## Scope

- Users set a threshold in hours (for example, 6 or 12).
- The extension detects timestamp text such as `Posted 14 hours ago`, `14 hours ago`, `45 minutes ago`, and `1 day ago`.
- It hides cards older than the selected threshold.
- It reruns automatically as results update dynamically.

## Approach

- Use DOM post-processing in a content script.
- Do not depend on hashed/minified class names.
- Use timestamp text matching plus ancestor traversal to find the full job card.
- Use `MutationObserver` to keep filtering applied while scrolling and updating.

## Project Structure

- `manifest.json` - Chrome Extension Manifest V3 setup.
- `content.js` - parsing, card detection, and filtering logic.
- `popup.html` - extension popup UI.
- `popup.css` - popup styling.
- `popup.js` - threshold save/load via `chrome.storage.sync`.

## Install (Local)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder (`by-the-hour`).

## Usage

1. Open LinkedIn Jobs search results.
2. Click the ByTheHour extension icon.
3. Set the maximum age in hours and save.
4. Results older than that threshold are hidden automatically.

## Notes and Constraints

- LinkedIn DOM can change, so heuristics may need tuning over time.
- This extension filters visually in the rendered page; it does not modify LinkedIn backend queries.
- Product name: **ByTheHour**
