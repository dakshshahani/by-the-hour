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

### Prerequisites
- A Chromium-based browser: Chrome, Edge, Brave, or Opera.

### Steps

1. **Download the code** – clone this repo or download and extract the ZIP.
2. Open your browser's extension management page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the project folder (the one containing `manifest.json`).

After loading, the extension is active immediately. No extra build or install step is needed.

### Updating after code changes

1. Go to `chrome://extensions`.
2. Find **ByTheHour**.
3. Click the **🔄 Reload** icon on the card.
4. Refresh any open LinkedIn Jobs tabs.

### Troubleshooting

| Problem | Solution |
|---|---|
| "Load unpacked" button is grayed out | Make sure **Developer mode** is on. |
| Extension doesn't run on LinkedIn | Check that you're on `https://www.linkedin.com/jobs/*`. The extension only activates on LinkedIn Jobs pages. |
| Changes aren't reflected | Reload the extension (see above), then refresh the LinkedIn tab. |
| LinkedIn layout changed and nothing is filtered | The DOM selectors in `content.js` may need updating. |

## Usage

1. Open LinkedIn Jobs search results.
2. Click the ByTheHour extension icon.
3. Set the maximum age in hours and save.
4. Results older than that threshold are hidden automatically.

## Notes and Constraints

- LinkedIn DOM can change, so heuristics may need tuning over time.
- This extension filters visually in the rendered page; it does not modify LinkedIn backend queries.
- Product name: **ByTheHour**
