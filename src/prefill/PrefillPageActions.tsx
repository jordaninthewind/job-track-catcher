// Popup buttons that act on the current tab: fill it from saved answers, or start the picker.

import type { TabMessage } from "../lib/types";

export function PrefillPageActions({ run }: { run: (message: TabMessage, closePopup: boolean) => void }) {
  return (
    <>
      {/* Both close the popup so the page is usable straight away. */}
      <button type="button" onClick={() => run({ type: "PREFILL_PAGE" }, true)}>
        Prefill page
      </button>
      <button type="button" className="secondary" onClick={() => run({ type: "START_PICKER" }, true)}>
        Pick fields
      </button>
    </>
  );
}
