// Service worker: stores application records sent by the content script.
// Records live in chrome.storage.local, so they survive browser restarts
// until the user clears them from the popup.
//
// Stored shape:
//   { id, savedAt, application: { url, company, role, inputs: { [label]: answer } } }
// `application` is the value that gets copied (and later sent to a sheet / endpoint).

const STORAGE_KEY = "applications";
const MAX_RECORDS = 500;

async function getRecords() {
  const { [STORAGE_KEY]: records = [] } = await chrome.storage.local.get(STORAGE_KEY);
  return records;
}

async function setRecords(records) {
  await chrome.storage.local.set({ [STORAGE_KEY]: records.slice(0, MAX_RECORDS) });
}

// Saving the same application page again replaces the earlier record.
async function saveApplication(payload, sender) {
  const application = {
    // The tab URL is the company's job page even when the form is in an ATS iframe.
    url: sender.tab?.url || payload.url || "",
    company: payload.company || "",
    role: payload.role || "",
    inputs: payload.inputs || {},
  };

  const records = await getRecords();
  const existing = records.findIndex((r) => r.application.url === application.url);
  const record = {
    id: existing >= 0 ? records[existing].id : crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    application,
  };

  if (existing >= 0) records.splice(existing, 1);
  records.unshift(record);
  await setRecords(records);

  // TODO: forward `application` to the user's endpoint / Google Sheet once login + destinations exist.
  return { id: record.id, updated: existing >= 0 };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const reply = (promise) => {
    promise.then(
      (data) => sendResponse({ ok: true, ...data }),
      (err) => sendResponse({ ok: false, error: String(err) })
    );
    return true; // keep the channel open for the async response
  };

  switch (message?.type) {
    case "SAVE_APPLICATION":
      return reply(saveApplication(message.application, sender));
    case "DELETE_APPLICATION":
      return reply(getRecords().then((records) => setRecords(records.filter((r) => r.id !== message.id))));
    case "CLEAR_APPLICATIONS":
      return reply(setRecords([]));
    default:
      return false;
  }
});

// Keep the toolbar badge in sync with the number of saved applications.
async function updateBadge(records) {
  const count = (records ?? (await getRecords())).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#1a7f37" });
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) updateBadge(changes[STORAGE_KEY].newValue || []);
});

chrome.runtime.onInstalled.addListener(async () => {
  // Drop records saved by earlier versions with a different shape.
  const records = await getRecords();
  const valid = records.filter((r) => r?.application?.inputs);
  if (valid.length !== records.length) await setRecords(valid);
  updateBadge(valid);
});
chrome.runtime.onStartup.addListener(() => updateBadge());
