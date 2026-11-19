/** Question label → answer, in page order. Unanswered questions are "". */
export type Inputs = Record<string, string>;

/** Where an application is in the hiring process. "applied" is the default for new saves. */
export const STAGES = ["applied", "interviewing", "offer", "rejected", "withdrawn"] as const;
export type Stage = (typeof STAGES)[number];
export const DEFAULT_STAGE: Stage = "applied";

/** The value that gets copied, and POSTed to the tracking sheet / endpoint. */
export interface Application {
  url: string;
  company: string;
  role: string;
  /** When you applied (ISO 8601, UTC): the first save. Re-saving the same page keeps it. */
  date: string;
  stage: Stage;
  inputs: Inputs;
}

/** What the content script reads from the page; the background adds `date` and `stage`. */
export type ApplicationInput = Omit<Application, "date" | "stage">;

/** Result of the last POST of an application to the tracking endpoint. */
export interface SyncStatus {
  state: "sent" | "failed";
  at: string;
  httpStatus?: number;
  error?: string;
}

/** How an application is kept in chrome.storage.local. */
export interface StoredApplication {
  id: string;
  savedAt: string;
  application: Application;
  /** Missing until a tracking URL is configured and a send has been attempted. */
  sync?: SyncStatus;
}

export interface Settings {
  /** POST endpoint: a REST API, or a Google Apps Script web app in front of a Sheet. Empty = don't send. */
  sheetUrl: string;
  enabled: boolean;
}

export type Message =
  | { type: "SAVE_APPLICATION"; application: ApplicationInput }
  | { type: "DELETE_APPLICATION"; id: string }
  | { type: "CLEAR_APPLICATIONS" }
  /** Change an application's stage (popup dropdown); re-sent if a tracking URL is set. */
  | { type: "SET_STAGE"; id: string; stage: Stage }
  /** POST a saved application to the tracking endpoint again (popup "Send again"). */
  | { type: "SEND_APPLICATION"; id: string }
  /** POST a sample payload to the configured endpoint (Settings "Send test"). */
  | { type: "SEND_TEST" }
  /** From the Prefill picker in any frame: stop picking in every frame of that tab. */
  | { type: "STOP_PICKER" };

/** Commands the popup / background send to the content script in a tab. */
export type TabMessage =
  | { type: "START_PICKER" }
  | { type: "STOP_PICKER" }
  | { type: "PREFILL_PAGE" }
  | { type: "TOGGLE_DARK_MODE" };

export type MessageResponse =
  | {
      ok: true;
      id?: string;
      updated?: boolean;
      /** Outcome of sending to the tracking endpoint; absent when no URL is configured. */
      sync?: SyncStatus;
    }
  | { ok: false; error: string };
