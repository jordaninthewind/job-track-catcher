// Content script: finds a job application's submit button, puts a
// "Save Application Data" button next to it, and on click builds
//   { url, company, role, inputs: { "<question label>": "<answer>" } }
// and sends it to the background service worker.

(() => {
  if (window.__jtcLoaded) return;
  window.__jtcLoaded = true;

  const HOST_ATTR = "data-jtc-host";
  const SKIP_TYPES = new Set(["password", "hidden", "submit", "button", "reset", "image"]);
  const SUBMIT_TEXT =
    /^(submit|submit (my |your )?application|apply|apply now|send application|complete application|finish application)$/i;
  // Labels on helper controls that say nothing about the question (Greenhouse's resume widget, etc.).
  const GENERIC_LABELS = /^(attach|upload|choose file|browse|enter manually|dropbox|google drive)$/i;
  const FILE_NAME = /\S+\.(pdf|docx?|txt|rtf|odt|pages)$/i;

  // submit element -> injected host element
  const injected = new Map();

  let enabled = true;

  // ---------- text helpers ----------

  const clean = (s) =>
    (s || "")
      .replace(/\s+/g, " ")
      .replace(/\s*\*\s*$/, "") // trailing "required" asterisk
      .trim();

  function textOf(node) {
    if (!node) return "";
    // Drop nested controls and hidden decorations so a wrapping <label>
    // doesn't pick up option text or the "*" required marker.
    const copy = node.cloneNode(true);
    copy
      .querySelectorAll(`input, select, textarea, style, script, [aria-hidden="true"], [${HOST_ATTR}]`)
      .forEach((n) => n.remove());
    return clean(copy.textContent);
  }

  function byIds(ids) {
    return clean(
      (ids || "")
        .split(/\s+/)
        .map((id) => textOf(document.getElementById(id)))
        .join(" ")
    );
  }

  function buttonText(el) {
    return clean(el.tagName === "INPUT" ? el.value : el.innerText || el.textContent) || clean(el.getAttribute("aria-label"));
  }

  function isVisible(el) {
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  // ---------- labels ----------

  function ownLabel(el) {
    if (el.labels?.length) {
      const t = clean([...el.labels].map(textOf).join(" "));
      if (t) return t;
    }
    return (
      byIds(el.getAttribute("aria-labelledby")) ||
      clean(el.getAttribute("aria-label")) ||
      clean(el.getAttribute("placeholder")) ||
      clean(el.getAttribute("title"))
    );
  }

  // The question a control belongs to when the control itself is one option
  // or a helper (radio/checkbox groups, file upload widgets).
  function groupLabel(el) {
    const group = el.closest('fieldset, [role="radiogroup"], [role="group"]');
    if (!group) return "";
    if (group.tagName === "FIELDSET") {
      const legend = group.querySelector("legend");
      if (legend) return textOf(legend);
    }
    return byIds(group.getAttribute("aria-labelledby")) || clean(group.getAttribute("aria-label"));
  }

  function labelFor(el) {
    const own = ownLabel(el);
    if (el.type === "file" || !own || GENERIC_LABELS.test(own)) {
      return groupLabel(el) || own || el.name || el.id || "";
    }
    return own;
  }

  // ---------- values ----------

  // Custom dropdowns (react-select on Greenhouse, etc.) keep the chosen value
  // in a sibling element rather than in the <input>.
  function comboboxValue(el) {
    const container =
      el.closest('[class*="value-container"], [class*="ValueContainer"]') ||
      el.closest('[class*="control"], [class*="Control"]');
    if (container) {
      const chosen = container.querySelectorAll(
        '[class*="single-value"], [class*="singleValue"], [class*="multi-value__label"], [class*="MultiValueLabel"]'
      );
      if (chosen.length) return [...chosen].map(textOf).filter(Boolean).join(", ");
    }
    return (el.value || "").trim();
  }

  function fileValue(el) {
    const names = [...(el.files || [])].map((f) => f.name);
    if (names.length) return names.join(", ");
    // After upload some ATSs reset the <input> and show the file name as text instead.
    const group = el.closest('[role="group"]') || el.closest('.file-upload, [class*="upload"]');
    if (!group) return "";
    for (const node of group.querySelectorAll("*")) {
      if (node.children.length) continue;
      const t = clean(node.textContent);
      if (FILE_NAME.test(t) && !/accepted file types/i.test(t)) return t;
    }
    return "";
  }

  function valueFor(el, type) {
    if (type === "file") return fileValue(el);
    if (type.startsWith("select")) {
      return [...el.selectedOptions]
        .filter((o) => o.value !== "")
        .map((o) => clean(o.text))
        .join(", ");
    }
    if (el.getAttribute("role") === "combobox") return comboboxValue(el);
    return (el.value || "").trim();
  }

  // ---------- field collection ----------

  function countFields(scope) {
    return scope.querySelectorAll(
      "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select"
    ).length;
  }

  // The element whose fields belong to this submit button.
  function scopeFor(submitEl) {
    const form = submitEl.form || submitEl.closest("form");
    if (form) return form;
    // No <form> (common in React apps): climb until we hit a container with real inputs.
    for (let el = submitEl.parentElement; el && el !== document.body; el = el.parentElement) {
      if (countFields(el) >= 3) return el;
    }
    return document.body;
  }

  // Returns { "<label>": "<answer>" } in page order. Unanswered questions are kept as "".
  function collectInputs(scope) {
    const inputs = {};

    const put = (label, value, { append = false } = {}) => {
      if (!label) return;
      if (!(label in inputs)) {
        inputs[label] = value;
      } else if (append && value) {
        inputs[label] = inputs[label] ? `${inputs[label]}, ${value}` : value;
      } else if (!inputs[label] && value) {
        // e.g. Resume "Attach" was empty but "Enter manually" has text.
        inputs[label] = value;
      }
    };

    for (const el of scope.querySelectorAll("input, textarea, select")) {
      if (el.closest(`[${HOST_ATTR}]`) || el.disabled) continue;
      if (el.getAttribute("aria-hidden") === "true") continue; // shadow inputs used for "required" validation
      const type = (el.type || el.tagName).toLowerCase();
      if (SKIP_TYPES.has(type)) continue;
      if (type !== "file" && !isVisible(el)) continue; // honeypots, collapsed widgets

      if (type === "radio" || type === "checkbox") {
        const question = groupLabel(el);
        const option = ownLabel(el) || el.value;
        if (!question && type === "checkbox") {
          // Standalone checkbox, e.g. "I agree to the privacy policy".
          put(option, el.checked ? "Yes" : "No");
        } else {
          put(question || el.name || option, el.checked ? option : "", { append: true });
        }
        continue;
      }

      put(labelFor(el), valueFor(el, type));
    }
    return inputs;
  }

  // ---------- company / role ----------

  const ATS_PATTERNS = [
    [/(?:job-)?boards(?:\.eu)?\.greenhouse\.io$/, "path"],
    [/^jobs\.lever\.co$/, "path"],
    [/^jobs\.ashbyhq\.com$/, "path"],
    [/^apply\.workable\.com$/, "path"],
    [/^jobs\.smartrecruiters\.com$/, "path"],
    [/\.myworkdayjobs\.com$/, "subdomain"],
    [/\.bamboohr\.com$/, "subdomain"],
    [/\.breezy\.hr$/, "subdomain"],
    [/\.recruitee\.com$/, "subdomain"],
  ];

  const prettySlug = (slug) =>
    decodeURIComponent(slug)
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  function companyFromAts() {
    const { hostname, pathname, searchParams } = new URL(location.href);
    for (const [re, where] of ATS_PATTERNS) {
      if (!re.test(hostname)) continue;
      // Greenhouse embeds: /embed/job_app?for=<company>&token=<job id>
      const slug =
        searchParams.get("for") ||
        (where === "path" ? pathname.split("/").filter(Boolean)[0] : hostname.split(".")[0]);
      if (slug && slug !== "embed") return prettySlug(slug);
    }
    return "";
  }

  // "Job Application for Software Engineer: Full Stack at Thatch" (Greenhouse and others)
  function fromTitle() {
    const m = document.title.match(/application for\s+(.+)\s+at\s+(.+?)(?:\s+[|–—-]\s+.*)?$/i);
    return m ? { role: clean(m[1]), company: clean(m[2]) } : {};
  }

  function companyName() {
    const siteName = document.querySelector('meta[property="og:site_name"]')?.content;
    const host = location.hostname.replace(/^(www|careers|jobs|apply)\./, "");
    return fromTitle().company || companyFromAts() || clean(siteName) || prettySlug(host.split(".")[0]);
  }

  function roleName() {
    return (
      fromTitle().role ||
      textOf(document.querySelector("h1")) ||
      clean(document.querySelector('meta[property="og:title"]')?.content) ||
      clean(document.title)
    );
  }

  // ---------- save ----------

  async function handleSave(submitEl, btn) {
    const inputs = collectInputs(scopeFor(submitEl));
    if (!Object.values(inputs).some(Boolean)) {
      flash(btn, "No answers found");
      return;
    }

    // `url` is replaced by the tab's address-bar URL in the background, so
    // forms embedded in an iframe are saved under the company's own job page.
    const application = { url: location.href, company: companyName(), role: roleName(), inputs };

    try {
      const res = await chrome.runtime.sendMessage({ type: "SAVE_APPLICATION", application });
      flash(btn, res?.ok ? (res.updated ? "Updated ✓" : "Saved ✓") : "Save failed");
    } catch {
      // Happens when the extension was reloaded but this page wasn't.
      flash(btn, "Reload page to save");
    }
  }

  function flash(btn, text) {
    btn.textContent = text;
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = "Save Application Data";
      btn.disabled = false;
    }, 2000);
  }

  // ---------- find submit buttons & inject ----------

  function isSubmitButton(el) {
    if (!isVisible(el) || el.closest(`[${HOST_ATTR}]`)) return false;
    const form = el.form || el.closest("form");
    // Ignore login forms.
    if (form?.querySelector('input[type="password"]')) return false;

    if (SUBMIT_TEXT.test(buttonText(el))) return true;

    // A real submit button only counts if its form looks like an application,
    // so we don't attach to every search box on the web.
    const isTypeSubmit = el.type === "submit" && (el.tagName === "BUTTON" || el.tagName === "INPUT");
    return isTypeSubmit && !!form && countFields(form) >= 3;
  }

  function findSubmitButtons() {
    const inForm = [];
    const loose = [];
    for (const el of document.querySelectorAll(
      'button, input[type="submit"], input[type="button"], [role="button"]'
    )) {
      if (!isSubmitButton(el)) continue;
      (el.form || el.closest("form") ? inForm : loose).push(el);
    }
    // Buttons outside any <form> (e.g. an "Apply" link at the top of a job post) are
    // only used when the page has no form-based submit, as in some React apps.
    return new Set(inForm.length ? inForm : loose);
  }

  function inject(submitEl) {
    const host = document.createElement("span");
    host.setAttribute(HOST_ATTR, "");
    host.style.cssText = "display:inline-block;margin:0 0 0 8px;vertical-align:middle;";

    // Shadow DOM keeps the page's CSS off our button and ours off the page.
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        button {
          all: initial;
          font: 600 14px/1 system-ui, -apple-system, sans-serif;
          padding: 10px 14px;
          border-radius: 6px;
          background: #1a7f37;
          color: #fff;
          cursor: pointer;
          white-space: nowrap;
        }
        button:hover:not(:disabled) { background: #116329; }
        button:disabled { opacity: .85; cursor: default; }
      </style>
      <button type="button">Save Application Data</button>`;

    const btn = root.querySelector("button");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation(); // keep the page's own click handlers out of it
      handleSave(submitEl, btn);
    });

    submitEl.insertAdjacentElement("afterend", host);
    injected.set(submitEl, host);
  }

  function scan() {
    if (!enabled) return;
    for (const el of findSubmitButtons()) {
      const host = injected.get(el);
      if (!host || !host.isConnected) inject(el); // re-inject if a framework re-rendered it away
    }
    // Forget buttons that left the page.
    for (const [el, host] of injected) {
      if (!el.isConnected) {
        host.remove();
        injected.delete(el);
      }
    }
  }

  function removeAll() {
    for (const host of injected.values()) host.remove();
    injected.clear();
  }

  // Application forms are often rendered (or re-rendered) after load, so keep watching.
  let pending = null;
  const observer = new MutationObserver((mutations) => {
    // Ignore our own insertions.
    if (mutations.every((m) => [...m.addedNodes].every((n) => n.nodeType === 1 && n.hasAttribute?.(HOST_ATTR)))) return;
    clearTimeout(pending);
    pending = setTimeout(scan, 300);
  });

  chrome.storage.sync.get({ enabled: true }).then((s) => {
    enabled = s.enabled;
    scan();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.enabled) return;
    enabled = changes.enabled.newValue;
    enabled ? scan() : removeAll();
  });
})();
