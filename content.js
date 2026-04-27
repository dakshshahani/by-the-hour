(function byTheHourContentScript() {
  const DEFAULT_MAX_HOURS = 12;
  const AGE_PATTERN = /(\d+)\s*(minute|min|mins|hour|hours|hr|hrs|day|days)\s*ago/i;
  const FILTER_ATTR = "data-bythehour-hidden";

  let observer = null;
  let scheduled = false;

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

    timestampNodes.forEach((node) => {
      const text = node.textContent || "";
      const hours = parseAgeToHours(text);
      if (hours === null) {
        return;
      }

      const card = findLikelyCard(node);
      if (!card || seen.has(card)) {
        return;
      }

      seen.add(card);
      applyCardVisibility(card, hours > maxHours);
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
    const maxHours = await loadMaxHours();
    filterCards(maxHours);
  }

  function scheduleRunFilter() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      runFilter();
    });
  }

  function startObserver() {
    if (observer) {
      return;
    }

    observer = new MutationObserver(() => {
      scheduleRunFilter();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

    if (changes.maxHours) {
      runFilter();
    }
  });

  function init() {
    startObserver();
    runFilter();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
