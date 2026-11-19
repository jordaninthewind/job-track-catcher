// Sending applications to the user's tracking endpoint (Settings → Tracking sheet / endpoint URL).
// Used by the background worker to POST, and by Settings to validate the URL and request access.

import type { Application, SyncStatus } from "./types";

const TIMEOUT_MS = 15_000;

/** Body for "Send test": looks like a real application so endpoints can be checked end to end. */
export const TEST_PAYLOAD = {
  test: true,
  url: "https://example.com/jobs/test",
  company: "Job Track Catcher",
  role: "Test request",
  date: new Date(0).toISOString(),
  stage: "applied",
  inputs: { Note: "Sent from Settings → Send test. Safe to delete." },
};

/**
 * Checks a URL the user typed. Returns an error message, or null if it's usable.
 * A Google Sheet's own URL can't receive POSTs; it needs the Apps Script web app in front of it.
 */
export function validateEndpoint(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That isn't a valid URL.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "The URL must start with https://.";
  if (url.hostname === "docs.google.com" && url.pathname.startsWith("/spreadsheets")) {
    return "That's the spreadsheet itself, which can't receive data. Set up the Apps Script below and paste its web app URL (ending in /exec).";
  }
  return null;
}

/**
 * Host permissions needed to POST to `raw`. Apps Script web apps answer with a redirect to
 * script.googleusercontent.com, so that origin is needed too.
 */
export function originsFor(raw: string): string[] {
  const url = new URL(raw);
  // Match patterns without a port cover every port (e.g. a local server on :3000).
  const origins = [`${url.protocol}//${url.hostname}/*`];
  if (url.hostname === "script.google.com") origins.push("https://script.googleusercontent.com/*");
  return origins;
}

const now = () => new Date().toISOString();

/**
 * POSTs `body` as JSON. Never throws: failures come back as a "failed" status with a reason.
 * Runs in the background worker, where the host permission granted in Settings lets the
 * request through without the endpoint needing CORS headers.
 */
export async function postToEndpoint(endpoint: string, body: Application | typeof TEST_PAYLOAD): Promise<SyncStatus> {
  try {
    if (!(await chrome.permissions.contains({ origins: originsFor(endpoint) }))) {
      return {
        state: "failed",
        at: now(),
        error: "No access to this URL yet. Open Settings and click Save to grant it.",
      };
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      return { state: "failed", at: now(), httpStatus: res.status, error: `HTTP ${res.status}${text ? `: ${text}` : ""}` };
    }

    // Endpoints may report failure in a 200 body as { ok: false, error } (the Apps Script does).
    const json: unknown = await res.json().catch(() => null);
    const reply = json as { ok?: unknown; error?: unknown } | null;
    if (reply && reply.ok === false) {
      return { state: "failed", at: now(), httpStatus: res.status, error: String(reply.error ?? "Endpoint reported a failure") };
    }
    return { state: "sent", at: now(), httpStatus: res.status };
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return { state: "failed", at: now(), error: timedOut ? `No response after ${TIMEOUT_MS / 1000}s` : String(err) };
  }
}
