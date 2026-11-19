/** A saved answer, filled into any question whose label matches. */
export interface PrefillEntry {
  id: string;
  label: string;
  value: string;
  updatedAt: string;
}

/** An answer captured by clicking a question on a page, waiting to be reviewed in Settings. */
export interface PendingPrefill {
  id: string;
  label: string;
  value: string;
  /** Page it was captured from. */
  url: string;
  capturedAt: string;
}

/** Messages the popup / background send to the content script in a tab. */
export type TabMessage = { type: "START_PICKER" } | { type: "STOP_PICKER" } | { type: "PREFILL_PAGE" };
