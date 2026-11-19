// On-page UI for Prefill: the picker banner, the hover highlight and toasts.
// Lives in one shadow-DOM host so page CSS can't touch it (and ours can't leak out).

import { HOST_ATTR } from "../lib/fields";

const STYLES = `
  :host { all: initial; }
  .banner {
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 12px; align-items: center;
    padding: 10px 14px; border-radius: 8px;
    background: #1f2328; color: #fff; font: 13px/1.4 system-ui, sans-serif;
    box-shadow: 0 4px 16px rgba(0,0,0,.25); pointer-events: auto;
  }
  .banner button {
    all: initial; cursor: pointer; font: 600 12px/1 system-ui, sans-serif;
    padding: 6px 10px; border-radius: 6px; background: #1a7f37; color: #fff;
  }
  .highlight {
    position: fixed; border: 2px solid #1a7f37; background: rgba(26,127,55,.08);
    border-radius: 4px; pointer-events: none; box-sizing: border-box;
  }
  .tag {
    position: absolute; left: -2px; bottom: 100%; margin-bottom: 2px; max-width: 420px;
    padding: 2px 6px; border-radius: 4px; background: #1a7f37; color: #fff;
    font: 600 11px/1.4 system-ui, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .toasts {
    position: fixed; bottom: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px;
    align-items: flex-end;
  }
  .toast {
    max-width: 360px; padding: 10px 14px; border-radius: 8px;
    background: #1f2328; color: #fff; font: 13px/1.4 system-ui, sans-serif;
    box-shadow: 0 4px 16px rgba(0,0,0,.25);
  }
  [hidden] { display: none !important; }
`;

let host: HTMLElement | null = null;
let root: ShadowRoot;

function ensureHost() {
  if (host?.isConnected) return;
  host = document.createElement("div");
  host.setAttribute(HOST_ATTR, "");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>${STYLES}</style>
    <div class="highlight" hidden><div class="tag"></div></div>
    <div class="banner" hidden>
      <span>Click a question to add it to <b>Prefill</b>. Review them in Settings.</span>
      <button type="button">Done</button>
    </div>
    <div class="toasts"></div>`;
  document.documentElement.append(host);
}

/** True if the event happened inside our overlay (e.g. the banner's Done button). */
export function isOverlayEvent(event: Event): boolean {
  return !!host && event.composedPath().includes(host);
}

export function showBanner(onDone: () => void) {
  ensureHost();
  const banner = root.querySelector<HTMLElement>(".banner")!;
  banner.hidden = false;
  banner.querySelector("button")!.onclick = onDone;
}

export function hideBanner() {
  if (!host) return;
  root.querySelector<HTMLElement>(".banner")!.hidden = true;
  highlight(null);
}

/** Outlines `el` with a label tag above it, or hides the outline when null. */
export function highlight(el: Element | null, label = "") {
  if (!el && !host) return;
  ensureHost();
  const box = root.querySelector<HTMLElement>(".highlight")!;
  if (!el) {
    box.hidden = true;
    return;
  }
  const r = el.getBoundingClientRect();
  Object.assign(box.style, {
    left: `${r.left - 4}px`,
    top: `${r.top - 4}px`,
    width: `${r.width + 8}px`,
    height: `${r.height + 8}px`,
  });
  box.querySelector(".tag")!.textContent = label;
  box.hidden = false;
}

export function toast(text: string, ms = 3000) {
  ensureHost();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  root.querySelector(".toasts")!.append(el);
  setTimeout(() => el.remove(), ms);
}
