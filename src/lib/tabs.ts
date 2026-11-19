import type { TabMessage } from "./types";

/**
 * Sends a command to the content script in the active tab. It reaches every frame,
 * including ATS iframes. Returns false when the tab has no content script
 * (a chrome:// page, or a tab opened before the extension loaded).
 */
export async function sendToActiveTab(message: TabMessage): Promise<boolean> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return false;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
    return true;
  } catch {
    return false;
  }
}
