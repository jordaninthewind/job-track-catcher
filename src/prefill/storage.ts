// Prefill answers live in chrome.storage.local, keyed by question label rather than
// by site, so they apply to any application form. (storage.sync's 8 KB-per-item
// limit is too small for long written answers.)

import type { PendingPrefill, PrefillEntry } from "./types";

export const PREFILL_KEY = "prefill";
export const PENDING_KEY = "prefillPending";

/** Label used for matching: case, punctuation, "*" and "(optional)" don't matter. */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\((optional|required)\)/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const sameLabel = (a: string, b: string) => normalizeLabel(a) === normalizeLabel(b);
const now = () => new Date().toISOString();

async function read<T>(key: string): Promise<T[]> {
  const stored = await chrome.storage.local.get(key);
  const value: unknown = stored[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

const write = (key: string, value: unknown[]) => chrome.storage.local.set({ [key]: value });

// Every change below is read → modify → write. Running them one at a time stops quick
// successive changes (e.g. clicking several questions in the picker) from overwriting each other.
let queue: Promise<unknown> = Promise.resolve();
function serialized<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
  return (...args: A): Promise<void> => {
    const run = queue.then(() => fn(...args));
    queue = run.catch(() => {});
    return run;
  };
}

export const getPrefill = () => read<PrefillEntry>(PREFILL_KEY);
export const getPending = () => read<PendingPrefill>(PENDING_KEY);

/** Adds or updates a saved answer. A different entry with the same label is replaced. */
export const saveEntry = serialized(async (entry: { id?: string; label: string; value: string }) => {
  const label = entry.label.trim();
  if (!label) return;
  const entries = await getPrefill();
  const match = entries.find((e) => e.id === entry.id) ?? entries.find((e) => sameLabel(e.label, label));
  const saved: PrefillEntry = { id: match?.id ?? crypto.randomUUID(), label, value: entry.value, updatedAt: now() };

  // Update in place, and drop any other entry that now has the same label (e.g. after renaming one).
  const next = entries
    .map((e) => (e.id === saved.id ? saved : e))
    .filter((e) => e === saved || !sameLabel(e.label, label));
  if (!match) next.push(saved);
  await write(PREFILL_KEY, next);
});

export const deleteEntry = serialized(async (id: string) => {
  await write(PREFILL_KEY, (await getPrefill()).filter((e) => e.id !== id));
});

/** Called from the page picker. Clicking the same question again updates its captured value. */
export const addPending = serialized(async (label: string, value: string, url: string) => {
  const pending = await getPending();
  const existing = pending.find((p) => sameLabel(p.label, label));
  const item: PendingPrefill = { id: existing?.id ?? crypto.randomUUID(), label, value, url, capturedAt: now() };
  await write(PENDING_KEY, existing ? pending.map((p) => (p.id === item.id ? item : p)) : [...pending, item]);
});

export const discardPending = serialized(async (ids: string[]) => {
  await write(PENDING_KEY, (await getPending()).filter((p) => !ids.includes(p.id)));
});

/** Moves captured answers (with any edits made in Settings) into the saved list. */
export async function acceptPending(items: { id: string; label: string; value: string }[]): Promise<void> {
  for (const item of items) await saveEntry({ label: item.label, value: item.value });
  await discardPending(items.map((i) => i.id));
}

/** The saved answer for a question label, if any. */
export function findEntry(entries: PrefillEntry[], label: string): PrefillEntry | undefined {
  return entries.find((e) => sameLabel(e.label, label));
}
