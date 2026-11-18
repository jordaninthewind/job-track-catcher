// Content script: finds a job application's submit button, puts a
// "Save Application Data" button next to it, and on click builds
//   { url, company, role, inputs: { "<question label>": "<answer>" } }
// and sends it to the background service worker.
//
// Plain TypeScript (no React): this runs on every page, so it stays small.
// Bundled as an IIFE because Chrome doesn't load content scripts as modules.

import { getSettings, sendMessage } from "./lib/storage";
import type { Application, Inputs } from "./lib/types";

type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

declare global {
  interface Window {
    __jtcLoaded?: boolean;
  }
}

const HOST_ATTR = "data-jtc-host";
const SKIP_TYPES = new Set(["password", "hidden", "submit", "button", "reset", "image"]);
const SUBMIT_TEXT =
  /^(submit|submit (my |your )?application|apply|apply now|send application|complete application|finish application)$/i;
// Labels on helper controls that say nothing about the question (Greenhouse's resume widget, etc.).
const GENERIC_LABELS = /^(attach|upload|choose file|browse|enter manually|dropbox|google drive)$/i;
const FILE_NAME = /\S+\.(pdf|docx?|txt|rtf|odt|pages)$/i;
const BUTTON_LABEL = "Save Application Data";

// ---------- text helpers ----------

const clean = (s: string | null | undefined): string =>
  (s ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*\*\s*$/, "") // trailing "required" asterisk
    .trim();

function textOf(node: Element | null | undefined): string {
  if (!node) return "";
  // Drop nested controls and hidden decorations so a wrapping <label>
  // doesn't pick up option text or the "*" required marker.
  const copy = node.cloneNode(true) as Element;
  copy
    .querySelectorAll(`input, select, textarea, style, script, [aria-hidden="true"], [${HOST_ATTR}]`)
    .forEach((n) => n.remove());
  return clean(copy.textContent);
}

function byIds(ids: string | null): string {
  return clean(
    (ids ?? "")
      .split(/\s+/)
      .map((id) => textOf(id ? document.getElementById(id) : null))
      .join(" ")
  );
}

function buttonText(el: HTMLElement): string {
  const text = el instanceof HTMLInputElement ? el.value : el.innerText || el.textContent;
  return clean(text) || clean(el.getAttribute("aria-label"));
}

function isVisible(el: Element): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
}

// ---------- labels ----------

function ownLabel(el: FormControl): string {
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
function groupLabel(el: Element): string {
  const group = el.closest('fieldset, [role="radiogroup"], [role="group"]');
  if (!group) return "";
  if (group instanceof HTMLFieldSetElement) {
    const legend = group.querySelector("legend");
    if (legend) return textOf(legend);
  }
  return byIds(group.getAttribute("aria-labelledby")) || clean(group.getAttribute("aria-label"));
}

function labelFor(el: FormControl): string {
  const own = ownLabel(el);
  if (el.type === "file" || !own || GENERIC_LABELS.test(own)) {
    return groupLabel(el) || own || el.name || el.id || "";
  }
  return own;
}

// ---------- values ----------

// Custom dropdowns (react-select on Greenhouse, etc.) keep the chosen value
// in a sibling element rather than in the <input>.
function comboboxValue(el: FormControl): string {
  const container =
    el.closest('[class*="value-container"], [class*="ValueContainer"]') ??
    el.closest('[class*="control"], [class*="Control"]');
  if (container) {
    const chosen = container.querySelectorAll(
      '[class*="single-value"], [class*="singleValue"], [class*="multi-value__label"], [class*="MultiValueLabel"]'
    );
    if (chosen.length) return [...chosen].map(textOf).filter(Boolean).join(", ");
  }
  return el.value.trim();
}

function fileValue(el: HTMLInputElement): string {
  const names = [...(el.files ?? [])].map((f) => f.name);
  if (names.length) return names.join(", ");
  // After upload some ATSs reset the <input> and show the file name as text instead.
  const group = el.closest('[role="group"]') ?? el.closest('.file-upload, [class*="upload"]');
  if (!group) return "";
  for (const node of group.querySelectorAll("*")) {
    if (node.children.length) continue;
    const t = clean(node.textContent);
    if (FILE_NAME.test(t) && !/accepted file types/i.test(t)) return t;
  }
  return "";
}

function valueFor(el: FormControl, type: string): string {
  if (type === "file" && el instanceof HTMLInputElement) return fileValue(el);
  if (el instanceof HTMLSelectElement) {
    return [...el.selectedOptions]
      .filter((o) => o.value !== "")
      .map((o) => clean(o.text))
      .join(", ");
  }
  if (el.getAttribute("role") === "combobox") return comboboxValue(el);
  return el.value.trim();
}

// ---------- field collection ----------

function countFields(scope: ParentNode): number {
  return scope.querySelectorAll(
    "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select"
  ).length;
}

function formOf(el: Element): HTMLFormElement | null {
  return (el as HTMLButtonElement).form ?? el.closest("form");
}

// The element whose fields belong to this submit button.
function scopeFor(submitEl: HTMLElement): Element {
  const form = formOf(submitEl);
  if (form) return form;
  // No <form> (common in React apps): climb until we hit a container with real inputs.
  for (let el = submitEl.parentElement; el && el !== document.body; el = el.parentElement) {
    if (countFields(el) >= 3) return el;
  }
  return document.body;
}

/** Returns { "<label>": "<answer>" } in page order. Unanswered questions are kept as "". */
function collectInputs(scope: Element): Inputs {
  const inputs: Inputs = {};

  const put = (label: string, value: string, append = false) => {
    if (!label) return;
    const current = inputs[label];
    if (current === undefined) {
      inputs[label] = value;
    } else if (append && value) {
      inputs[label] = current ? `${current}, ${value}` : value;
    } else if (!current && value) {
      // e.g. Resume "Attach" was empty but "Enter manually" has text.
      inputs[label] = value;
    }
  };

  for (const el of scope.querySelectorAll<FormControl>("input, textarea, select")) {
    if (el.closest(`[${HOST_ATTR}]`) || el.disabled) continue;
    if (el.getAttribute("aria-hidden") === "true") continue; // shadow inputs used for "required" validation
    const type = (el.type || el.tagName).toLowerCase();
    if (SKIP_TYPES.has(type)) continue;
    if (type !== "file" && !isVisible(el)) continue; // honeypots, collapsed widgets

    if (el instanceof HTMLInputElement && (type === "radio" || type === "checkbox")) {
      const question = groupLabel(el);
      const option = ownLabel(el) || el.value;
      if (!question && type === "checkbox") {
        // Standalone checkbox, e.g. "I agree to the privacy policy".
        put(option, el.checked ? "Yes" : "No");
      } else {
        put(question || el.name || option, el.checked ? option : "", true);
      }
      continue;
    }

    put(labelFor(el), valueFor(el, type));
  }
  return inputs;
}

// ---------- company / role ----------

const ATS_PATTERNS: [RegExp, "path" | "subdomain"][] = [
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

const prettySlug = (slug: string): string =>
  decodeURIComponent(slug)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

function companyFromAts(): string {
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
function fromTitle(): { role?: string; company?: string } {
  const m = document.title.match(/application for\s+(.+)\s+at\s+(.+?)(?:\s+[|–—-]\s+.*)?$/i);
  return m ? { role: clean(m[1]), company: clean(m[2]) } : {};
}

function companyName(): string {
  const siteName = document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content;
  const host = location.hostname.replace(/^(www|careers|jobs|apply)\./, "");
  return fromTitle().company || companyFromAts() || clean(siteName) || prettySlug(host.split(".")[0] ?? host);
}

function roleName(): string {
  return (
    fromTitle().role ||
    textOf(document.querySelector("h1")) ||
    clean(document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content) ||
    clean(document.title)
  );
}

// ---------- save ----------

async function handleSave(submitEl: HTMLElement, btn: HTMLButtonElement) {
  const inputs = collectInputs(scopeFor(submitEl));
  if (!Object.values(inputs).some(Boolean)) {
    flash(btn, "No answers found");
    return;
  }

  // `url` is replaced by the tab's address-bar URL in the background, so
  // forms embedded in an iframe are saved under the company's own job page.
  const application: Application = { url: location.href, company: companyName(), role: roleName(), inputs };

  try {
    const res = await sendMessage({ type: "SAVE_APPLICATION", application });
    flash(btn, res.ok ? (res.updated ? "Updated ✓" : "Saved ✓") : "Save failed");
  } catch {
    // Happens when the extension was reloaded but this page wasn't.
    flash(btn, "Reload page to save");
  }
}

function flash(btn: HTMLButtonElement, text: string) {
  btn.textContent = text;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = BUTTON_LABEL;
    btn.disabled = false;
  }, 2000);
}

// ---------- find submit buttons & inject ----------

function isSubmitButton(el: HTMLElement): boolean {
  if (!isVisible(el) || el.closest(`[${HOST_ATTR}]`)) return false;
  const form = formOf(el);
  // Ignore login forms.
  if (form?.querySelector('input[type="password"]')) return false;

  if (SUBMIT_TEXT.test(buttonText(el))) return true;

  // A real submit button only counts if its form looks like an application,
  // so we don't attach to every search box on the web.
  const isTypeSubmit =
    (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) && el.type === "submit";
  return isTypeSubmit && !!form && countFields(form) >= 3;
}

function findSubmitButtons(): Set<HTMLElement> {
  const inForm: HTMLElement[] = [];
  const loose: HTMLElement[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(
    'button, input[type="submit"], input[type="button"], [role="button"]'
  )) {
    if (!isSubmitButton(el)) continue;
    (formOf(el) ? inForm : loose).push(el);
  }
  // Buttons outside any <form> (e.g. an "Apply" link at the top of a job post) are
  // only used when the page has no form-based submit, as in some React apps.
  return new Set(inForm.length ? inForm : loose);
}

const BUTTON_STYLES = `
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
`;

// submit element -> injected host element
const injected = new Map<HTMLElement, HTMLElement>();
let enabled = true;

function inject(submitEl: HTMLElement) {
  const host = document.createElement("span");
  host.setAttribute(HOST_ATTR, "");
  host.style.cssText = "display:inline-block;margin:0 0 0 8px;vertical-align:middle;";

  // Shadow DOM keeps the page's CSS off our button and ours off the page.
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = BUTTON_STYLES;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = BUTTON_LABEL;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation(); // keep the page's own click handlers out of it
    handleSave(submitEl, btn);
  });
  root.append(style, btn);

  submitEl.insertAdjacentElement("afterend", host);
  injected.set(submitEl, host);
}

function scan() {
  if (!enabled) return;
  for (const el of findSubmitButtons()) {
    const host = injected.get(el);
    if (!host?.isConnected) inject(el); // re-inject if a framework re-rendered it away
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

function start() {
  // Application forms are often rendered (or re-rendered) after load, so keep watching.
  let pending: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver((mutations) => {
    // Ignore our own insertions.
    const ours = mutations.every((m) =>
      [...m.addedNodes].every((n) => n instanceof Element && n.hasAttribute(HOST_ATTR))
    );
    if (ours) return;
    clearTimeout(pending);
    pending = setTimeout(scan, 300);
  });

  getSettings().then((s) => {
    enabled = s.enabled;
    scan();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes.enabled;
    if (area !== "sync" || !change) return;
    enabled = change.newValue !== false;
    if (enabled) scan();
    else removeAll();
  });
}

if (!window.__jtcLoaded) {
  window.__jtcLoaded = true;
  start();
}
