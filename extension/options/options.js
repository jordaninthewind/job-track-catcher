const DEFAULTS = { sheetUrl: "", enabled: true };

const sheetUrlEl = document.getElementById("sheetUrl");
const enabledEl = document.getElementById("enabled");
const statusEl = document.getElementById("status");

async function restore() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  sheetUrlEl.value = settings.sheetUrl;
  enabledEl.checked = settings.enabled;
}

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    sheetUrl: sheetUrlEl.value.trim(),
    enabled: enabledEl.checked,
  });
  statusEl.textContent = "Saved.";
  setTimeout(() => (statusEl.textContent = ""), 1500);
});

restore();
