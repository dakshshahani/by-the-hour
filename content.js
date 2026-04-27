(function byTheHourContentScript() {
  const DEFAULT_MAX_HOURS = 12;
  const AGE_PATTERN = /(\d+)\s*(minute|min|mins|hour|hours|hr|hrs|day|days)\s*ago/i;
  const FILTER_ATTR = "data-bythehour-hidden";
  const HIDDEN_CLASS = "bythehour-hidden";
  const LOG_PREFIX = "[ByTheHour]";
  const MIN_RUN_INTERVAL_MS = 1000;
  const UI_RETRY_INTERVAL_MS = 1200;
  const UI_RETRY_MAX_ATTEMPTS = 20;
  const UI_STYLE_ID = "bythehour-inline-style";
  const UI_CONTAINER_ID = "bythehour-inline-control";
  const LOCATION_WRAPPER_SELECTORS = [
    ".jobs-search-box__location-input",
    ".jobs-search-box__location",
    "[class*='jobs-search-box__location']",
    "[data-job-search-box-input='location']"
  ];
  const SEARCH_BOX_FALLBACK_SELECTORS = [
    ".jobs-search-box__inner",
    ".jobs-search-box",
    ".jobs-search-two-pane__wrapper",
    ".jobs-search-results-list__header",
    "form[role='search']",
    "header [class*='search']",
    "main",
    "body"
  ];
  const LOCATION_INPUT_SELECTORS = [
    "input[aria-label*='Search by location']",
    "input[aria-label*='City, state, or zip code']",
    "input[aria-label*='City']",
    "input[aria-label*='city']",
    "input[placeholder*='City']",
    "input[placeholder*='location']",
    "input[id*='jobs-search-box-location-id']",
    "input[aria-label*='location']"
  ];
  const RESULT_ROOT_SELECTORS = [
    ".jobs-search-results-list",
    "ul.scaffold-layout__list-container",
    ".scaffold-layout__list"
  ];
  const PRIMARY_CARD_SELECTORS = [
    "li.scaffold-layout__list-item",
    "li.jobs-search-results__list-item",
    "li[data-occludable-job-id]"
  ];
  const CARD_SELECTORS = [
    "li.scaffold-layout__list-item",
    "li.jobs-search-results__list-item",
    "div.job-card-container",
    "li[data-occludable-job-id]",
    "article",
    "li",
    "[role='listitem']"
  ];

  let observer = null;
  let scheduled = false;
  let isApplyingFilter = false;
  let lastRunAt = 0;
  let ui = null;
  let uiMountMode = null;
  let hasLoadedUiValue = false;
  let uiRetryTimer = null;
  let uiRetryAttempts = 0;

  function ensureHiddenStyle() {
    if (document.getElementById("bythehour-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "bythehour-style";
    style.textContent = `.${HIDDEN_CLASS} { display: none !important; }`;
    document.documentElement.appendChild(style);
  }

  function ensureUiInitDebugLog() {
    if (window.__BYTHEHOUR_UI_LOGGED__) {
      return;
    }

    window.__BYTHEHOUR_UI_LOGGED__ = true;
    log("Inline UI integration enabled");
  }

  function log(message, extra) {
    if (typeof extra === "undefined") {
      console.log(`${LOG_PREFIX} ${message}`);
      return;
    }

    console.log(`${LOG_PREFIX} ${message}`, extra);
  }

  function parseAgeToHours(text) {
    const value = (text || "").trim().toLowerCase();
    if (!value) {
      return null;
    }

    if (value.includes("just now")) {
      return 0;
    }

    const match = value.match(AGE_PATTERN);
    if (!match) {
      return null;
    }

    const amount = Number(match[1]);
    const unit = match[2];

    if (!Number.isFinite(amount)) {
      return null;
    }

    if (unit.startsWith("day")) {
      return amount * 24;
    }

    if (unit.startsWith("hour") || unit.startsWith("hr")) {
      return amount;
    }

    return amount / 60;
  }

  function isAgeText(text) {
    const value = (text || "").trim().toLowerCase();
    if (!value) {
      return false;
    }

    return value === "just now" || /^(posted\s+)?\d+\s*(minute|min|mins|hour|hours|hr|hrs|day|days)\s*ago$/.test(value);
  }

  function getResultRoots() {
    const roots = [];
    RESULT_ROOT_SELECTORS.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => roots.push(node));
    });

    return roots;
  }

  function findLikelyCard(node) {
    for (const selector of CARD_SELECTORS) {
      const hit = node.closest(selector);
      if (hit) {
        return hit;
      }
    }

    let current = node;

    while (current && current !== document.body) {
      const parent = current.parentElement;
      const text = (current.innerText || "").trim();
      const parentChildren = parent ? parent.children.length : 0;
      const childCount = current.children ? current.children.length : 0;

      if (text.length > 40 && text.length < 4000 && parentChildren >= 2 && childCount >= 1) {
        return current;
      }

      current = parent;
    }

    return null;
  }

  function getTimestampNodes() {
    const roots = getResultRoots();
    const scope = roots.length > 0 ? roots : [document];
    const nodes = [];

    scope.forEach((root) => {
      root.querySelectorAll("span, p, div, small, time").forEach((node) => nodes.push(node));
    });

    return nodes.filter((node) => {
      const text = (node.textContent || "").trim();
      if (!/\bago\b/i.test(text) && !/just now/i.test(text)) {
        return false;
      }

      return parseAgeToHours(text) !== null;
    });
  }

  function unhidePreviouslyFilteredCards() {
    const previouslyHidden = document.querySelectorAll(`[${FILTER_ATTR}='true']`);
    previouslyHidden.forEach((card) => {
      card.classList.remove(HIDDEN_CLASS);
      card.style.removeProperty("display");
      card.removeAttribute(FILTER_ATTR);
    });
  }

  function applyCardVisibility(card, hide) {
    if (hide) {
      card.classList.add(HIDDEN_CLASS);
      card.style.setProperty("display", "none", "important");
      card.setAttribute(FILTER_ATTR, "true");
      return;
    }

    if (card.getAttribute(FILTER_ATTR) === "true") {
      card.classList.remove(HIDDEN_CLASS);
      card.style.removeProperty("display");
      card.removeAttribute(FILTER_ATTR);
    }
  }

  function getPrimaryCards() {
    const roots = getResultRoots();
    const scope = roots.length > 0 ? roots : [document];

    for (const root of scope) {
      for (const selector of PRIMARY_CARD_SELECTORS) {
        const cards = Array.from(root.querySelectorAll(selector)).filter((card) => {
          return !!card.querySelector("a[href*='/jobs/view/']");
        });

        if (cards.length > 0) {
          return cards;
        }
      }
    }

    return [];
  }

  function parseAgeFromCard(card) {
    const nodes = Array.from(card.querySelectorAll("span, p, div, small, time"));
    const hoursFound = [];

    for (const node of nodes) {
      const text = (node.textContent || "").trim();
      if (!/\bago\b/i.test(text) && !/just now/i.test(text)) {
        continue;
      }

      const hours = parseAgeToHours(text);
      if (hours === null) {
        continue;
      }

      hoursFound.push(hours);
    }

    if (hoursFound.length > 0) {
      return Math.max(...hoursFound);
    }

    return null;
  }

  function filterCards(maxHours) {
    isApplyingFilter = true;

    try {
      unhidePreviouslyFilteredCards();

      let matchedTimestamps = 0;
      let matchedCards = 0;
      let hiddenCards = 0;

      const primaryCards = getPrimaryCards();
      const threshold = Number(maxHours);

      log("Starting filter run", {
        maxHours: threshold,
        primaryCards: primaryCards.length,
        url: window.location.href
      });

      if (primaryCards.length > 0) {
        const sampledAges = [];

        primaryCards.forEach((card) => {
          const hours = parseAgeFromCard(card);
          if (hours === null) {
            return;
          }

          if (sampledAges.length < 10) {
            sampledAges.push(hours);
          }

          matchedTimestamps += 1;
          matchedCards += 1;

          const hide = Number(hours) > threshold;
          applyCardVisibility(card, hide);
          if (hide) {
            hiddenCards += 1;
          }
        });

        log("Primary card age sample", { sampledAges });
      } else {
        const timestampNodes = getTimestampNodes();
        const cardToHours = new Map();

        timestampNodes.forEach((node, index) => {
          const text = node.textContent || "";
          const hours = parseAgeToHours(text);
          if (hours === null) {
            return;
          }

          matchedTimestamps += 1;

          const card = findLikelyCard(node);
          if (!card) {
            if (!card && index < 8) {
              log("No card container found for timestamp", { text: text.trim(), hours });
            }
            return;
          }

          const existing = cardToHours.get(card);
          if (typeof existing === "number") {
            cardToHours.set(card, Math.max(existing, hours));
          } else {
            cardToHours.set(card, hours);
          }
        });

        const sampledAges = [];
        cardToHours.forEach((hours, card) => {
          matchedCards += 1;

          if (sampledAges.length < 10) {
            sampledAges.push(hours);
          }

          const hide = Number(hours) > threshold;
          applyCardVisibility(card, hide);
          if (hide) {
            hiddenCards += 1;
          }
        });

        log("Fallback card age sample", { sampledAges });
      }

      log("Filter run complete", {
        matchedTimestamps,
        matchedCards,
        hiddenCards,
        shownCards: Math.max(matchedCards - hiddenCards, 0)
      });
    } finally {
      isApplyingFilter = false;
    }
  }

  function loadMaxHours() {
    return new Promise((resolve) => {
      if (!chrome?.runtime?.id) {
        resolve(DEFAULT_MAX_HOURS);
        return;
      }

      chrome.storage.sync.get(["maxHours"], (result) => {
        if (chrome.runtime.lastError) {
          log("storage.get failed", { error: chrome.runtime.lastError.message });
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

  function setUiStatus(message, tone) {
    if (!ui?.status) {
      return;
    }

    ui.status.textContent = message;
    ui.status.dataset.tone = tone || "neutral";
  }

  function ensureInlineUiStyle() {
    if (document.getElementById(UI_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = UI_STYLE_ID;
    style.textContent = `
      #${UI_CONTAINER_ID} {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-left: 10px;
        padding: 6px 10px;
        border-radius: 10px;
        border: 1px solid #d4dbe3;
        background: linear-gradient(135deg, #ffffff 0%, #f6f8fa 100%);
        max-width: 100%;
      }

      #${UI_CONTAINER_ID} .bth-inline-label {
        font-size: 12px;
        color: #4b5b6b;
        font-weight: 600;
        white-space: nowrap;
      }

      #${UI_CONTAINER_ID} .bth-inline-input {
        width: 64px;
        min-width: 56px;
        height: 32px;
        border-radius: 8px;
        border: 1px solid #c4ced8;
        padding: 0 8px;
        font-size: 14px;
        color: #1d2226;
        background: #ffffff;
      }

      #${UI_CONTAINER_ID} .bth-inline-unit {
        font-size: 12px;
        color: #5f6f81;
        font-weight: 600;
        white-space: nowrap;
      }

      #${UI_CONTAINER_ID} .bth-inline-save {
        height: 32px;
        border: 0;
        border-radius: 16px;
        padding: 0 12px;
        background: #0a66c2;
        color: #ffffff;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }

      #${UI_CONTAINER_ID} .bth-inline-save:disabled {
        opacity: 0.8;
        cursor: default;
      }

      #${UI_CONTAINER_ID} .bth-inline-status {
        font-size: 12px;
        color: #5f6f81;
        max-width: 220px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #${UI_CONTAINER_ID} .bth-inline-status[data-tone='success'] {
        color: #0f6a4f;
      }

      #${UI_CONTAINER_ID} .bth-inline-status[data-tone='error'] {
        color: #9b2f1f;
      }

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

  function findLocationInput() {
    for (const selector of LOCATION_INPUT_SELECTORS) {
      const input = document.querySelector(selector);
      if (input) {
        return input;
      }
    }

    return null;
  }

  function findLocationWrapper() {
    for (const selector of LOCATION_WRAPPER_SELECTORS) {
      const node = document.querySelector(selector);
      if (node) {
        return node;
      }
    }

    return null;
  }

  function getLocationMountTarget() {
    const locationWrapper = findLocationWrapper();
    if (locationWrapper?.parentElement) {
      return { mode: "after", node: locationWrapper };
    }

    const locationInput = findLocationInput();
    if (locationInput) {
      const closestWrapper =
        locationInput.closest(".jobs-search-box__location-input") ||
        locationInput.closest(".jobs-search-box__inner") ||
        locationInput.closest(".jobs-search-box__input") ||
        locationInput.closest("[class*='jobs-search-box']") ||
        locationInput.parentElement;

      if (closestWrapper?.parentElement) {
        return { mode: "after", node: closestWrapper };
      }
    }

    for (const selector of SEARCH_BOX_FALLBACK_SELECTORS) {
      const fallback = document.querySelector(selector);
      if (fallback) {
        if (selector === "main" || selector === "body") {
          return { mode: "prepend", node: fallback };
        }

        return { mode: "append", node: fallback };
      }
    }

    return null;
  }

  function attachInlineControl(control, target) {
    if (!target || !target.node) {
      return { attached: false, mode: null };
    }

    if (target.mode === "after") {
      const parent = target.node.parentElement;
      if (!parent) {
        return { attached: false, mode: null };
      }

      if (control.parentElement !== parent || control.previousElementSibling !== target.node) {
        parent.insertBefore(control, target.node.nextSibling);
      }

      return { attached: true, mode: "after" };
    }

    if (target.mode === "append") {
      if (control.parentElement !== target.node) {
        target.node.appendChild(control);
      }

      return { attached: true, mode: "append" };
    }

    if (target.mode === "prepend") {
      if (control.parentElement !== target.node || control !== target.node.firstElementChild) {
        target.node.insertBefore(control, target.node.firstChild);
      }

      return { attached: true, mode: "prepend" };
    }

    return { attached: false, mode: null };
  }

  function stopUiRetryLoop() {
    if (uiRetryTimer !== null) {
      window.clearTimeout(uiRetryTimer);
      uiRetryTimer = null;
    }
  }

  function scheduleUiRetryLoop() {
    const hasConnectedContainer = !!document.getElementById(UI_CONTAINER_ID);
    if (uiRetryTimer !== null || hasConnectedContainer || uiRetryAttempts >= UI_RETRY_MAX_ATTEMPTS) {
      return;
    }

    uiRetryTimer = window.setTimeout(async () => {
      uiRetryTimer = null;
      uiRetryAttempts += 1;
      ensureInlineControl();

      if (ui?.input && !hasLoadedUiValue) {
        await syncUiFromStorage();
      }

      if (!document.getElementById(UI_CONTAINER_ID)) {
        scheduleUiRetryLoop();
      }
    }, UI_RETRY_INTERVAL_MS);
  }

  function ensureInlineControl() {
    ensureInlineUiStyle();

    const mountTarget = getLocationMountTarget();
    if (!mountTarget) {
      log("Inline UI mount target not found yet");
      scheduleUiRetryLoop();
      return;
    }

    let container = document.getElementById(UI_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = UI_CONTAINER_ID;
      hasLoadedUiValue = false;
      container.innerHTML = `
        <span class="bth-inline-label">Posted within</span>
        <input id="bth-hours" class="bth-inline-input" type="number" min="1" step="1" value="12" aria-label="Maximum age in hours">
        <span class="bth-inline-unit">hours</span>
        <button id="bth-save" class="bth-inline-save" type="button">Apply</button>
        <span id="bth-status" class="bth-inline-status" role="status" aria-live="polite"></span>
      `;
    }

    const attachResult = attachInlineControl(container, mountTarget);
    if (!attachResult.attached) {
      log("Inline UI attach attempt failed", { mode: mountTarget.mode });
      scheduleUiRetryLoop();
      return;
    }

    uiMountMode = attachResult.mode;
    if (uiMountMode === "append" || uiMountMode === "prepend") {
      container.style.marginLeft = "0";
      container.style.marginTop = "8px";
      container.style.width = "fit-content";
    } else {
      container.style.marginLeft = "10px";
      container.style.marginTop = "0";
      container.style.width = "";
    }

    stopUiRetryLoop();
    uiRetryAttempts = 0;

    ui = {
      container,
      input: container.querySelector("#bth-hours"),
      saveButton: container.querySelector("#bth-save"),
      status: container.querySelector("#bth-status")
    };

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

    if (!ui.input.value || Number(ui.input.value) < 1) {
      ui.input.value = String(DEFAULT_MAX_HOURS);
    }
  }

  function parseHoursInput(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return null;
    }

    return Math.floor(parsed);
  }

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
    setUiStatus("Saving...", "neutral");

    const result = await saveMaxHours(parsed);
    ui.saveButton.disabled = false;

    if (!result.ok) {
      setUiStatus(`Save failed: ${result.error || "Try reloading extension."}`, "error");
      return;
    }

    setUiStatus(`Saved. Showing jobs from last ${parsed} hour(s).`, "success");
    runFilter();
  }

  async function syncUiFromStorage() {
    if (!ui?.input) {
      return;
    }

    const currentMaxHours = await loadMaxHours();
    ui.input.value = String(Math.max(1, Math.floor(currentMaxHours)));
    setUiStatus(`Current filter: ${ui.input.value} hour(s).`, "neutral");
    hasLoadedUiValue = true;
  }

  async function initInPageControls() {
    ensureInlineControl();
    if (!hasLoadedUiValue && ui?.input) {
      await syncUiFromStorage();
      return;
    }

    scheduleUiRetryLoop();
  }

  async function runFilter() {
    if (isApplyingFilter) {
      return;
    }

    log("runFilter called");
    try {
      const maxHours = await loadMaxHours();
      log("Loaded maxHours", { maxHours });
      filterCards(maxHours);
      lastRunAt = Date.now();
    } catch (error) {
      log("runFilter failed", { error: String(error) });
    }
  }

  function scheduleRunFilter() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    const wait = Math.max(0, MIN_RUN_INTERVAL_MS - (Date.now() - lastRunAt));
    log("Scheduling filter run on next animation frame");
    window.setTimeout(() => {
      scheduled = false;
      ensureInlineControl();
      runFilter();
    }, wait);
  }

  function startObserver() {
    if (observer) {
      log("MutationObserver already running");
      return;
    }

    observer = new MutationObserver(() => {
      if (isApplyingFilter) {
        return;
      }

      ensureInlineControl();
      scheduleRunFilter();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    log("MutationObserver started");
  }

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

  async function init() {
    log("Content script initialized", { readyState: document.readyState, url: window.location.href });
    ensureHiddenStyle();
    ensureUiInitDebugLog();
    startObserver();
    await initInPageControls();
    runFilter();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
