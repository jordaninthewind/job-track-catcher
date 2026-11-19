/** Question label → answer, in page order. Unanswered questions are "". */
export type Inputs = Record<string, string>;

/** The value that gets copied, and later sent to a sheet / endpoint. */
export interface Application {
  url: string;
  company: string;
  role: string;
  inputs: Inputs;
}

/** How an application is kept in chrome.storage.local. */
export interface StoredApplication {
  id: string;
  savedAt: string;
  application: Application;
}

export interface Settings {
  sheetUrl: string;
  enabled: boolean;
}

export type Message =
  | { type: "SAVE_APPLICATION"; application: Application }
  | { type: "DELETE_APPLICATION"; id: string }
  | { type: "CLEAR_APPLICATIONS" }
  /** From the Prefill picker in any frame: stop picking in every frame of that tab. */
  | { type: "STOP_PICKER" };

/** Commands the popup / background send to the content script in a tab. */
export type TabMessage =
  | { type: "START_PICKER" }
  | { type: "STOP_PICKER" }
  | { type: "PREFILL_PAGE" }
  | { type: "TOGGLE_DARK_MODE" };

export type MessageResponse =
  | { ok: true; id?: string; updated?: boolean }
  | { ok: false; error: string };
