// Picker mode: started from the popup ("Pick fields"). Hovering a question
// highlights it; clicking it saves { label, current value } to the pending list,
// which shows up in Settings → Prefill to review and save.

import {
  CONTROL_SELECTOR,
  describeField,
  groupOf,
  isControl,
  isUsable,
  usableControls,
  type Field,
  type FormControl,
} from "../lib/fields";
import { hideBanner, highlight, isOverlayEvent, showBanner, toast } from "./overlay";
import { addPending } from "./storage";

const CURSOR_STYLE_ID = "jtc-picker-cursor";
// Events we swallow while picking so the page doesn't react (open dropdowns, follow links, submit…).
const BLOCKED = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"] as const;

let active = false;

function firstControl(container: Element | null): FormControl | null {
  if (!container) return null;
  return [...container.querySelectorAll<FormControl>(CONTROL_SELECTOR)].find(isUsable) ?? null;
}

/** Finds the form control a clicked element belongs to: the input itself, its label, legend or wrapper. */
function controlFor(target: Element): FormControl | null {
  if (isControl(target)) return isUsable(target) ? target : null;

  const label = target.closest("label");
  if (label) {
    const control = label.control ?? label.querySelector(CONTROL_SELECTOR);
    if (isControl(control) && isUsable(control)) return control;
  }

  const legend = target.closest("legend");
  if (legend) return firstControl(legend.parentElement);

  // Text elements referenced by aria-labelledby (Greenhouse question labels, upload groups).
  for (let node: Element | null = target, i = 0; node && i < 4; node = node.parentElement, i++) {
    if (!node.id) continue;
    const ref = document.querySelector(`[aria-labelledby~="${CSS.escape(node.id)}"]`);
    if (ref) return isControl(ref) ? (isUsable(ref) ? ref : null) : firstControl(ref);
  }

  // A wrapper around a single question (e.g. a field container with the label and input).
  for (let node: Element | null = target, i = 0; node && node !== document.body && i < 4; node = node.parentElement, i++) {
    const controls = usableControls(node);
    if (!controls.length) continue;
    const labels = new Set(controls.map((c) => describeField(c)?.label));
    return labels.size === 1 ? controls[0]! : null;
  }
  return null;
}

/** The element to outline: the smallest box around the question text and its control. */
function outlineFor(control: FormControl): Element {
  const label = control.labels?.[0] ?? groupOf(control);
  if (!label || label.contains(control)) return label ?? control;
  let common: Element | null = label.parentElement;
  while (common && !common.contains(control)) common = common.parentElement;
  return common && common.getBoundingClientRect().height < 400 ? common : label;
}

function resolve(event: Event): { control: FormControl; field: Field } | null {
  const target = event.target;
  if (!(target instanceof Element) || isOverlayEvent(event)) return null;
  const control = controlFor(target);
  const field = control && describeField(control);
  return control && field ? { control, field } : null;
}

function onMove(event: MouseEvent) {
  const hit = resolve(event);
  highlight(hit && outlineFor(hit.control), hit ? `${hit.field.label}${hit.field.value ? ` → ${hit.field.value}` : ""}` : "");
}

function onBlocked(event: Event) {
  if (isOverlayEvent(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.type === "click") capture(event);
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") requestStop();
}

async function capture(event: Event) {
  const hit = resolve(event);
  if (!hit) return toast("That isn't a form question. Click a question's label or field.");
  const { label, value, kind } = hit.field;
  if (kind === "file") return toast("File uploads can't be prefilled.");
  await addPending(label, value, location.href);
  toast(value ? `Added “${label}” to Prefill.` : `Added “${label}” (empty — fill in the answer in Settings).`);
}

// Stopping goes through the background so every frame in the tab (e.g. a Greenhouse
// iframe and the page around it) leaves picker mode together.
function requestStop() {
  chrome.runtime.sendMessage({ type: "STOP_PICKER" }).catch(stopPicker);
}

export function startPicker() {
  if (active) return;
  // Only show the banner where there's something to pick (and always in the top frame).
  if (window !== window.top && usableControls(document).length === 0) return;
  active = true;

  showBanner(requestStop);
  const style = document.createElement("style");
  style.id = CURSOR_STYLE_ID;
  style.textContent = "* { cursor: crosshair !important; }";
  document.head.append(style);

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("keydown", onKey, true);
  for (const type of BLOCKED) window.addEventListener(type, onBlocked, true);
}

export function stopPicker() {
  if (!active) return;
  active = false;
  hideBanner();
  document.getElementById(CURSOR_STYLE_ID)?.remove();
  document.removeEventListener("mousemove", onMove, true);
  document.removeEventListener("keydown", onKey, true);
  for (const type of BLOCKED) window.removeEventListener(type, onBlocked, true);
}
