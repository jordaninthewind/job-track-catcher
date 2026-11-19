// Popup buttons that act on the current tab: fill it from saved answers, or start the picker.

import { useState } from "react";
import type { TabMessage } from "./types";

async function sendToActiveTab(message: TabMessage): Promise<boolean> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return false;
  try {
    await chrome.tabs.sendMessage(tab.id, message); // reaches every frame, including ATS iframes
    return true;
  } catch {
    return false; // no content script: a chrome:// page, or a tab opened before the extension loaded
  }
}

export function PrefillPageActions() {
  const [error, setError] = useState("");

  const run = async (message: TabMessage) => {
    if (await sendToActiveTab(message)) {
      window.close(); // get the popup out of the way so the page is usable
    } else {
      setError("Can't reach this page. Reload it and try again.");
    }
  };

  return (
    <section className="page-actions">
      <span className="muted">This page</span>
      <button type="button" onClick={() => run({ type: "PREFILL_PAGE" })}>
        Prefill page
      </button>
      <button type="button" className="secondary" onClick={() => run({ type: "START_PICKER" })}>
        Pick fields
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
