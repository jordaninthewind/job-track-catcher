import type { Message, MessageResponse, Settings, StoredApplication } from "./types";

// Saved applications live in chrome.storage.local (survive restarts until cleared).
// Settings live in chrome.storage.sync (follow the user's Chrome profile).

export const APPLICATIONS_KEY = "applications";
export const MAX_RECORDS = 500;
export const DEFAULT_SETTINGS: Settings = { sheetUrl: "", enabled: true };

/** Drops records saved by older versions with a different shape. */
export function isStoredApplication(value: unknown): value is StoredApplication {
  const r = value as StoredApplication | undefined;
  return typeof r?.id === "string" && typeof r.application?.inputs === "object";
}

export async function getRecords(): Promise<StoredApplication[]> {
  const stored = await chrome.storage.local.get(APPLICATIONS_KEY);
  const records: unknown = stored[APPLICATIONS_KEY];
  return Array.isArray(records) ? records.filter(isStoredApplication) : [];
}

export async function setRecords(records: StoredApplication[]): Promise<void> {
  await chrome.storage.local.set({ [APPLICATIONS_KEY]: records.slice(0, MAX_RECORDS) });
}

export async function getSettings(): Promise<Settings> {
  return (await chrome.storage.sync.get(DEFAULT_SETTINGS)) as Settings;
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(settings);
}

/** Typed wrapper around chrome.runtime.sendMessage for messages handled by the background worker. */
export function sendMessage(message: Message): Promise<MessageResponse> {
  return chrome.runtime.sendMessage(message);
}
