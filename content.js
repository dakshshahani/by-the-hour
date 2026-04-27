(function byTheHourContentScript() {
  const DEFAULT_MAX_HOURS = 12;
  const AGE_PATTERN = /(\d+)\s*(minute|min|mins|hour|hours|hr|hrs|day|days)\s*ago/i;
  const FILTER_ATTR = "data-bythehour-hidden";
  const HIDDEN_CLASS = "bythehour-hidden";
  const LOG_PREFIX = "[ByTheHour]";
  const MIN_RUN_INTERVAL_MS = 1000;
  const UI_HOST_ID = "bythehour-ui-host";
  const UI_PANEL_WIDTH_PX = 320;
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

  function ensureHiddenStyle() {
    if (document.getElementById("bythehour-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "bythehour-style";
    style.textContent = `.${HIDDEN_CLASS} { display: none !important; }`;
    document.documentElement.appendChild(style);
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

  function setPanelOpen(open) {
    if (!ui) {
      return;
    }

    ui.panel.hidden = !open;
    ui.launcher.setAttribute("aria-expanded", String(open));
    ui.launcher.textContent = open ? "Close ByTheHour" : "ByTheHour";

    if (open) {
      ui.input.focus();
      ui.input.select();
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

  async function initInPageControls() {
    if (ui?.host?.isConnected) {
      return;
    }

    let host = document.getElementById(UI_HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = UI_HOST_ID;
      document.documentElement.appendChild(host);
    }

    const root = host.shadowRoot || host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        * {
          box-sizing: border-box;
          font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        }

        .bth-shell {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 2147483646;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 10px;
          width: min(${UI_PANEL_WIDTH_PX}px, calc(100vw - 20px));
        }

        .bth-launcher,
        .bth-button,
        .bth-close {
          border: 0;
          cursor: pointer;
        }

        .bth-launcher {
          align-self: flex-end;
          padding: 10px 14px;
          border-radius: 999px;
          background: linear-gradient(135deg, #aa451f 0%, #d46b2f 100%);
          color: #ffffff;
          font-weight: 700;
          letter-spacing: 0.01em;
          box-shadow: 0 12px 24px rgba(31, 41, 51, 0.24);
          transition: transform 140ms ease, box-shadow 140ms ease;
        }

        .bth-launcher:hover {
          transform: translateY(-1px);
          box-shadow: 0 14px 28px rgba(31, 41, 51, 0.28);
        }

        .bth-panel {
          width: 100%;
          background: linear-gradient(155deg, #fff7eb 0%, #f7ead8 100%);
          border: 1px solid #e2cfb2;
          border-radius: 16px;
          box-shadow: 0 18px 42px rgba(31, 41, 51, 0.18);
          padding: 14px;
          color: #1f2933;
        }

        .bth-panel[hidden] {
          display: none;
        }

        .bth-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
        }

        .bth-title {
          margin: 0;
          font-size: 16px;
          line-height: 1.2;
          letter-spacing: 0.01em;
        }

        .bth-subtitle {
          margin: 6px 0 12px;
          color: #5d6977;
          font-size: 13px;
        }

        .bth-close {
          width: 26px;
          height: 26px;
          border-radius: 999px;
          background: rgba(31, 41, 51, 0.08);
          color: #24313d;
          font-size: 16px;
          line-height: 1;
        }

        .bth-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          align-items: center;
        }

        .bth-input {
          width: 100%;
          padding: 10px 11px;
          border-radius: 10px;
          border: 1px solid #ccb291;
          background: #fffdf8;
          color: #1f2933;
          font-size: 15px;
        }

        .bth-unit {
          color: #536172;
          font-size: 13px;
          font-weight: 600;
        }

        .bth-actions {
          margin-top: 10px;
          display: flex;
          justify-content: flex-end;
        }

        .bth-button {
          border-radius: 10px;
          padding: 9px 12px;
          background: #b6522f;
          color: #ffffff;
          font-weight: 700;
          letter-spacing: 0.01em;
        }

        .bth-button:disabled {
          opacity: 0.75;
          cursor: default;
        }

        .bth-status {
          min-height: 1em;
          margin: 10px 0 0;
          font-size: 12px;
          color: #5f6c7b;
        }

        .bth-status[data-tone='success'] {
          color: #0f6a4f;
        }

        .bth-status[data-tone='error'] {
          color: #9b2f1f;
        }

        @media (max-width: 640px) {
          .bth-shell {
            right: 10px;
            bottom: 10px;
            width: min(${UI_PANEL_WIDTH_PX}px, calc(100vw - 12px));
          }
        }
      </style>
      <div class="bth-shell">
        <section class="bth-panel" id="bth-panel" hidden>
          <div class="bth-top">
            <div>
              <h2 class="bth-title">ByTheHour</h2>
              <p class="bth-subtitle">Only show jobs posted recently.</p>
            </div>
            <button class="bth-close" id="bth-close" type="button" aria-label="Close panel">x</button>
          </div>

          <div class="bth-row">
            <input id="bth-hours" class="bth-input" type="number" min="1" step="1" value="12" aria-label="Maximum age in hours">
            <span class="bth-unit">hours</span>
          </div>

          <div class="bth-actions">
            <button id="bth-save" class="bth-button" type="button">Apply filter</button>
          </div>

          <p id="bth-status" class="bth-status" role="status" aria-live="polite"></p>
        </section>

        <button id="bth-launcher" class="bth-launcher" type="button" aria-expanded="false" aria-controls="bth-panel">ByTheHour</button>
      </div>
    `;

    ui = {
      host,
      root,
      panel: root.getElementById("bth-panel"),
      launcher: root.getElementById("bth-launcher"),
      closeButton: root.getElementById("bth-close"),
      input: root.getElementById("bth-hours"),
      saveButton: root.getElementById("bth-save"),
      status: root.getElementById("bth-status")
    };

    ui.launcher.addEventListener("click", () => {
      const isOpen = !ui.panel.hidden;
      setPanelOpen(!isOpen);
    });

    ui.closeButton.addEventListener("click", () => {
      setPanelOpen(false);
    });

    ui.saveButton.addEventListener("click", () => {
      handleSaveFromUi();
    });

    ui.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleSaveFromUi();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setPanelOpen(false);
      }
    });

    const currentMaxHours = await loadMaxHours();
    ui.input.value = String(Math.max(1, Math.floor(currentMaxHours)));
    setUiStatus(`Current filter: ${ui.input.value} hour(s).`, "neutral");
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
      }

      runFilter();
    }
  });

  async function init() {
    log("Content script initialized", { readyState: document.readyState, url: window.location.href });
    ensureHiddenStyle();
    await initInPageControls();
    startObserver();
    runFilter();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
