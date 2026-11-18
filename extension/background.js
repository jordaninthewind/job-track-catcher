// Service worker: receives captured form data from content scripts and stores it.

const STORAGE_KEY = "captures";
const MAX_CAPTURES = 500;

chrome.runtime.onInstalled.addListener(async () => {
  const { [STORAGE_KEY]: existing } = await chrome.storage.local.get(STORAGE_KEY);
  if (!existing) await chrome.storage.local.set({ [STORAGE_KEY]: [] });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case "FORM_CAPTURED":
      saveCapture(message.payload, sender)
        .then((capture) => sendResponse({ ok: true, id: capture.id }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true; // keep the channel open for the async response

    case "GET_CAPTURES":
      getCaptures().then((captures) => sendResponse({ ok: true, captures }));
      return true;

    case "CLEAR_CAPTURES":
      chrome.storage.local
        .set({ [STORAGE_KEY]: [] })
        .then(() => sendResponse({ ok: true }));
      return true;

    default:
      return false;
  }
});

async function getCaptures() {
  const { [STORAGE_KEY]: captures = [] } = await chrome.storage.local.get(STORAGE_KEY);
  return captures;
}

async function saveCapture(payload, sender) {
  const capture = {
    id: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    url: payload.url ?? sender.tab?.url ?? "",
    pageTitle: payload.pageTitle ?? sender.tab?.title ?? "",
    fields: payload.fields ?? {},
  };

  const captures = await getCaptures();
  captures.unshift(capture);
  await chrome.storage.local.set({
    [STORAGE_KEY]: captures.slice(0, MAX_CAPTURES),
  });

  // TODO: push to tracking sheet (e.g. Google Sheets API) once configured in options.
  return capture;
}
