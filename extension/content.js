// Content script: listens for form submissions on the page and sends the
// filled-in values to the background service worker.

(() => {
  // Never capture these, regardless of what the page calls them.
  const SKIP_TYPES = new Set(["password", "hidden", "submit", "button", "reset", "image", "file"]);

  // Cache the on/off setting so the submit handler can stay synchronous
  // (the page may navigate away immediately after submit).
  let enabled = true;
  chrome.storage.sync.get({ enabled: true }).then((s) => (enabled = s.enabled));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.enabled) enabled = changes.enabled.newValue;
  });

  function labelFor(el) {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label?.textContent.trim()) return label.textContent.trim();
    }
    const wrappingLabel = el.closest("label");
    if (wrappingLabel?.textContent.trim()) return wrappingLabel.textContent.trim();
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.name ||
      el.id ||
      el.tagName.toLowerCase()
    );
  }

  function collectFields(form) {
    const fields = {};
    for (const el of form.querySelectorAll("input, textarea, select")) {
      const type = (el.type || "").toLowerCase();
      if (SKIP_TYPES.has(type) || el.disabled) continue;
      if ((type === "checkbox" || type === "radio") && !el.checked) continue;

      const value = el.value?.trim();
      if (!value) continue;

      const key = labelFor(el);
      fields[key] = fields[key] ? `${fields[key]}, ${value}` : value;
    }
    return fields;
  }

  document.addEventListener(
    "submit",
    (event) => {
      if (!enabled) return;
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;

      const fields = collectFields(form);
      if (Object.keys(fields).length === 0) return;

      chrome.runtime.sendMessage({
        type: "FORM_CAPTURED",
        payload: { url: location.href, pageTitle: document.title, fields },
      });
    },
    true // capture phase, so we see the submit even if the page stops propagation
  );
})();
