// Reading form fields: finding each question's label and current answer.
// Shared by "Save Application Data" (collectInputs) and Prefill (describeField),
// so both always use the same label for the same question.

import type { Inputs } from "./types";

export type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** How a control is answered, which decides how Prefill fills it. */
export type FieldKind = "text" | "select" | "combobox" | "choice" | "toggle" | "file";

export interface Field {
  label: string;
  value: string;
  kind: FieldKind;
}

/** Marks elements the extension injects into pages, so they're never read as page content. */
export const HOST_ATTR = "data-jtc-host";
export const CONTROL_SELECTOR = "input, textarea, select";

const SKIP_TYPES = new Set(["password", "hidden", "submit", "button", "reset", "image"]);
// Labels on helper controls that say nothing about the question (Greenhouse's resume widget, etc.).
const GENERIC_LABELS = /^(attach|upload|choose file|browse|enter manually|dropbox|google drive)$/i;
const FILE_NAME = /\S+\.(pdf|docx?|txt|rtf|odt|pages)$/i;

// ---------- text helpers ----------

export const clean = (s: string | null | undefined): string =>
  (s ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*\*\s*$/, "") // trailing "required" asterisk
    .trim();

export function textOf(node: Element | null | undefined): string {
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

export function isVisible(el: Element): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
}

export function isControl(el: Element | null): el is FormControl {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

const typeOf = (el: FormControl) => (el.type || el.tagName).toLowerCase();

/** Controls a person actually answers: no passwords, hidden inputs, buttons, or our own UI. */
export function isUsable(el: FormControl): boolean {
  if (el.closest(`[${HOST_ATTR}]`) || el.disabled) return false;
  if (el.getAttribute("aria-hidden") === "true") return false; // shadow inputs used for "required" validation
  const type = typeOf(el);
  if (SKIP_TYPES.has(type)) return false;
  return type === "file" || isVisible(el); // file inputs are often visually hidden behind an "Attach" button
}

export function usableControls(scope: ParentNode): FormControl[] {
  return [...scope.querySelectorAll<FormControl>(CONTROL_SELECTOR)].filter(isUsable);
}

export function countFields(scope: ParentNode): number {
  return scope.querySelectorAll(
    "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select"
  ).length;
}

// ---------- labels ----------

export function ownLabel(el: FormControl): string {
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

/** The fieldset / ARIA group a control belongs to, if any. */
export function groupOf(el: Element): Element | null {
  return el.closest('fieldset, [role="radiogroup"], [role="group"]');
}

// The question a control belongs to when the control itself is one option
// or a helper (radio/checkbox groups, file upload widgets).
export function groupLabel(el: Element): string {
  const group = groupOf(el);
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

/** The visible text of a radio/checkbox option, e.g. "Yes". */
export function optionLabel(el: HTMLInputElement): string {
  return ownLabel(el) || el.value;
}

/** All radio/checkbox options belonging to the same question as `el`. */
export function choiceOptions(el: HTMLInputElement): HTMLInputElement[] {
  const group = groupOf(el);
  const scope: ParentNode = group ?? el.form ?? document;
  const options = [...scope.querySelectorAll<HTMLInputElement>(`input[type="${el.type}"]`)].filter(isUsable);
  // Without a fieldset/group, options are tied together by their name attribute.
  return group ? options : options.filter((o) => o.name === el.name);
}

/** Label, current answer and kind for one control. Returns null for controls that aren't questions. */
export function describeField(el: FormControl): Field | null {
  if (!isUsable(el)) return null;
  const type = typeOf(el);

  if (el instanceof HTMLInputElement && (type === "radio" || type === "checkbox")) {
    const question = groupLabel(el);
    const options = choiceOptions(el);
    if (!question && type === "checkbox" && options.length <= 1) {
      // Standalone checkbox, e.g. "I agree to the privacy policy".
      return { label: optionLabel(el), value: el.checked ? "Yes" : "No", kind: "toggle" };
    }
    const value = options
      .filter((o) => o.checked)
      .map(optionLabel)
      .join(", ");
    return { label: question || el.name || optionLabel(el), value, kind: "choice" };
  }

  const label = labelFor(el);
  if (!label) return null;

  if (el instanceof HTMLInputElement && type === "file") return { label, value: fileValue(el), kind: "file" };
  if (el instanceof HTMLSelectElement) {
    const value = [...el.selectedOptions]
      .filter((o) => o.value !== "")
      .map((o) => clean(o.text))
      .join(", ");
    return { label, value, kind: "select" };
  }
  if (el.getAttribute("role") === "combobox") return { label, value: comboboxValue(el), kind: "combobox" };
  return { label, value: el.value.trim(), kind: "text" };
}

/** Returns { "<label>": "<answer>" } in page order. Unanswered questions are kept as "". */
export function collectInputs(scope: ParentNode): Inputs {
  const inputs: Inputs = {};
  for (const el of usableControls(scope)) {
    const field = describeField(el);
    if (!field) continue;
    const current = inputs[field.label];
    // First control wins, unless it was empty and a later one has an answer
    // (e.g. Resume "Attach" was empty but "Enter manually" has text).
    if (current === undefined || (!current && field.value)) inputs[field.label] = field.value;
  }
  return inputs;
}
