# Inline UI Code Snippets - Key Implementation Details

## SNIPPET 1: CSS Style Injection (Lines 352-464)

```javascript
function ensureInlineUiStyle() {
  if (document.getElementById(UI_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = UI_STYLE_ID;
  style.textContent = `
    #${UI_CONTAINER_ID} {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 6px;
      margin: 0;
      padding: 0;
      border-radius: 0;
      border: 0;
      background: transparent;
      max-width: 100%;
      white-space: nowrap;
      overflow: visible;
      vertical-align: middle;
      line-height: 1;
    }

    #${UI_CONTAINER_ID} .bth-inline-label {
      font-size: 12px;
      color: #4b5b6b;
      font-weight: 600;
      white-space: nowrap;
      line-height: 1;
    }

    #${UI_CONTAINER_ID} .bth-inline-input {
      width: 48px;
      min-width: 40px;
      height: 24px;
      border-radius: 8px;
      border: 1px solid #c4ced8;
      padding: 0 4px;
      font-size: 12px;
      color: #1d2226;
      background: #ffffff;
      line-height: 1;
    }

    #${UI_CONTAINER_ID} .bth-inline-unit {
      font-size: 11px;
      color: #5f6f81;
      font-weight: 600;
      white-space: nowrap;
      line-height: 1;
    }

    #${UI_CONTAINER_ID} .bth-inline-save {
      height: 24px;
      border: 0;
      border-radius: 16px;
      padding: 0 8px;
      background: #0a66c2;                    /* LinkedIn Blue */
      color: #ffffff;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.4s ease;
    }

    #${UI_CONTAINER_ID} .bth-inline-save.bth-saved {
      background: #057642;                   /* Green on save success */
    }

    #${UI_CONTAINER_ID} .bth-inline-save:disabled {
      opacity: 0.8;
      cursor: default;
    }

    #${UI_CONTAINER_ID} .bth-inline-status {
      display: none;
    }

    /* Responsive/Compact Mode */
    #${UI_CONTAINER_ID}.bth-inline-compact .bth-inline-label {
      font-size: 11px;
    }

    #${UI_CONTAINER_ID}.bth-inline-compact .bth-inline-input {
      width: 54px;
      min-width: 54px;
    }

    /* Status Message Colors */
    #${UI_CONTAINER_ID} .bth-inline-status[data-tone='success'] {
      color: #0f6a4f;
    }

    #${UI_CONTAINER_ID} .bth-inline-status[data-tone='error'] {
      color: #9b2f1f;
    }

    /* Mobile Responsive */
    @media (max-width: 980px) {
      #${UI_CONTAINER_ID} {
        margin-left: 0;
        margin-top: 8px;
        flex-wrap: wrap;
      }

      #${UI_CONTAINER_ID} .bth-inline-status {
        max-width: 100%;
        width: 100%;
      }
    }
  `;

  document.documentElement.appendChild(style);
}
```

---

## SNIPPET 2: HTML Structure Creation (Lines 748-754)

```javascript
container.innerHTML = `
  <span class="bth-inline-label">Posted within</span>
  <input id="bth-hours" class="bth-inline-input" type="number" min="1" step="1" value="12" aria-label="Maximum age in hours">
  <span class="bth-inline-unit">hours</span>
  <button id="bth-save" class="bth-inline-save" type="button">Apply</button>
  <span id="bth-status" class="bth-inline-status" role="status" aria-live="polite"></span>
`;
```

**Renders as:**
```
[Posted within] [24      ] [hours] [Apply] [status message]
```

---

## SNIPPET 3: Event Listeners & UI Object Setup (Lines 869-894)

```javascript
ui = {
  container,
  input: container.querySelector("#bth-hours"),
  saveButton: container.querySelector("#bth-save"),
  status: container.querySelector("#bth-status")
};

// Ensure listeners are only attached once
if (!container.dataset.bound) {
  // Listener 1: Click on Apply Button
  ui.saveButton.addEventListener("click", () => {
    handleSaveFromUi();
  });

  // Listener 2: Enter key in Input Field
  ui.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSaveFromUi();
    }
  });

  // Mark as bound to prevent duplicate listeners
  container.dataset.bound = "true";
}

// Set default value if empty
if (!ui.input.value || Number(ui.input.value) < 1) {
  ui.input.value = String(DEFAULT_MAX_HOURS);
}
```

---

## SNIPPET 4: User Interaction Handler (Lines 905-938)

```javascript
async function handleSaveFromUi() {
  if (!ui) {
    return;
  }

  // 1. VALIDATE INPUT
  const parsed = parseHoursInput(ui.input.value);
  if (parsed === null) {
    setUiStatus("Enter a valid number (1 or higher).", "error");
    return;
  }

  // 2. DISABLE UI DURING SAVE
  ui.saveButton.disabled = true;

  // 3. SAVE TO STORAGE
  const result = await saveMaxHours(parsed);

  // 4. HANDLE SAVE FAILURE
  if (!result.ok) {
    ui.saveButton.disabled = false;
    setUiStatus(`Save failed: ${result.error || "Try reloading extension."}`, "error");
    return;
  }

  // 5. SHOW SUCCESS STATE
  ui.saveButton.textContent = "Saved";
  ui.saveButton.classList.add("bth-saved");        // Add green background

  // 6. REVERT SUCCESS STATE AFTER 800ms
  setTimeout(() => {
    if (ui && ui.saveButton) {
      ui.saveButton.classList.remove("bth-saved");
      ui.saveButton.textContent = "Apply";
      ui.saveButton.disabled = false;
    }
  }, 800);

  // 7. IMMEDIATELY APPLY FILTER
  runFilter();
}
```

---

## SNIPPET 5: Storage Integration - Load (Lines 301-323)

```javascript
function loadMaxHours() {
  return new Promise((resolve) => {
    // Check if in valid extension context
    if (!chrome?.runtime?.id) {
      resolve(DEFAULT_MAX_HOURS);
      return;
    }

    // Read from chrome.storage.sync
    chrome.storage.sync.get(["maxHours"], (result) => {
      // Handle chrome errors
      if (chrome.runtime.lastError) {
        resolve(DEFAULT_MAX_HOURS);
        return;
      }

      // Parse and validate
      const parsed = Number(result.maxHours);
      if (Number.isFinite(parsed) && parsed > 0) {
        resolve(parsed);
        return;
      }

      // Fallback to default
      resolve(DEFAULT_MAX_HOURS);
    });
  });
}
```

---

## SNIPPET 6: Storage Integration - Save (Lines 325-341)

```javascript
function saveMaxHours(value) {
  return new Promise((resolve) => {
    // Check if in valid extension context
    if (!chrome?.runtime?.id) {
      resolve({ ok: false, error: "Extension context unavailable." });
      return;
    }

    // Write to chrome.storage.sync
    chrome.storage.sync.set({ maxHours: value }, () => {
      // Handle chrome errors
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      // Success
      resolve({ ok: true });
    });
  });
}
```

---

## SNIPPET 7: Storage Sync to UI (Lines 940-949)

```javascript
async function syncUiFromStorage() {
  if (!ui?.input) {
    return;
  }

  // Load saved value from storage
  const currentMaxHours = await loadMaxHours();
  
  // Update input field
  ui.input.value = String(Math.max(1, Math.floor(currentMaxHours)));
  
  // Update status message
  setUiStatus(`Current filter: ${ui.input.value} hour(s).`, "neutral");
  
  // Set flag to avoid re-loading
  hasLoadedUiValue = true;
}
```

---

## SNIPPET 8: Storage Change Listener (Lines 1017-1034)

```javascript
// Listen for storage changes from ANY source
// (other tabs, popup, background script, etc.)
chrome.storage.onChanged.addListener((changes, areaName) => {
  log("storage.onChanged event", { areaName, keys: Object.keys(changes || {}) });
  
  // Only care about sync storage
  if (areaName !== "sync") {
    return;
  }

  // Check if maxHours was changed
  if (changes.maxHours) {
    log("maxHours changed", { 
      oldValue: changes.maxHours.oldValue, 
      newValue: changes.maxHours.newValue 
    });
    
    // Update UI if it exists
    const parsed = Number(changes.maxHours.newValue);
    if (ui?.input && Number.isFinite(parsed) && parsed > 0) {
      ui.input.value = String(Math.floor(parsed));
      setUiStatus(`Current filter: ${ui.input.value} hour(s).`, "neutral");
      hasLoadedUiValue = true;
    }

    // Re-run filter with new value
    runFilter();
  }
});
```

**Real-world scenario:**
- User has LinkedIn open in Tab A with inline UI
- User opens popup in Tab B and changes value to 48 hours
- Popup saves to chrome.storage.sync
- This listener fires in Tab A's content script
- Inline UI automatically updates to show 48 hours
- Filter is re-applied with new threshold

---

## SNIPPET 9: Status Message Helper (Lines 343-350)

```javascript
function setUiStatus(message, tone) {
  if (!ui?.status) {
    return;
  }

  ui.status.textContent = message;
  ui.status.dataset.tone = tone || "neutral";    // "success", "error", or "neutral"
}
```

**Usage:**
```javascript
setUiStatus("Saved successfully!", "success");    // Green text
setUiStatus("Invalid input.", "error");           // Red text
setUiStatus("Current filter: 24 hours.", "neutral"); // Normal text
```

---

## SNIPPET 10: Input Validation (Lines 896-903)

```javascript
function parseHoursInput(value) {
  const parsed = Number(value);
  
  // Ensure it's a valid positive number
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  // Return as integer
  return Math.floor(parsed);
}
```

**Examples:**
```
parseHoursInput("24")      // 24
parseHoursInput("24.7")    // 24 (floored)
parseHoursInput("0")       // null (< 1)
parseHoursInput("abc")     // null (not a number)
parseHoursInput("")        // null (NaN)
```

---

## SNIPPET 11: UI Mount Target Detection (Lines 575-589)

```javascript
function getLocationMountTarget() {
  const innerContainer = getInnerResultsContainer();
  const locationButton = getLocationButtonInHeader();
  console.log("BTH getLocationMountTarget:", !!innerContainer, !!locationButton);

  // Strategy 1: Mount after location button in header
  if (innerContainer && locationButton?.parentElement) {
    return { 
      mode: "after", 
      node: locationButton, 
      containerNode: innerContainer, 
      strategy: "results-inner-after-location" 
    };
  }

  // Strategy 2: Append to results container
  if (innerContainer) {
    return { 
      mode: "append", 
      node: innerContainer, 
      containerNode: innerContainer, 
      strategy: "results-inner-append" 
    };
  }

  return null;
}
```

**Returns:**
```javascript
{
  mode: "after" | "append" | "prepend",
  node: Element,              // Target element
  containerNode: Element,     // Container for layout context
  strategy: string           // Strategy name for debugging
}
```

---

## SNIPPET 12: Attaching Control to DOM (Lines 591-626)

```javascript
function attachInlineControl(control, target) {
  if (!target || !target.node) {
    return { attached: false, mode: null };
  }

  // Mode 1: Insert AFTER target node
  if (target.mode === "after") {
    const parent = target.node.parentElement;
    if (!parent) {
      return { attached: false, mode: null };
    }

    // Only insert if not already in correct position
    if (control.parentElement !== parent || control.previousElementSibling !== target.node) {
      parent.insertBefore(control, target.node.nextSibling);
    }

    return { attached: true, mode: "after" };
  }

  // Mode 2: APPEND to container
  if (target.mode === "append") {
    if (control.parentElement !== target.node) {
      target.node.appendChild(control);
    }

    return { attached: true, mode: "append" };
  }

  // Mode 3: PREPEND to container
  if (target.mode === "prepend") {
    if (control.parentElement !== target.node || control !== target.node.firstElementChild) {
      target.node.insertBefore(control, target.node.firstChild);
    }

    return { attached: true, mode: "prepend" };
  }

  return { attached: false, mode: null };
}
```

---

## SNIPPET 13: Retry Loop for Persistent UI (Lines 702-724)

```javascript
function scheduleUiRetryLoop() {
  const connectedContainer = document.getElementById(UI_CONTAINER_ID);
  const hasVisibleContainer = connectedContainer
    ? connectedContainer.getBoundingClientRect().width > 40
    : false;
    
  // Skip if already retrying, UI is visible, or max attempts reached
  if (uiRetryTimer !== null || hasVisibleContainer || uiRetryAttempts >= UI_RETRY_MAX_ATTEMPTS) {
    return;
  }

  uiRetryTimer = window.setTimeout(async () => {
    uiRetryTimer = null;
    uiRetryAttempts += 1;
    
    // Try to create/mount UI again
    ensureInlineControl();

    // Load value from storage if not already done
    if (ui?.input && !hasLoadedUiValue) {
      await syncUiFromStorage();
    }

    // If still not connected, schedule another retry
    if (!document.getElementById(UI_CONTAINER_ID)) {
      scheduleUiRetryLoop();
    }
  }, UI_RETRY_INTERVAL_MS);  // Retry every 1.2 seconds
}
```

**Keeps trying for up to:**
```
120 retries × 1200ms = 144,000ms ≈ 2.4 minutes
```

---

## COMPLETE DATA FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────┐
│ USER TYPES IN INLINE UI INPUT FIELD                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │ handleSaveFromUi()           │
        └──────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
    [Validate]  [Disable UI]  [Show Loading]
        │              │              │
        └──────────────┼──────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │ saveMaxHours(value)          │
        │  └─ chrome.storage.sync.set  │
        └──────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │ Storage Updated              │
        └──────────────┬───────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼
    Current Tab              All Other Tabs/Popup
    (Inline UI)              (chrome.storage.onChanged)
        │                             │
        ▼                             ▼
    ┌──────────────┐         ┌──────────────────┐
    │ Show "Saved" │         │ Update UI Value  │
    │ Green button │         │ Sync From Storage│
    │ After 800ms: │         │ Re-apply Filter  │
    │ Revert       │         └──────────────────┘
    └──────────────┘
        │
        ▼
    runFilter()
    Apply new threshold to job cards
```

