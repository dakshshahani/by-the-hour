(function byTheHourContentScript() {
  const DEFAULT_MAX_HOURS = 12;
  const AGE_PATTERN = /(\d+)\s*(minute|min|mins|hour|hours|hr|hrs|day|days)\s*ago/i;
  const FILTER_ATTR = "data-bythehour-hidden";
  const HIDDEN_CLASS = "bythehour-hidden";
  const LOG_PREFIX = "[ByTheHour]";
  const MIN_RUN_INTERVAL_MS = 1000;
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
      runFilter();
    }
  });

  function init() {
    log("Content script initialized", { readyState: document.readyState, url: window.location.href });
    ensureHiddenStyle();
    startObserver();
    runFilter();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
