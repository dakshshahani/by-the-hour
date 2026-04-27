(function byTheHourContentScript() {
  const DEFAULT_MAX_HOURS = 12;
  const AGE_PATTERN = /(\d+)\s*(minute|min|mins|hour|hours|hr|hrs|day|days)\s*ago/i;
  const FILTER_ATTR = "data-bythehour-hidden";
  const LOG_PREFIX = "[ByTheHour]";

  let observer = null;
  let scheduled = false;

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

  function findLikelyCard(node) {
    let current = node;

    while (current && current !== document.body) {
      const parent = current.parentElement;
      const text = (current.innerText || "").trim();
      const parentChildren = parent ? parent.children.length : 0;
      const hasLink = !!current.querySelector("a");

      if (text.length > 80 && text.length < 2500 && parentChildren >= 5 && hasLink) {
        return current;
      }

      current = parent;
    }

    return null;
  }

  function getTimestampNodes() {
    const nodes = Array.from(document.querySelectorAll("span, p, div, small, time"));
    return nodes.filter((node) => isAgeText(node.textContent || ""));
  }

  function applyCardVisibility(card, hide) {
    if (hide) {
      card.style.display = "none";
      card.setAttribute(FILTER_ATTR, "true");
      return;
    }

    if (card.getAttribute(FILTER_ATTR) === "true") {
      card.style.display = "";
      card.removeAttribute(FILTER_ATTR);
    }
  }

  function filterCards(maxHours) {
    const timestampNodes = getTimestampNodes();
    const seen = new Set();
    let matchedTimestamps = 0;
    let matchedCards = 0;
    let hiddenCards = 0;

    log("Starting filter run", {
      maxHours,
      timestampCandidates: timestampNodes.length,
      url: window.location.href
    });

    timestampNodes.forEach((node) => {
      const text = node.textContent || "";
      const hours = parseAgeToHours(text);
      if (hours === null) {
        return;
      }

      matchedTimestamps += 1;

      const card = findLikelyCard(node);
      if (!card || seen.has(card)) {
        if (!card) {
          log("No card container found for timestamp", { text: text.trim(), hours });
        }
        return;
      }

      seen.add(card);
      matchedCards += 1;

      const hide = hours > maxHours;
      applyCardVisibility(card, hide);
      if (hide) {
        hiddenCards += 1;
      }
    });

    log("Filter run complete", {
      matchedTimestamps,
      matchedCards,
      hiddenCards,
      shownCards: Math.max(matchedCards - hiddenCards, 0)
    });
  }

  function loadMaxHours() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(["maxHours"], (result) => {
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
    log("runFilter called");
    const maxHours = await loadMaxHours();
    log("Loaded maxHours", { maxHours });
    filterCards(maxHours);
  }

  function scheduleRunFilter() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    log("Scheduling filter run on next animation frame");
    window.requestAnimationFrame(() => {
      scheduled = false;
      runFilter();
    });
  }

  function startObserver() {
    if (observer) {
      log("MutationObserver already running");
      return;
    }

    observer = new MutationObserver(() => {
      log("DOM mutation detected");
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
    startObserver();
    runFilter();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
