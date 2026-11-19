// "This page" row at the top of the popup: commands for the active tab.

import { useState } from "react";
import { sendToActiveTab } from "../lib/tabs";
import type { TabMessage } from "../lib/types";
import { PrefillPageActions } from "../prefill/PrefillPageActions";

export function PageActions() {
  const [error, setError] = useState("");

  const run = async (message: TabMessage, closePopup: boolean) => {
    if (!(await sendToActiveTab(message))) {
      setError("Can't reach this page. Reload it and try again.");
    } else if (closePopup) {
      window.close();
    }
  };

  return (
    <section className="page-actions">
      <span className="muted">This page</span>
      <PrefillPageActions run={run} />
      {/* Stays open so dark mode can be switched straight back off. */}
      <button type="button" className="secondary" onClick={() => run({ type: "TOGGLE_DARK_MODE" }, false)}>
        Dark mode
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
