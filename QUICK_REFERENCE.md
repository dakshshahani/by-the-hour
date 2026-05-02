# Inline UI - Quick Reference Card

## Your 5 Questions Answered

### 1. Where is the inline UI code located?
- **File:** `content.js` (1,050 lines)
- **Main function:** `ensureInlineControl()` at lines 726-894
- **Type:** Chrome content script (IIFE - Immediately Invoked Function Expression)
- **Runs on:** Every LinkedIn job search results page

### 2. How is it structured (HTML/DOM)?
```html
<div id="bythehour-inline-control">
  <span class="bth-inline-label">Posted within</span>
  <input id="bth-hours" type="number" min="1" value="12" />
  <span class="bth-inline-unit">hours</span>
  <button id="bth-save">Apply</button>
  <span id="bth-status" role="status"></span>
</div>
```
- **Layout:** `display: inline-flex` with 6px gap
- **Responsive:** Compact mode at <760px, wraps at 980px
- **All styles:** Injected via JavaScript (no external CSS)

### 3. How does user adjust hours threshold?

Two methods:
| Method | Trigger | Code |
|--------|---------|------|
| Click | "Apply" button | `click` event listener |
| Enter | Press Enter key | `keydown` event (Enter only) |

Both call: `handleSaveFromUi()` (lines 905-938)

**Flow:**
1. User types number (e.g., "24")
2. Click Apply or press Enter
3. Input validated: must be positive integer
4. Saved to `chrome.storage.sync`
5. Button shows "Saved" (green) for 800ms
6. Filter re-applied immediately

### 4. What event listeners/handlers are attached?

| # | Type | Target | Handler | Lines |
|---|------|--------|---------|-------|
| 1 | `click` | Save button | `handleSaveFromUi()` | 877-879 |
| 2 | `keydown` | Input field | `handleSaveFromUi()` (Enter only) | 881-886 |
| 3 | `chrome.storage.onChanged` | Global | `syncUiFromStorage()` + `runFilter()` | 1017-1034 |
| 4 | `MutationObserver` | DOM body | `ensureInlineControl()` + `runFilter()` | 992-1015 |

**Duplicate prevention:** `container.dataset.bound = "true"` (line 888)

### 5. How does inline UI interact with chrome.storage?

```javascript
// Save (User clicks Apply)
saveMaxHours(24)
  └─ chrome.storage.sync.set({ maxHours: 24 })

// Load (Page initializes)
loadMaxHours()
  └─ chrome.storage.sync.get(['maxHours'])
  └─ Returns: 24 (or 12 if missing)

// Listen (ANY tab/popup changes value)
chrome.storage.onChanged.addListener()
  └─ Updates input field
  └─ Re-applies filter
  └─ Syncs all tabs automatically
```

**Storage key:** `maxHours` (integer, minimum 1, default 12)

---

## Key Implementation Details

### Constants
```javascript
const DEFAULT_MAX_HOURS = 12;
const UI_CONTAINER_ID = "bythehour-inline-control";
const UI_STYLE_ID = "bythehour-inline-style";
const UI_RETRY_INTERVAL_MS = 1200;        // Retry every 1.2s
const UI_RETRY_MAX_ATTEMPTS = 120;        // Up to 120 retries (~2.4 min)
const MIN_RUN_INTERVAL_MS = 1000;         // Filter throttle
```

### CSS Colors
```
Input/Button:  #0a66c2 (LinkedIn Blue)
Success:       #057642 (Green)
Label:         #4b5b6b (Gray)
Border:        #c4ced8 (Light Gray)
```

### Error Handling
```javascript
// Save fails
└─ Show: "Save failed: [error message]"
└─ Re-enable button
└─ DO NOT run filter

// Load fails
└─ Use default: 12 hours
└─ Continue normally

// Input invalid
└─ Show: "Enter a valid number (1 or higher)."
└─ Return without saving
```

### UI Object Reference
```javascript
ui = {
  container,                    // Main div
  input,                        // Number input
  saveButton,                   // "Apply" button
  status                        // Status message
}
```

---

## Function Reference

| Function | Lines | Purpose | Called From |
|----------|-------|---------|-------------|
| `ensureInlineControl()` | 726-894 | Create/mount UI | MutationObserver, init |
| `ensureInlineUiStyle()` | 352-464 | Inject CSS | ensureInlineControl |
| `getLocationMountTarget()` | 575-589 | Find mount point | ensureInlineControl |
| `attachInlineControl()` | 591-626 | Insert to DOM | ensureInlineControl |
| `handleSaveFromUi()` | 905-938 | User saves value | Event listeners |
| `loadMaxHours()` | 301-323 | Read from storage | runFilter, syncUiFromStorage |
| `saveMaxHours()` | 325-341 | Write to storage | handleSaveFromUi |
| `syncUiFromStorage()` | 940-949 | Update UI from storage | chrome.storage.onChanged |
| `parseHoursInput()` | 896-903 | Validate input | handleSaveFromUi |
| `parseAgeFromCard()` | 209-232 | Extract posted time | filterCards |
| `filterCards()` | 234-299 | Apply filter to results | runFilter |
| `setUiStatus()` | 343-350 | Show status message | handleSaveFromUi, syncUiFromStorage |

---

## Data Flow Diagrams

### Save Flow
```
User Input → Validate → Save to Storage → Update All Tabs → Re-apply Filter
```

### Load Flow
```
Page Load → Load from Storage → Sync to UI Input → Apply Filter
```

### Sync Flow (Multi-Tab)
```
Tab A: User saves 24 hours
    ↓
Storage updated
    ↓
Tab B: chrome.storage.onChanged fires
    ↓
Auto-update input + re-apply filter
```

---

## UI States

| State | Appearance | When |
|-------|-----------|------|
| Normal | "Apply" (blue) | Ready for input |
| Disabled | "Apply" (opacity 0.8) | Saving to storage |
| Success | "Saved" (green) | Save successful |
| Error | "Apply" (blue) + red message | Save failed |

---

## Responsive Behavior

| Viewport | Layout | Input Size |
|----------|--------|-----------|
| >760px | Single line | 48px width |
| 760-980px | Single line (compact) | 54px width |
| <980px | Wraps below, full width | 54px width |

---

## Mount Strategies

The UI tries these strategies in order:

1. **results-inner-after-location**
   - After location button in header
   - Sibling insertion: `parent.insertBefore(control, location.nextSibling)`

2. **results-inner-append**
   - Append to results container
   - Child insertion: `container.appendChild(control)`

If location button not found, retry every 1.2s for up to 2.4 minutes.

---

## Common Scenarios

### User Changes Value in Inline UI
1. Types "48" in input field
2. Clicks "Apply"
3. Validates input (must be >= 1)
4. Saves to chrome.storage.sync
5. Shows "Saved" (green button, 800ms)
6. Runs filter with new threshold (48 hours)

### User Changes Value in Popup
1. Opens popup window
2. Changes value to "48"
3. Clicks "Save" in popup
4. Saves to chrome.storage.sync
5. IIFE listener fires: `chrome.storage.onChanged`
6. Inline UI updates automatically
7. Shows status: "Current filter: 48 hour(s)."
8. Filter re-applies in background

### New LinkedIn Page Loaded
1. Content script loads
2. MutationObserver starts
3. Tries to mount inline UI
4. Loads value from storage
5. Applies filter to initial results
6. Watches for new job cards

### Slow-Loading Page
1. Mount fails initially
2. Retry timer scheduled (1.2s interval)
3. Retries up to 120 times (2.4 minutes)
4. Eventually finds location button
5. Mounts inline UI
6. Loads and applies filter

---

## Troubleshooting Quick Guide

| Issue | Solution |
|-------|----------|
| Inline UI not visible | Check: Is location button in header? Retry logic tries for 2.4 min |
| Value not saving | Check: chrome.storage.sync permissions in manifest.json |
| Filter not applying | Check: Job cards must have "ago" text (e.g., "2 hours ago") |
| Value resets to 12 | Check: Storage save failed, check error messages in UI |
| UI appears twice | Check: Page was reloaded, old UI might still be in DOM |

---

## Documentation Cross-Reference

Need more details? See:
- **Quick answers:** INLINE_UI_SUMMARY.txt
- **Detailed analysis:** INLINE_UI_ANALYSIS.md
- **Code snippets:** INLINE_UI_CODE_SNIPPETS.md
- **Visual diagrams:** INLINE_UI_ARCHITECTURE.md
- **Navigation guide:** INLINE_UI_INDEX.md

---

## Source Code Location

**Main file:** `/Users/dakshshahani/Documents/Projects/by-the-hour/content.js`

**Key line ranges:**
- Lines 1-7: Constants
- Lines 37-46: State variables
- Lines 301-341: Storage functions
- Lines 352-464: CSS injection
- Lines 575-626: Mount and attach
- Lines 726-894: Main UI creation
- Lines 877-889: Event listeners
- Lines 905-938: Save handler
- Lines 940-949: Storage sync
- Lines 1017-1034: Storage listener

---

**Last Updated:** May 2, 2026
**Status:** Complete & Accurate

