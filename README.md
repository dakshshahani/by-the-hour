# ByTheHour

ByTheHour is a Chrome extension concept for filtering job search results by posting recency ("last X hours") after the page has rendered.

## Project Scope

- Build a browser extension that works on LinkedIn Jobs results pages.
- Let users choose a recency threshold in hours (for example, 6 or 12 hours).
- Parse rendered job timestamp text such as `Posted 14 hours ago`, `14 hours ago`, `45 minutes ago`, or `1 day ago`.
- Keep only cards that match the threshold and hide older results.
- Re-apply filtering when job results update dynamically (infinite scroll, lazy loading, or React re-renders).

## Core Technical Direction

- Use **DOM post-processing** in a content script instead of trying to hook directly into React internals.
- Avoid relying on obfuscated/generated class names because they are unstable across deploys.
- Use text-based timestamp detection + ancestor traversal to find and hide the correct job card container.
- Use a `MutationObserver` to rerun the filter on page updates.

## Why This Approach

- React component names/classes in production are often minified or hashed.
- Stable filtering signal is the human-readable timestamp text in rendered DOM.
- Visual filtering is simpler and more reliable than intercepting network requests (`fetch/XHR`) for this use case.

## Planned Extension Structure

- `manifest.json` - MV3 config, permissions, and content script registration.
- `content.js` - timestamp parsing, card detection, and hide/show logic.
- `popup.html` + `popup.js` - UI for setting `maxHours` and storing preference.
- `chrome.storage.sync` - persist user-selected threshold.

## Functional Requirements

- Parse time formats:
  - minutes (`X minutes ago`)
  - hours (`X hours ago`)
  - days (`X days ago`)
  - optional `just now`
- Convert all formats to a normalized hour value.
- Hide cards with age `> maxHours`; show cards with age `<= maxHours`.
- Ensure duplicate timestamp nodes in a card do not cause duplicate processing.
- Keep behavior resilient to DOM updates.

## Non-Goals (Current)

- Modifying LinkedIn backend queries.
- Deep integration with React component tree.
- Guaranteeing stability based only on hashed CSS class selectors.

## Risks and Constraints

- LinkedIn DOM structure may change over time.
- Some jobs may have inconsistent timestamp phrasing.
- Overly broad ancestor heuristics may hide incorrect containers unless validated.

## Development Plan

1. Scaffold MV3 extension files.
2. Implement timestamp parser and card-finding heuristics in `content.js`.
3. Add popup input for `maxHours` and save to storage.
4. Add mutation-based re-filtering and lightweight debouncing.
5. Validate on multiple result pages and scroll states.

## Validation Checklist

- Confirm only intended job cards are hidden.
- Confirm behavior for 1h, 6h, 12h, 24h thresholds.
- Confirm new cards loaded during scrolling are filtered automatically.
- Confirm refresh/navigation preserves saved threshold.

## Naming

- Product name: **ByTheHour**
- Suggested repo name: `by-the-hour`
- Suggested internal id: `bythehour`
