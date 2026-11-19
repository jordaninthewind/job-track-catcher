// Fills a form from saved Prefill answers. Only empty questions are filled;
// anything already answered on the page is left alone.

import { choiceOptions, describeField, optionLabel, usableControls, type FormControl } from "../lib/fields";
import { findEntry, getPrefill, normalizeLabel } from "./storage";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const same = (a: string, b: string) => normalizeLabel(a) === normalizeLabel(b);

// React tracks input values by wrapping the element's `value` setter. Going through the
// prototype's native setter bypasses that wrapper, so React sees a changed value when the
// `input` event fires and updates its state (plain `el.value = x` can be silently ignored).
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const option = [...el.options].find((o) => o.value !== "" && (same(o.text, value) || o.value === value));
  if (!option) return false;
  el.value = option.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

/** Radio/checkbox question. `value` may list several options: "React, Svelte". */
function fillChoice(el: HTMLInputElement, value: string): boolean {
  const wanted = value.split(/\s*,\s*/).filter(Boolean);
  let changed = false;
  for (const option of choiceOptions(el)) {
    if (!option.checked && wanted.some((w) => same(w, optionLabel(option)))) {
      option.click(); // a real click, so the page's own handlers run
      changed = true;
    }
  }
  return changed;
}

const OPTION_SELECTOR = '[role="option"], [id*="-option-"]';

function findOption(el: HTMLInputElement, value: string): HTMLElement | undefined {
  // Prefer the dropdown's own menu (other widgets on the page, like a phone country
  // picker, also render role="option"), then its listbox, then anywhere (portaled menus).
  const container = el.closest('[class*="container"], [class*="Container"], .select');
  const listbox = el.getAttribute("aria-controls");
  const scopes = [container, listbox && document.getElementById(listbox), document].filter(Boolean) as ParentNode[];
  for (const scope of scopes) {
    const match = [...scope.querySelectorAll<HTMLElement>(OPTION_SELECTOR)].find((o) => same(o.textContent ?? "", value));
    if (match) return match;
  }
  return undefined;
}

// Custom dropdowns (react-select etc.). Greenhouse controls the menu itself and only opens it
// on real pointer/keyboard events, so this replays what a person does: click the control to
// open it, type the answer to filter, then click the matching option.
async function fillCombobox(el: HTMLInputElement, value: string): Promise<boolean> {
  el.focus();
  const control = el.closest<HTMLElement>('[class*="control"], [class*="Control"]') ?? el;
  for (const type of ["mousedown", "mouseup", "click"]) {
    control.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  }
  typeInto(el, value);
  el.dispatchEvent(new KeyboardEvent("keyup", { key: value.slice(-1), bubbles: true }));

  for (let waited = 0; waited < 1500; waited += 50) {
    const match = findOption(el, value);
    if (match) {
      match.click();
      el.blur();
      return true;
    }
    await sleep(50);
  }

  // No matching option: close the menu and clear what we typed.
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  typeInto(el, "");
  el.blur();
  return false;
}

async function fillControl(el: FormControl, value: string): Promise<boolean> {
  const field = describeField(el);
  if (!field) return false;

  switch (field.kind) {
    case "file":
      return false; // browsers don't allow scripts to choose files
    case "toggle":
      if (el instanceof HTMLInputElement && !el.checked && same(value, "yes")) {
        el.click();
        return true;
      }
      return false;
    case "choice":
      return !field.value && el instanceof HTMLInputElement && fillChoice(el, value);
    case "select":
      return !field.value && el instanceof HTMLSelectElement && fillSelect(el, value);
    case "combobox":
      return !field.value && el instanceof HTMLInputElement && fillCombobox(el, value);
    case "text":
      if (field.value || el instanceof HTMLSelectElement) return false;
      typeInto(el, value);
      return true;
  }
}

export interface PrefillResult {
  filled: number;
  /** Questions on the page that have a saved answer (filled or already answered). */
  matched: number;
  /** Total saved answers. */
  saved: number;
}

/** Fills every empty question inside `scope` that has a saved answer. */
export async function prefill(scope: ParentNode): Promise<PrefillResult> {
  const entries = await getPrefill();
  const done = new Set<string>(); // one fill per question (radio groups have many controls)
  let filled = 0;
  let matched = 0;

  for (const el of usableControls(scope)) {
    const field = describeField(el);
    if (!field) continue;
    const key = normalizeLabel(field.label);
    if (done.has(key)) continue;
    const entry = findEntry(entries, field.label);
    if (!entry || !entry.value) continue;

    done.add(key);
    matched++;
    if (await fillControl(el, entry.value)) filled++;
  }

  if (filled) document.activeElement instanceof HTMLElement && document.activeElement.blur();
  return { filled, matched, saved: entries.length };
}

export function describeResult({ filled, matched, saved }: PrefillResult): string {
  if (!saved) return "No prefill answers saved yet. Add some in Settings → Prefill.";
  if (!matched) return "No questions here match your saved answers.";
  if (!filled) return `All ${matched} matching questions are already answered.`;
  return `Prefilled ${filled} question${filled === 1 ? "" : "s"}.`;
}
