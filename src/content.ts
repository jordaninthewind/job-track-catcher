// Content script: finds a job application's submit button and puts
// "Prefill" and "Save Application Data" buttons next to it.
//   - Save builds { url, company, role, inputs: { "<question label>": "<answer>" } }
//     and sends it to the background service worker.
//   - Prefill fills empty questions from saved answers (see src/prefill/).
// Also handles the popup's "Prefill page" and "Pick fields" commands.
//
// Plain TypeScript (no React): this runs on every page, so it stays small.
// Bundled as an IIFE because Chrome doesn't load content scripts as modules.

import { clean, collectInputs, countFields, HOST_ATTR, isVisible, textOf } from "./lib/fields";
import { getSettings, sendMessage } from "./lib/storage";
import { toggleDarkMode } from "./lib/dark-mode";
import type { ApplicationInput, TabMessage } from "./lib/types";
import { describeResult, prefill } from "./prefill/fill";
import { toast } from "./prefill/overlay";
import { startPicker, stopPicker } from "./prefill/picker";

declare global {
  interface Window {
    __jtcLoaded?: boolean;
  }
}

const SUBMIT_TEXT =
  /^(submit|submit (my |your )?application|apply|apply now|send application|complete application|finish application)$/i;
const SAVE_LABEL = "Save Application Data";
const PREFILL_LABEL = "Prefill";

function buttonText(el: HTMLElement): string {
  const text = el instanceof HTMLInputElement ? el.value : el.innerText || el.textContent;
  return clean(text) || clean(el.getAttribute("aria-label"));
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

// ---------- button actions ----------

async function handleSave(submitEl: HTMLElement, btn: HTMLButtonElement) {
  const inputs = collectInputs(scopeFor(submitEl));
  if (!Object.values(inputs).some(Boolean)) {
    flash(btn, "No answers found", SAVE_LABEL);
    return;
  }

  // `url` is replaced by the tab's address-bar URL in the background, so
  // forms embedded in an iframe are saved under the company's own job page.
  // The background also adds `date` (first save) and `stage` ("applied").
  const application: ApplicationInput = { url: location.href, company: companyName(), role: roleName(), inputs };

  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const res = await sendMessage({ type: "SAVE_APPLICATION", application });
    if (!res.ok) return flash(btn, "Save failed", SAVE_LABEL);
    const saved = res.updated ? "Updated" : "Saved";
    if (!res.sync) return flash(btn, `${saved} ✓`, SAVE_LABEL);
    if (res.sync.state === "sent") return flash(btn, `${saved} & sent ✓`, SAVE_LABEL);
    flash(btn, `${saved} ✓ · send failed`, SAVE_LABEL, 4000);
    toast(`Saved locally, but sending to your tracking URL failed: ${res.sync.error ?? "unknown error"}. Retry from the extension popup.`, 6000);
  } catch {
    // Happens when the extension was reloaded but this page wasn't.
    flash(btn, "Reload page to save", SAVE_LABEL);
  }
}

async function handlePrefill(submitEl: HTMLElement, btn: HTMLButtonElement) {
  btn.disabled = true;
  btn.textContent = "Filling…";
  try {
    const result = await prefill(scopeFor(submitEl));
    flash(btn, result.filled ? `Filled ${result.filled} ✓` : "Nothing to fill", PREFILL_LABEL);
    if (!result.filled) toast(describeResult(result));
  } catch {
    flash(btn, "Reload page to prefill", PREFILL_LABEL);
  }
}

function flash(btn: HTMLButtonElement, text: string, label: string, ms = 2000) {
  btn.textContent = text;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = label;
    btn.disabled = false;
  }, ms);
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
  :host { display: inline-flex; gap: 8px; }
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
  button.secondary { background: #fff; color: #1a7f37; box-shadow: inset 0 0 0 1px #1a7f37; }
  button.secondary:hover:not(:disabled) { background: #f0f7f2; }
  button:disabled { opacity: .85; cursor: default; }
`;

// submit element -> injected host element
const injected = new Map<HTMLElement, HTMLElement>();
let enabled = true;

function makeButton(label: string, className: string, onClick: (btn: HTMLButtonElement) => void) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation(); // keep the page's own click handlers out of it
    onClick(btn);
  });
  return btn;
}

function inject(submitEl: HTMLElement) {
  const host = document.createElement("span");
  host.setAttribute(HOST_ATTR, "");
  host.style.cssText = "display:inline-block;margin:0 0 0 8px;vertical-align:middle;";

  // Shadow DOM keeps the page's CSS off our buttons and ours off the page.
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = BUTTON_STYLES;
  root.append(
    style,
    makeButton(PREFILL_LABEL, "secondary", (btn) => handlePrefill(submitEl, btn)),
    makeButton(SAVE_LABEL, "", (btn) => handleSave(submitEl, btn))
  );

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

// ---------- popup commands ----------

async function prefillPage() {
  const result = await prefill(document);
  // Every frame gets the command; only report from frames that look like a form.
  if (result.filled || countFields(document) >= 3) toast(describeResult(result));
}

function onTabMessage(message: TabMessage, _sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) {
  switch (message.type) {
    case "START_PICKER":
      startPicker();
      break;
    case "STOP_PICKER":
      stopPicker();
      break;
    case "PREFILL_PAGE":
      prefillPage();
      break;
    case "TOGGLE_DARK_MODE":
      toggleDarkMode();
      break;
  }
  sendResponse({ ok: true });
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

  chrome.runtime.onMessage.addListener(onTabMessage);
}

if (!window.__jtcLoaded) {
  window.__jtcLoaded = true;
  start();
}
