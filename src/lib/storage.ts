import { DEFAULT_STAGE, STAGES, type Message, type MessageResponse, type Settings, type Stage, type StoredApplication } from "./types";

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

export const isStage = (value: unknown): value is Stage => STAGES.includes(value as Stage);

/**
 * Fills in fields added after a record was saved: records from before `date`/`stage`
 * existed get their save time as the applied date and the default stage.
 */
export function normalizeRecord(record: StoredApplication): StoredApplication {
  const app = record.application;
  if (app.date && isStage(app.stage)) return record;
  return {
    ...record,
    application: {
      url: app.url,
      company: app.company,
      role: app.role,
      date: app.date || record.savedAt,
      stage: isStage(app.stage) ? app.stage : DEFAULT_STAGE,
      inputs: app.inputs,
    },
  };
}

/** Valid records from any stored value, upgraded to the current shape. */
export function toRecords(value: unknown): StoredApplication[] {
  return Array.isArray(value) ? value.filter(isStoredApplication).map(normalizeRecord) : [];
}

export async function getRecords(): Promise<StoredApplication[]> {
  const stored = await chrome.storage.local.get(APPLICATIONS_KEY);
  return toRecords(stored[APPLICATIONS_KEY]);
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
