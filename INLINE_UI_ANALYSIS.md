# Inline UI Implementation Analysis - By The Hour Extension

## 1. WHERE IS THE INLINE UI CODE LOCATED?

**Primary File:** `/Users/dakshshahani/Documents/Projects/by-the-hour/content.js`

The inline UI is implemented entirely within the **content.js** file, which is a Chrome content script that runs on LinkedIn job search pages. The key functions are:

- **`ensureInlineControl()`** - Lines 726-894: Main UI creation and mounting
- **`ensureInlineUiStyle()`** - Lines 352-464: CSS styling injection
- **`attachInlineControl()`** - Lines 591-626: DOM attachment logic
- **`handleSaveFromUi()`** - Lines 905-938: User interaction handler
- **`syncUiFromStorage()`** - Lines 940-949: Storage synchronization
- **`getLocationMountTarget()`** - Lines 575-589: Target detection for UI placement

---

## 2. HOW IS IT STRUCTURED (HTML/DOM ELEMENTS)?

### HTML Structure

The inline UI is dynamically created and contains the following DOM elements:

```html
<div id="bythehour-inline-control">
  <span class="bth-inline-label">Posted within</span>
  <input id="bth-hours" class="bth-inline-input" type="number" min="1" step="1" value="12" aria-label="Maximum age in hours">
  <span class="bth-inline-unit">hours</span>
  <button id="bth-save" class="bth-inline-save" type="button">Apply</button>
  <span id="bth-status" class="bth-inline-status" role="status" aria-live="polite"></span>
</div>
```

**Code Location:** Lines 748-754 in content.js

### JavaScript Object Structure

The UI is referenced through a JS object in the `ui` variable:

```javascript
ui = {
  container,                    // The main div#bythehour-inline-control
  input,                        // The input#bth-hours element
  saveButton,                   // The button#bth-save element
  status                        // The span#bth-status element
};
```

**Code Location:** Lines 869-874 in content.js

### CSS Styling

All styling is injected into the page via a `<style>` tag with ID `bythehour-inline-style`.

**Key CSS Classes:**
- `.bth-inline-label` - "Posted within" label text
- `.bth-inline-input` - Number input field
- `.bth-inline-unit` - "hours" unit text
- `.bth-inline-save` - "Apply" button
- `.bth-inline-status` - Status message display
- `.bth-inline-compact` - Responsive variant for narrow screens
- `.bth-saved` - State after successful save

**Code Location:** Lines 352-464 in content.js

---

## 3. HOW DOES THE USER ADJUST THE HOURS THRESHOLD?

### User Interaction Flow

1. **User Types in Input Field**
   - The number input field (id="bth-hours") accepts numeric values
   - Min value: 1, Step: 1

2. **User Triggers Save (Two Methods)**

   **Method A: Click "Apply" Button**
   - Triggers the `click` event listener on the save button
   - Calls `handleSaveFromUi()`

   **Method B: Press Enter Key**
   - Triggers the `keydown` event listener on the input field
   - Only responds to the "Enter" key
   - Also calls `handleSaveFromUi()`

### Code Implementation

**Lines 877-886 (Event Listeners Attachment):**

```javascript
if (!container.dataset.bound) {
  ui.saveButton.addEventListener("click", () => {
    handleSaveFromUi();
  });

  ui.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSaveFromUi();
    }
  });

  container.dataset.bound = "true";
}
```

**Lines 905-938 (Save Handler):**

```javascript
async function handleSaveFromUi() {
  if (!ui) {
    return;
  }

  const parsed = parseHoursInput(ui.input.value);
  if (parsed === null) {
    setUiStatus("Enter a valid number (1 or higher).", "error");
    return;
  }

  ui.saveButton.disabled = true;

  const result = await saveMaxHours(parsed);

  if (!result.ok) {
    ui.saveButton.disabled = false;
    setUiStatus(`Save failed: ${result.error || "Try reloading extension."}`, "error");
    return;
  }

  ui.saveButton.textContent = "Saved";
  ui.saveButton.classList.add("bth-saved");

  setTimeout(() => {
    if (ui && ui.saveButton) {
      ui.saveButton.classList.remove("bth-saved");
      ui.saveButton.textContent = "Apply";
      ui.saveButton.disabled = false;
    }
  }, 800);

  runFilter();
}
```

### User Experience Flow

1. User enters a number in the input field (e.g., 24)
2. User clicks "Apply" or presses Enter
3. Button becomes disabled while saving
4. Value is sent to storage via `saveMaxHours()`
5. Upon success:
   - Button shows "Saved" text with green background
   - After 800ms, button reverts to "Apply" and is re-enabled
   - Filter is immediately applied via `runFilter()`

---

## 4. WHAT EVENT LISTENERS/HANDLERS ARE ATTACHED?

### Direct Event Listeners on UI Elements

**Location:** Lines 877-889

1. **Click Listener on Save Button**
   ```javascript
   ui.saveButton.addEventListener("click", () => {
     handleSaveFromUi();
   });
   ```

2. **Keydown Listener on Input Field**
   ```javascript
   ui.input.addEventListener("keydown", (event) => {
     if (event.key === "Enter") {
       event.preventDefault();
       handleSaveFromUi();
     }
   });
   ```

### Storage Change Listener (Global)

**Location:** Lines 1017-1034

This listener responds to chrome.storage changes from ANY source (e.g., another tab, the popup, etc.):

```javascript
chrome.storage.onChanged.addListener((changes, areaName) => {
  log("storage.onChanged event", { areaName, keys: Object.keys(changes || {}) });
  if (areaName !== "sync") {
    return;
  }

  if (changes.maxHours) {
    log("maxHours changed", { oldValue: changes.maxHours.oldValue, newValue: changes.maxHours.newValue });
    const parsed = Number(changes.maxHours.newValue);
    if (ui?.input && Number.isFinite(parsed) && parsed > 0) {
      ui.input.value = String(Math.floor(parsed));
      setUiStatus(`Current filter: ${ui.input.value} hour(s).`, "neutral");
      hasLoadedUiValue = true;
    }

    runFilter();
  }
});
```

**This is crucial:** If the user changes the value in the popup, it gets synced to the inline UI automatically!

### MutationObserver (DOM Change Detection)

**Location:** Lines 992-1015

The content script watches for DOM mutations to detect when new job cards are loaded or the page layout changes:

```javascript
observer = new MutationObserver(() => {
  if (isApplyingFilter) {
    return;
  }

  ensureInlineControl();
  if (document.readyState === "complete") {
    scheduleRunFilter();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
```

---

## 5. HOW DOES THE INLINE UI INTERACT WITH chrome.storage?

### Storage API Pattern

The extension uses `chrome.storage.sync` (synchronized across devices and Firefox/Chrome):

### A. Loading Values from Storage

**Function: `loadMaxHours()`** - Lines 301-323

```javascript
function loadMaxHours() {
  return new Promise((resolve) => {
    if (!chrome?.runtime?.id) {
      resolve(DEFAULT_MAX_HOURS);
      return;
    }

    chrome.storage.sync.get(["maxHours"], (result) => {
      if (chrome.runtime.lastError) {
        resolve(DEFAULT_MAX_HOURS);
        return;
      }

      const parsed = Number(result.maxHours);
      if (Number.isFinite(parsed) && parsed > 0) {
        resolve(parsed);
        return;
      }

      resolve(DEFAULT_MAX_HOURS);
    });
  });
}
```

**Trigger Points:**
- On initial UI setup via `syncUiFromStorage()` (Line 717)
- When running the filter via `runFilter()` (Line 968)
- When storage changes via the `chrome.storage.onChanged` listener (Line 1025)

### B. Saving Values to Storage

**Function: `saveMaxHours(value)`** - Lines 325-341

```javascript
function saveMaxHours(value) {
  return new Promise((resolve) => {
    if (!chrome?.runtime?.id) {
      resolve({ ok: false, error: "Extension context unavailable." });
      return;
    }

    chrome.storage.sync.set({ maxHours: value }, () => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      resolve({ ok: true });
    });
  });
}
```

**Trigger Points:**
- When user clicks "Apply" or presses Enter in the inline UI
- Called from `handleSaveFromUi()` (Line 918)

### C. Synchronizing UI from Storage

**Function: `syncUiFromStorage()`** - Lines 940-949

```javascript
async function syncUiFromStorage() {
  if (!ui?.input) {
    return;
  }

  const currentMaxHours = await loadMaxHours();
  ui.input.value = String(Math.max(1, Math.floor(currentMaxHours)));
  setUiStatus(`Current filter: ${ui.input.value} hour(s).`, "neutral");
  hasLoadedUiValue = true;
}
```

**Updates:**
- Input field value
- Status message showing current filter
- Sets flag that UI value has been loaded

### Complete Interaction Diagram

```
User Action (Inline UI)
    ↓
handleSaveFromUi()
    ↓
parseHoursInput() - validate
    ↓
saveMaxHours(value)
    ↓
chrome.storage.sync.set({ maxHours: value })
    ↓
Storage Updated
    ↓
chrome.storage.onChanged fires on ALL tabs/popups
    ↓
Update UI + Status message + runFilter()
```

### Error Handling

**In `saveMaxHours()`:**
- Checks if chrome.runtime.id exists (extension context)
- Checks for chrome.runtime.lastError after saving
- Returns object with `{ ok: true }` or `{ ok: false, error: string }`

**In `handleSaveFromUi()`:**
- Validates input before saving
- Disables button during save
- Shows error messages for invalid input
- Shows error messages if storage write fails

**In `loadMaxHours()`:**
- Falls back to DEFAULT_MAX_HOURS (12) on any error
- Validates parsed values are numbers > 0

---

## 6. KEY CONSTANTS

### UI Identifiers
```javascript
const UI_CONTAINER_ID = "bythehour-inline-control";
const UI_STYLE_ID = "bythehour-inline-style";
```

### Retry Configuration
```javascript
const UI_RETRY_INTERVAL_MS = 1200;    // Retry every 1.2 seconds
const UI_RETRY_MAX_ATTEMPTS = 120;    // Up to 120 retries (≈2.4 minutes)
```

### Default Settings
```javascript
const DEFAULT_MAX_HOURS = 12;
```

### Filter Configuration
```javascript
const MIN_RUN_INTERVAL_MS = 1000;     // Throttle filter runs to 1 per second
```

---

## 7. MOUNT STRATEGIES

The inline UI can be mounted in different locations based on what's detected on the page:

**Location:** Lines 575-589 in `getLocationMountTarget()`

```javascript
function getLocationMountTarget() {
  const innerContainer = getInnerResultsContainer();
  const locationButton = getLocationButtonInHeader();

  if (innerContainer && locationButton?.parentElement) {
    return { mode: "after", node: locationButton, containerNode: innerContainer, strategy: "results-inner-after-location" };
  }

  if (innerContainer) {
    return { mode: "append", node: innerContainer, containerNode: innerContainer, strategy: "results-inner-append" };
  }

  return null;
}
```

**Attachment Modes:**
- `after` - Inserted after the location button in the header
- `append` - Appended as a child of the results container
- `prepend` - Inserted as the first child

This ensures the UI stays next to the location filter regardless of layout changes!

