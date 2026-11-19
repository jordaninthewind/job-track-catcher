// Service worker: stores application records sent by the content script, POSTs them to
// the tracking endpoint from Settings, and keeps the toolbar badge count in sync.

import { connectDevReload } from "./lib/dev-reload";
import { postToEndpoint, TEST_PAYLOAD } from "./lib/endpoint";
import { APPLICATIONS_KEY, getRecords, getSettings, setRecords } from "./lib/storage";
import type { Application, Message, MessageResponse, StoredApplication, SyncStatus, TabMessage } from "./lib/types";

if (process.env.NODE_ENV === "development") connectDevReload(process.env.DEV_SERVER_PORT ?? "8000");

// Saving the same application page again replaces the earlier record.
async function saveApplication(payload: Application, sender: chrome.runtime.MessageSender) {
  const application: Application = {
    // The tab URL is the company's job page even when the form is in an ATS iframe.
    url: sender.tab?.url || payload.url || "",
    company: payload.company || "",
    role: payload.role || "",
    inputs: payload.inputs || {},
  };

  const records = await getRecords();
  const existing = records.findIndex((r) => r.application.url === application.url);
  const record: StoredApplication = {
    id: records[existing]?.id ?? crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    application,
  };

  if (existing >= 0) records.splice(existing, 1);
  records.unshift(record);
  await setRecords(records);

  const sync = await sendApplication(record.id);
  return { id: record.id, updated: existing >= 0, sync };
}

// ---------- tracking endpoint ----------

/**
 * POSTs a saved application to the configured endpoint and records the outcome on it.
 * Returns undefined when no endpoint is configured.
 */
async function sendApplication(id: string): Promise<SyncStatus | undefined> {
  const { sheetUrl } = await getSettings();
  if (!sheetUrl) return undefined;

  const record = (await getRecords()).find((r) => r.id === id);
  if (!record) throw new Error("That application no longer exists.");

  const sync = await postToEndpoint(sheetUrl, record.application);

  // Re-read: other saves may have happened while the request was in flight.
  const records = await getRecords();
  await setRecords(records.map((r) => (r.id === id ? { ...r, sync } : r)));
  return sync;
}

async function sendTest(): Promise<SyncStatus> {
  const { sheetUrl } = await getSettings();
  if (!sheetUrl) throw new Error("Enter and save a URL first.");
  return postToEndpoint(sheetUrl, TEST_PAYLOAD);
}

async function handle(message: Message, sender: chrome.runtime.MessageSender): Promise<MessageResponse> {
  switch (message.type) {
    case "SAVE_APPLICATION":
      return { ok: true, ...(await saveApplication(message.application, sender)) };
    case "DELETE_APPLICATION":
      await setRecords((await getRecords()).filter((r) => r.id !== message.id));
      return { ok: true };
    case "CLEAR_APPLICATIONS":
      await setRecords([]);
      return { ok: true };
    case "SEND_APPLICATION": {
      const sync = await sendApplication(message.id);
      return sync ? { ok: true, sync } : { ok: false, error: "No tracking URL is set. Add one in Settings." };
    }
    case "SEND_TEST":
      return { ok: true, sync: await sendTest() };
    case "STOP_PICKER":
      // Relay to every frame in the sender's tab.
      if (sender.tab?.id !== undefined) await chrome.tabs.sendMessage(sender.tab.id, { type: "STOP_PICKER" } satisfies TabMessage);
      return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handle(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err) } satisfies MessageResponse));
  return true; // keep the channel open for the async response
});

// ---------- badge ----------

async function updateBadge(count?: number) {
  const n = count ?? (await getRecords()).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#1a7f37" });
  await chrome.action.setBadgeText({ text: n ? String(n) : "" });
}

chrome.storage.onChanged.addListener((changes, area) => {
  const next: unknown = changes[APPLICATIONS_KEY]?.newValue;
  if (area === "local" && changes[APPLICATIONS_KEY]) updateBadge(Array.isArray(next) ? next.length : 0);
});

chrome.runtime.onInstalled.addListener(async () => {
  // getRecords() filters out records from older versions; write that back.
  const records = await getRecords();
  await setRecords(records);
  updateBadge(records.length);
});
chrome.runtime.onStartup.addListener(() => updateBadge());
