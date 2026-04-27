(function byTheHourContentScript() {
  const DEFAULT_MAX_HOURS = 12;
  const AGE_PATTERN = /(\d+)\s*(minute|min|mins|hour|hours|hr|hrs|day|days)\s*ago/i;
  const FILTER_ATTR = "data-bythehour-hidden";
  const HIDDEN_CLASS = "bythehour-hidden";
  const LOG_PREFIX = "[ByTheHour]";
  const MIN_RUN_INTERVAL_MS = 1000;
  const UI_RETRY_INTERVAL_MS = 1200;
  const UI_RETRY_MAX_ATTEMPTS = 120;
  const UI_STYLE_ID = "bythehour-inline-style";
  const UI_CONTAINER_ID = "bythehour-inline-control";
  const TOP_BAR_MAX_Y = 320;
  const RESULTS_HEADER_MIN_Y = 150;
  const RESULTS_HEADER_MAX_Y = 420;
  const RESULTS_HEADER_HINT_PATTERN = /\bresults\b/i;
  const NON_LOCATION_BUTTON_TEXT_PATTERN = /(promoted|ranked|jobs|results|filters|date posted|applicants|experience|employment)/i;
  const LOCATION_HINT_PATTERN = /(location|city|state|zip|postal)/i;
  const LOCATION_WRAPPER_SELECTORS = [
    ".jobs-search-box__location-input",
    ".jobs-search-box__location",
    "[class*='jobs-search-box__location']",
    "[data-job-search-box-input='location']"
  ];
  const SEARCH_FORM_SELECTORS = [
    ".jobs-search-box__form",
    "form[action*='/jobs/search']",
    "form[role='search']",
    "[class*='jobs-search-box'] form",
    ".jobs-search-box"
  ];
  const SEARCH_BOX_FALLBACK_SELECTORS = [
    ".jobs-search-box__form",
    ".jobs-search-box__inner",
    ".jobs-search-box",
    "[class*='jobs-search-box'] form",
    "form[role='search']",
    "form[action*='/jobs/search']"
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
  const RESULTS_COUNT_ROW_SELECTORS = [
    ".jobs-search-results-list__subtitle",
    ".jobs-search-results-list__title-heading",
    "[class*='jobs-search-results-list'] .pb2",
    "[class*='jobs-search-results-list'] .jobs-search-results-list__text",
    "main#workspace header > div",
    "main#workspace header"
  ];
  const RESULTS_HEADER_SELECTORS = [
    "main#workspace header",
    "main#workspace > div > header",
    "main header",
    "header"
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
  let uiMountStrategy = null;
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
        flex: 0 0 auto;
        align-items: center;
        gap: 8px;
        margin-left: 10px;
        padding: 0;
        border-radius: 0;
        border: 0;
        background: transparent;
        max-width: 100%;
        white-space: nowrap;
        overflow: visible;
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
        transition: all 0.4s ease;
      }

      #${UI_CONTAINER_ID} .bth-inline-save.bth-saved {
        background: #057642;
      }

      #${UI_CONTAINER_ID} .bth-inline-save:disabled {
        opacity: 0.8;
        cursor: default;
      }

      #${UI_CONTAINER_ID} .bth-inline-status {
        display: none;
      }

      #${UI_CONTAINER_ID}.bth-inline-compact .bth-inline-label {
        font-size: 11px;
      }

      #${UI_CONTAINER_ID}.bth-inline-compact .bth-inline-input {
        width: 54px;
        min-width: 54px;
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

  function inputLooksLikeLocation(input) {
    if (!input) {
      return false;
    }

    const ariaLabel = input.getAttribute("aria-label") || "";
    const placeholder = input.getAttribute("placeholder") || "";
    const id = input.id || "";
    const name = input.getAttribute("name") || "";
    const combined = `${ariaLabel} ${placeholder} ${id} ${name}`;
    return LOCATION_HINT_PATTERN.test(combined);
  }

  function normalizeNodeText(node) {
    return (node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isLikelyLocationButton(node) {
    if (!node) {
      return false;
    }

    const text = normalizeNodeText(node);
    if (!text || text.length < 2 || text.length > 60) {
      return false;
    }

    if (/\d/.test(text)) {
      return false;
    }

    if (NON_LOCATION_BUTTON_TEXT_PATTERN.test(text)) {
      return false;
    }

    if (!/[a-z]/i.test(text)) {
      return false;
    }

    const locationIndicators = [
      /^(united states|united kingdom|canada|australia|germany|france|india|china|japan|brazil|mexico|singapore|netherlands|ireland|switzerland)$/i,
      /^(new york|san francisco|los angeles|chicago|boston|seattle|austin|denver|miami|atlanta)$/i,
      /^[a-z]+,?\s*[a-z]{2,3}$/i
    ];

    const isExplicitLocation = locationIndicators.some(regex => regex.test(text));
    const role = node.getAttribute && node.getAttribute("role");
    const tagName = node.tagName && node.tagName.toLowerCase();

    if (isExplicitLocation && (role === "button" || tagName === "button" || tagName === "a")) {
      return true;
    }

    return false;
  }

  function getResultsHeaderRoot() {
    const candidates = [];

    for (const selector of RESULTS_HEADER_SELECTORS) {
      document.querySelectorAll(selector).forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.top < RESULTS_HEADER_MIN_Y || rect.top > RESULTS_HEADER_MAX_Y) {
          return;
        }

        if (rect.width < 300 || rect.height < 28) {
          return;
        }

        const text = normalizeNodeText(node);
        if (!RESULTS_HEADER_HINT_PATTERN.test(text)) {
          return;
        }

        candidates.push(node);
      });

      if (candidates.length > 0) {
        break;
      }
    }

    if (candidates.length === 0) {
      const allDivs = document.querySelectorAll("main#workspace > div > div");
      for (const div of allDivs) {
        const rect = div.getBoundingClientRect();
        if (rect.top >= 140 && rect.top <= 420 && rect.width >= 300 && rect.height >= 28) {
          const text = normalizeNodeText(div);
          if (RESULTS_HEADER_HINT_PATTERN.test(text)) {
            return div;
          }
        }
      }

      const mainWorkspace = document.querySelector("main#workspace");
      if (mainWorkspace) {
        const children = mainWorkspace.children;
        for (let i = 0; i < Math.min(children.length, 5); i++) {
          const child = children[i];
          const rect = child.getBoundingClientRect();
          if (rect.top >= 140 && rect.top <= 420 && rect.width >= 300) {
            const text = normalizeNodeText(child);
            if (RESULTS_HEADER_HINT_PATTERN.test(text) || /united states/i.test(text)) {
              return child;
            }
          }
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return candidates[0];
  }

  function getResultsCountRow() {
    for (const selector of RESULTS_COUNT_ROW_SELECTORS) {
      const node = document.querySelector(selector);
      if (!node) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      if (rect.width < 200 || rect.top < 140 || rect.top > 420) {
        continue;
      }

      const text = normalizeNodeText(node);
      if (!/\bresults?\b/i.test(text) && selector !== "main#workspace header") {
        continue;
      }

      return node;
    }

    const candidates = document.querySelectorAll("div, span, small, header");
    for (const node of candidates) {
      const text = normalizeNodeText(node);
      const rect = node.getBoundingClientRect();
      if (
        /^\d+[\d,]*\s+results?\b/i.test(text) &&
        rect.top > 140 &&
        rect.top < 420 &&
        rect.width > 200 &&
        rect.height < 80 &&
        node.children.length <= 10
      ) {
        return node;
      }
    }

    return null;
  }

  function getInnerResultsContainer() {
    const header = document.querySelector('main#workspace header');
    if (!header) return null;

    const firstChild = header.children[0];
    if (!firstChild) return null;

    const text = normalizeNodeText(firstChild);
    if (!/\bresults?\b/i.test(text) && !/united states/i.test(text)) {
      return null;
    }

    return firstChild;
  }

  function getLocationButtonInHeader() {
    const innerContainer = getInnerResultsContainer();
    if (!innerContainer) return null;

    const buttons = innerContainer.querySelectorAll('[role="button"], button, a');
    for (const btn of buttons) {
      const text = normalizeNodeText(btn);
      if (/united states/i.test(text)) {
        return btn;
      }
    }

    for (const btn of buttons) {
      const text = normalizeNodeText(btn);
      if (text && text.length > 2 && text.length < 40 && !/\d/.test(text)) {
        if (!NON_LOCATION_BUTTON_TEXT_PATTERN.test(text)) {
          return btn;
        }
      }
    }

    return null;
  }

  function getLocationNodeInResultsHeader(header) {
    if (!header) {
      return null;
    }

    const buttonCandidates = Array.from(header.querySelectorAll("[role='button'], button, a"));
    const locationHit = buttonCandidates.find((node) => isLikelyLocationButton(node));
    if (locationHit) {
      return locationHit;
    }

    const textCandidates = Array.from(header.querySelectorAll("div, span"));
    return textCandidates.find((node) => isLikelyLocationButton(node)) || null;
  }

  function getResultsHeaderRow(header) {
    if (!header) {
      return null;
    }

    const locationNode = getLocationNodeInResultsHeader(header);
    if (!locationNode) {
      return null;
    }

    return locationNode.closest("div") || locationNode.parentElement;
  }

  function getSearchFormRoot() {
    for (const selector of SEARCH_FORM_SELECTORS) {
      const node = document.querySelector(selector);
      if (node) {
        return node;
      }
    }

    return null;
  }

  function getLocationContainerInSearchForm(searchRoot) {
    if (!searchRoot) {
      return null;
    }

    const locationByClass =
      searchRoot.querySelector(".jobs-search-box__location-input") ||
      searchRoot.querySelector(".jobs-search-box__location") ||
      searchRoot.querySelector("[class*='jobs-search-box__location']") ||
      searchRoot.querySelector("[data-job-search-box-input='location']");
    if (locationByClass) {
      return locationByClass;
    }

    const inputs = Array.from(searchRoot.querySelectorAll("input"));
    const hinted = inputs.find((input) => inputLooksLikeLocation(input));
    if (hinted) {
      return (
        hinted.closest(".jobs-search-box__location-input") ||
        hinted.closest(".jobs-search-box__input") ||
        hinted.parentElement
      );
    }

    if (inputs.length >= 2) {
      const maybeLocation = inputs[1];
      return (
        maybeLocation.closest(".jobs-search-box__input") ||
        maybeLocation.parentElement
      );
    }

    return null;
  }

  function nodeIsLikelyTopSearchBar(node) {
    if (!node || typeof node.getBoundingClientRect !== "function") {
      return false;
    }

    const rect = node.getBoundingClientRect();
    if (rect.width < 280 || rect.top < -40 || rect.top > TOP_BAR_MAX_Y) {
      return false;
    }

    const text = (node.textContent || "").toLowerCase();
    const looksSearchRelated =
      node.querySelector("input") &&
      (/search/.test(text) || /jobs/.test(text) || /location/.test(text));

    return !!looksSearchRelated;
  }

  function pickBestSearchRoot() {
    const candidates = [];

    for (const selector of SEARCH_FORM_SELECTORS) {
      document.querySelectorAll(selector).forEach((node) => {
        if (nodeIsLikelyTopSearchBar(node)) {
          candidates.push(node);
        }
      });

      if (candidates.length > 0) {
        break;
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return candidates[0];
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
    const innerContainer = getInnerResultsContainer();
    const locationButton = getLocationButtonInHeader();

    if (innerContainer && locationButton?.parentElement) {
      return {
        mode: "after",
        node: locationButton,
        containerNode: innerContainer,
        strategy: "results-inner-after-location"
      };
    }

    if (innerContainer) {
      return {
        mode: "append",
        node: innerContainer,
        containerNode: innerContainer,
        strategy: "results-inner-append"
      };
    }

    const resultsCountRow = getResultsCountRow();
    if (resultsCountRow) {
      return {
        mode: "append",
        node: resultsCountRow,
        containerNode: resultsCountRow,
        strategy: "results-count-row-append"
      };
    }

    const resultsHeader = getResultsHeaderRoot();
    const resultsLocationNode = getLocationNodeInResultsHeader(resultsHeader);
    if (resultsLocationNode?.parentElement) {
      return {
        mode: "after",
        node: resultsLocationNode,
        headerNode: resultsHeader,
        containerNode: getResultsHeaderRow(resultsHeader),
        strategy: "results-header-after-location"
      };
    }

    if (resultsHeader) {
      return {
        mode: "append",
        node: resultsHeader,
        headerNode: resultsHeader,
        containerNode: resultsHeader,
        strategy: "results-header-append"
      };
    }

    const searchRoot = pickBestSearchRoot() || getSearchFormRoot();
    const locationInSearchRoot = getLocationContainerInSearchForm(searchRoot);
    if (locationInSearchRoot?.parentElement) {
      return {
        mode: "after",
        node: locationInSearchRoot,
        strategy: "searchbar-after-location"
      };
    }

    if (searchRoot) {
      return { mode: "append", node: searchRoot, strategy: "searchbar-append" };
    }

    const toolbar = document.querySelector("main#workspace [role='toolbar'], [role='toolbar']");
    if (toolbar && toolbar.getBoundingClientRect().top > -20 && toolbar.getBoundingClientRect().top < 320) {
      return {
        mode: "append",
        node: toolbar,
        containerNode: toolbar,
        strategy: "toolbar-append"
      };
    }

    const locationWrapper = findLocationWrapper();
    if (locationWrapper?.parentElement) {
      return { mode: "after", node: locationWrapper, strategy: "wrapper-after" };
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
        return { mode: "after", node: closestWrapper, strategy: "input-after" };
      }
    }

    for (const selector of SEARCH_BOX_FALLBACK_SELECTORS) {
      const fallback = document.querySelector(selector);
      if (fallback && nodeIsLikelyTopSearchBar(fallback)) {
        return { mode: "append", node: fallback, strategy: `fallback:${selector}` };
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

  function isContainerLikelyHidden(node) {
    if (!node) {
      return false;
    }

    const style = window.getComputedStyle(node);
    if (!style) {
      return false;
    }

    return style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0;
  }

  function adjustUiDensity(container, mountTarget) {
    if (!container) {
      return;
    }

    const host = mountTarget?.containerNode || mountTarget?.node?.parentElement;
    let compact = false;

    if (host && host.getBoundingClientRect) {
      const hostRect = host.getBoundingClientRect();
      if (hostRect.width > 0 && hostRect.width < 760) {
        compact = true;
      }
    }

    if (compact) {
      container.classList.add("bth-inline-compact");
    } else {
      container.classList.remove("bth-inline-compact");
    }
  }

  function forceResultsHeaderInlineLayout(target) {
    const rowNode = target.containerNode;
    if (!rowNode) {
      return;
    }

    const rowStyle = window.getComputedStyle(rowNode);
    if (rowStyle.display !== "flex" && rowStyle.display !== "inline-flex") {
      rowNode.style.display = "flex";
      rowNode.style.alignItems = "center";
      rowNode.style.columnGap = "8px";
      rowNode.style.rowGap = "6px";
      rowNode.style.flexWrap = "wrap";
    }
  }

  function getTargetDebugData(target) {
    if (!target?.node) {
      return null;
    }

    const rect = target.node.getBoundingClientRect();
    return {
      strategy: target.strategy || "unknown",
      mode: target.mode,
      nodeTag: target.node.tagName,
      nodeRole: target.node.getAttribute ? target.node.getAttribute("role") : null,
      nodeText: normalizeNodeText(target.node).slice(0, 60),
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      hidden: isContainerLikelyHidden(target.node)
    };
  }

  function stopUiRetryLoop() {
    if (uiRetryTimer !== null) {
      window.clearTimeout(uiRetryTimer);
      uiRetryTimer = null;
    }
  }

  function scheduleUiRetryLoop() {
    const connectedContainer = document.getElementById(UI_CONTAINER_ID);
    const hasVisibleContainer = connectedContainer
      ? connectedContainer.getBoundingClientRect().width > 40
      : false;
    if (uiRetryTimer !== null || hasVisibleContainer || uiRetryAttempts >= UI_RETRY_MAX_ATTEMPTS) {
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

    const currentStrategy = mountTarget.strategy || "unknown";
    if (
      currentStrategy === "results-header-after-location" ||
      currentStrategy === "results-header-append" ||
      currentStrategy === "results-count-row-append" ||
      currentStrategy === "results-inner-after-location" ||
      currentStrategy === "results-inner-append"
    ) {
      forceResultsHeaderInlineLayout(mountTarget);
    }

    adjustUiDensity(container, mountTarget);
    const mountedRect = container.getBoundingClientRect();
    const notVisible = mountedRect.width < 40 || mountedRect.height < 20;
    const inWrongZone = mountedRect.top > 420 || mountedRect.top < -40;
    if (notVisible || inWrongZone) {
      log("Inline UI mounted but not visible in expected area", {
        rect: {
          top: Math.round(mountedRect.top),
          left: Math.round(mountedRect.left),
          width: Math.round(mountedRect.width),
          height: Math.round(mountedRect.height)
        },
        target: getTargetDebugData(mountTarget)
      });
    }

    uiMountMode = attachResult.mode;
    uiMountStrategy = currentStrategy;
    if (
      window.__BYTHEHOUR_LAST_MOUNT_MODE__ !== uiMountMode ||
      window.__BYTHEHOUR_LAST_MOUNT_STRATEGY__ !== uiMountStrategy
    ) {
      window.__BYTHEHOUR_LAST_MOUNT_MODE__ = uiMountMode;
      window.__BYTHEHOUR_LAST_MOUNT_STRATEGY__ = uiMountStrategy;
      log("Inline UI mounted", { mode: uiMountMode, strategy: uiMountStrategy });
    }

    if (uiMountStrategy === "results-count-row-append") {
      container.style.marginLeft = "12px";
      container.style.marginTop = "0";
      container.style.width = "";
      container.style.display = "inline-flex";
      container.style.verticalAlign = "middle";
    } else
    if (uiMountStrategy === "results-inner-after-location" || uiMountStrategy === "results-inner-append") {
      container.style.marginLeft = "8px";
      container.style.marginTop = "0";
      container.style.width = "";
      container.style.display = "inline-flex";
      container.style.verticalAlign = "middle";
    } else
    if (uiMountStrategy === "results-header-after-location" || uiMountStrategy === "results-header-append") {
      container.style.marginLeft = "8px";
      container.style.marginTop = "0";
      container.style.width = "";
      container.style.display = "inline-flex";
      container.style.verticalAlign = "middle";

      const containerNode = mountTarget.containerNode || mountTarget.node?.parentElement;
      if (containerNode) {
        const computedStyle = window.getComputedStyle(containerNode);
        if (computedStyle.display !== "flex" && computedStyle.display !== "inline-flex") {
          containerNode.style.display = "flex";
          containerNode.style.alignItems = "center";
        }
        if (!containerNode.style.flexWrap) {
          containerNode.style.flexWrap = "wrap";
        }
        if (!containerNode.style.gap && !containerNode.style.columnGap) {
          containerNode.style.columnGap = "8px";
        }
      }
    } else
    if (uiMountStrategy === "toolbar-append") {
      container.style.marginLeft = "12px";
      container.style.marginTop = "8px";
      container.style.width = "fit-content";
      container.style.display = "inline-flex";
      container.style.verticalAlign = "";
      const toolbarStyle = window.getComputedStyle(mountTarget.node);
      if (toolbarStyle.display !== "flex" && toolbarStyle.display !== "inline-flex") {
        mountTarget.node.style.display = "flex";
      }
      mountTarget.node.style.alignItems = "center";
      mountTarget.node.style.flexWrap = "wrap";
      mountTarget.node.style.columnGap = "8px";
      mountTarget.node.style.rowGap = "8px";
      mountTarget.node.style.paddingLeft = "12px";
      mountTarget.node.style.paddingRight = "12px";
      mountTarget.node.style.paddingTop = "8px";
      mountTarget.node.style.paddingBottom = "8px";
    } else
    if (uiMountMode === "append" || uiMountMode === "prepend") {
      container.style.marginLeft = "0";
      container.style.marginTop = "8px";
      container.style.width = "fit-content";
      container.style.display = "inline-flex";
      container.style.verticalAlign = "";
    } else {
      container.style.marginLeft = "8px";
      container.style.marginTop = "0";
      container.style.width = "";
      container.style.display = "inline-flex";
      container.style.verticalAlign = "";
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
