(function byTheHourPopup() {
  const DEFAULT_MAX_HOURS = 12;

  const maxHoursInput = document.getElementById("maxHours");
  const saveButton = document.getElementById("saveButton");
  const status = document.getElementById("status");

  function setStatus(message) {
    status.textContent = message;
  }

  function parseInput() {
    const parsed = Number(maxHoursInput.value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return null;
    }

    return Math.floor(parsed);
  }

  function loadSettings() {
    chrome.storage.sync.get(["maxHours"], (result) => {
      const parsed = Number(result.maxHours);
      if (Number.isFinite(parsed) && parsed > 0) {
        maxHoursInput.value = String(Math.floor(parsed));
        return;
      }

      maxHoursInput.value = String(DEFAULT_MAX_HOURS);
    });
  }

  function saveSettings() {
    const value = parseInput();
    if (value === null) {
      setStatus("Enter a valid number of hours (1+).");
      return;
    }

    chrome.storage.sync.set({ maxHours: value }, () => {
      setStatus(`Saved: showing jobs from last ${value} hour(s).`);
    });
  }

  saveButton.addEventListener("click", saveSettings);
  maxHoursInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      saveSettings();
    }
  });

  loadSettings();
})();
