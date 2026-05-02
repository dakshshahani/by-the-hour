# Inline UI Architecture Diagram

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser Extension                            │
│                     (by-the-hour)                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐      ┌──────────────────┐                  │
│  │   Popup UI       │      │   Content        │                  │
│  │  (popup.html)    │      │   Script         │                  │
│  │  (popup.js)      │      │  (content.js)    │                  │
│  │                  │      │                  │                  │
│  │ User adjusts     │      │ Inline UI        │                  │
│  │ hours via        │◄────►│ mounted on       │                  │
│  │ popup window     │      │ LinkedIn page    │                  │
│  └──────────────────┘      └──────────────────┘                  │
│         ▲                          ▲                              │
│         │                          │                              │
│         └──────────────┬───────────┘                              │
│                        │                                          │
│              ┌──────────▼─────────┐                               │
│              │ chrome.storage.sync │                              │
│              │   { maxHours: 24 }  │                              │
│              └────────────────────┘                               │
│                                                                    │
└─────────────────────────────────────────────────────────────────────┘
```

## Content Script Execution Flow

```
Page Load
   │
   ▼
┌──────────────────────────────────┐
│ content.js IIFE                  │
│ (Immediately Invoked)            │
└────────┬─────────────────────────┘
         │
         ├─ ensureHiddenStyle()
         │  └─ Create hidden CSS for filtered cards
         │
         ├─ startObserver()
         │  └─ Watch for DOM mutations (MutationObserver)
         │
         ├─ initInPageControls()
         │  └─ Try to mount inline UI
         │
         ├─ syncUiFromStorage()
         │  └─ Load saved hours from chrome.storage.sync
         │
         └─ runFilter() after 500ms
            └─ Apply filter to job cards
```

## Inline UI Mount Procedure

```
ensureInlineControl() called
   │
   ├─ ensureInlineUiStyle()
   │  └─ Inject CSS styles (if not already present)
   │
   ├─ getLocationMountTarget()
   │  │
   │  ├─ Find results container
   │  ├─ Find location button
   │  └─ Return mount strategy
   │     ├─ mode: "after" | "append" | "prepend"
   │     ├─ node: target DOM element
   │     └─ strategy: for logging/debugging
   │
   ├─ Create container div
   │  └─ Set innerHTML with all components
   │
   ├─ attachInlineControl(container, target)
   │  └─ Insert container into DOM
   │
   └─ Setup event listeners
      ├─ Click on "Apply" button
      └─ Enter key on input field
```

## Inline UI DOM Structure

```
<div id="bythehour-inline-control">
  │
  ├─ <span class="bth-inline-label">
  │  └─ "Posted within"
  │
  ├─ <input id="bth-hours" 
  │         type="number" 
  │         min="1" 
  │         value="24">
  │
  ├─ <span class="bth-inline-unit">
  │  └─ "hours"
  │
  ├─ <button id="bth-save">
  │  └─ "Apply" (or "Saved" on success)
  │
  └─ <span id="bth-status" role="status">
     └─ Status message (error or info)
```

## User Interaction Flow

```
User Action
   │
   ├─ Types number in input
   │
   └─ Triggers save via:
      ├─ Click "Apply" button
      └─ Press Enter key
         │
         ▼
    handleSaveFromUi()
         │
         ├─ parseHoursInput()
         │  ├─ Validate input
         │  └─ Convert to integer
         │
         ├─ Show loading state
         │  └─ Disable button
         │
         ├─ saveMaxHours(value)
         │  │
         │  └─ chrome.storage.sync.set()
         │
         ├─ Wait for storage
         │
         ├─ Show "Saved" (green)
         │
         ├─ Auto-revert after 800ms
         │
         └─ runFilter()
            └─ Apply new threshold
```

## Storage Synchronization

```
Tab A (Inline UI)                Tab B (Popup)
       │                             │
       │                             │
       │ User types 48               │
       │                             │ User opens popup
       │                             │
       │ Click Apply                 │ Types 48
       │   │                         │
       │   ▼                         │ Click Save
       │ chrome.storage.sync.set     │   │
       │   { maxHours: 48 }          │   ▼
       │                             │ chrome.storage.sync.set
       │                             │   { maxHours: 48 }
       │                             │
       └─────────────┬───────────────┘
                     │
                     ▼
        Storage Updated (sync)
                     │
        ┌────────────┴───────────────┐
        │                            │
        ▼                            ▼
    Tab A                         Tab B
    chrome.storage.onChanged      chrome.storage.onChanged
    fires                         fires
        │                            │
        ▼                            ▼
    syncUiFromStorage()         Update popup input
    Update input: 48            Show: "Saved"
    Show status message         Re-apply filter
    Re-apply filter
```

## Event Listeners Lifecycle

```
Container Creation
   │
   ▼
Check container.dataset.bound
   │
   ├─ If bound = "true"
   │  └─ Skip (listeners already attached)
   │
   └─ If not set
      │
      ├─ Add click listener to button
      │
      ├─ Add keydown listener to input
      │  (filter for Enter key only)
      │
      └─ Set container.dataset.bound = "true"
         (Prevent duplicate listeners)
```

## Filter Execution Flow

```
runFilter() called
   │
   ├─ Load maxHours from storage
   │
   ├─ Get primary job cards
   │
   ├─ For each card:
   │  │
   │  ├─ parseAgeFromCard()
   │  │  └─ Extract posted time (e.g., "2 hours ago")
   │  │
   │  ├─ Compare: cardAge > maxHours?
   │  │
   │  └─ applyCardVisibility()
   │     ├─ If hide=true:
   │     │  └─ Add CSS class + set display: none
   │     │
   │     └─ If hide=false:
   │        └─ Remove CSS class + remove display
   │
   └─ Update results shown
```

## CSS Styling Architecture

```
Injected <style id="bythehour-inline-style">
   │
   ├─ Base Styles
   │  ├─ #bythehour-inline-control
   │  │  └─ display: inline-flex, gap: 6px
   │  │
   │  ├─ .bth-inline-label
   │  │  └─ font-size: 12px, color: #4b5b6b
   │  │
   │  ├─ .bth-inline-input
   │  │  └─ width: 48px, height: 24px
   │  │
   │  ├─ .bth-inline-unit
   │  │  └─ font-size: 11px, color: #5f6f81
   │  │
   │  └─ .bth-inline-save
   │     └─ height: 24px, background: #0a66c2 (LinkedIn blue)
   │
   ├─ State Styles
   │  ├─ .bth-inline-save.bth-saved
   │  │  └─ background: #057642 (green)
   │  │
   │  ├─ .bth-inline-save:disabled
   │  │  └─ opacity: 0.8, cursor: default
   │  │
   │  ├─ .bth-inline-status[data-tone='error']
   │  │  └─ color: #9b2f1f (red)
   │  │
   │  └─ .bth-inline-status[data-tone='success']
   │     └─ color: #0f6a4f (green)
   │
   ├─ Responsive Styles
   │  ├─ .bth-inline-compact
   │  │  └─ font-size: 11px (narrow viewports)
   │  │
   │  └─ @media (max-width: 980px)
   │     └─ flex-wrap: wrap, status full width
   │
   └─ Hidden CSS for Filtered Cards
      └─ .bythehour-hidden { display: none !important; }
```

## Error Handling Paths

```
handleSaveFromUi()
   │
   ├─ Parse Input
   │  │
   │  └─ Invalid?
   │     └─ Show error: "Enter valid number"
   │        └─ Return (no save)
   │
   ├─ Save to Storage
   │  │
   │  ├─ Extension context lost?
   │  │  └─ Return error
   │  │
   │  └─ Chrome error?
   │     └─ Show error message
   │        └─ Re-enable button
   │        └─ Return (filter NOT run)
   │
   ├─ Success
   │  │
   │  ├─ Show "Saved" (800ms)
   │  ├─ runFilter()
   │  └─ Re-enable button
   │
   └─ Always check ui?.input
      (UI might be removed from DOM)
```

## Retry Loop Strategy

```
Initial Mount Attempt
   │
   ├─ Success? ✓
   │  └─ Load from storage + apply filter
   │
   └─ Failed? ✗
      │
      └─ Schedule Retry Loop
         │
         └─ Every 1.2 seconds
            │
            ├─ Retry attempt N (1-120)
            │
            ├─ UI mounted successfully?
            │  │
            │  ├─ Yes → Stop retrying
            │  │
            │  └─ No → Schedule next retry
            │
            └─ Max attempts (120) reached?
               └─ Give up
```

## Data Persistence Flow

```
User Input
   │
   ├─ Save to chrome.storage.sync
   │  └─ Browser native storage
   │
   ├─ Persists across:
   │  ├─ Browser restart
   │  ├─ Extension disable/enable
   │  ├─ All Chrome profiles (if synced)
   │  └─ All device instances
   │
   └─ Retrieved via:
      ├─ loadMaxHours() in inline UI
      ├─ loadSettings() in popup
      └─ Any other extension component
```

## Page Interaction Points

```
LinkedIn Job Search Results Page
   │
   ├─ Document Load
   │  └─ content.js IIFE executes
   │
   ├─ Results Header Section
   │  │
   │  ├─ Location Button (original)
   │  │  └─ "United States" or similar
   │  │
   │  └─ Inline UI Mounted (after location)
   │     └─ "Posted within [24] hours [Apply]"
   │
   ├─ Job Results List
   │  │
   │  └─ Each Card
   │     ├─ Contains posted time
   │     ├─ Parsed via parseAgeFromCard()
   │     └─ Hidden or shown based on threshold
   │
   └─ Page Updates (infinite scroll)
      └─ MutationObserver triggers
         └─ Re-run filter on new cards
```

## Lifecycle Timings

```
Timeline:
   0ms    → Page load, content script executes
   0ms    → Inject hidden CSS
   0ms    → Start MutationObserver
   0ms    → Call initInPageControls()
   0-1200ms → Retry loop attempts (if mount fails)
   500ms  → Initial runFilter() call
   800ms  → Button reverts after showing "Saved"
   1200ms → Each retry attempt (if needed)
   ...    → MutationObserver fires on page changes
   ...    → chrome.storage.onChanged fires on sync
```

## Variable Scope

```
IIFE Closure (content.js)
   │
   ├─ Constants
   │  ├─ DEFAULT_MAX_HOURS = 12
   │  ├─ UI_CONTAINER_ID
   │  ├─ UI_STYLE_ID
   │  ├─ MIN_RUN_INTERVAL_MS
   │  └─ UI_RETRY_* settings
   │
   ├─ State Variables
   │  ├─ observer (MutationObserver)
   │  ├─ scheduled (filter run queued?)
   │  ├─ isApplyingFilter (currently filtering?)
   │  ├─ lastRunAt (timestamp)
   │  ├─ ui (UI object reference)
   │  ├─ uiRetryTimer
   │  ├─ uiRetryAttempts
   │  └─ hasLoadedUiValue
   │
   └─ All hidden from page (no global pollution)
```

## Communication Bridges

```
Inline UI ←→ Chrome API ←→ Chrome Extension Backend
   │              │              │
   ├─ DOM          ├─ storage     ├─ sync storage
   ├─ Input        ├─ runtime     ├─ across devices
   ├─ Events       └─ onChanged   └─ cross-browser
   └─ Storage         listener
      references
```

