import { useEffect, useState, type FormEvent } from "react";
import appsScript from "../../integrations/google-sheets/Code.gs" with { type: "text" };
import { CopyButton } from "../components/buttons";
import { originsFor, validateEndpoint } from "../lib/endpoint";
import { useSettings } from "../lib/hooks";
import { sendMessage } from "../lib/storage";
import type { Settings } from "../lib/types";
import { PrefillSettings } from "../prefill/PrefillSettings";

export function App() {
  return (
    <main>
      <h1>Settings</h1>
      <GeneralSettings />
      <PrefillSettings />
    </main>
  );
}

type Status = { kind: "ok" | "error"; text: string } | null;

function GeneralSettings() {
  const { settings, loaded, save } = useSettings();
  const [draft, setDraft] = useState<Settings>(settings);
  const [status, setStatus] = useState<Status>(null);
  const [testStatus, setTestStatus] = useState<Status>(null);
  const [testing, setTesting] = useState(false);

  // Load stored settings into the form once they arrive.
  useEffect(() => {
    if (loaded) setDraft(settings);
  }, [loaded, settings]);

  // Success messages fade; errors stay until the next action.
  useEffect(() => {
    if (status?.kind !== "ok") return;
    const t = setTimeout(() => setStatus(null), 2000);
    return () => clearTimeout(t);
  }, [status]);

  const url = draft.sheetUrl.trim();
  const unsavedUrl = url !== settings.sheetUrl;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTestStatus(null);

    if (url) {
      const problem = validateEndpoint(url);
      if (problem) return setStatus({ kind: "error", text: problem });

      // Chrome only shows the permission prompt during a click, so this must be the
      // first async call in the handler (no awaits before it).
      const granted = await chrome.permissions.request({ origins: originsFor(url) });
      if (!granted) {
        return setStatus({
          kind: "error",
          text: "Access to that site was declined, so applications can't be sent there. Click Save to try again.",
        });
      }
    }

    await save({ ...draft, sheetUrl: url });
    setStatus({ kind: "ok", text: url ? "Saved. New applications will be sent to this URL." : "Saved." });
  };

  const sendTest = async () => {
    setTesting(true);
    setTestStatus(null);
    try {
      const res = await sendMessage({ type: "SEND_TEST" });
      if (!res.ok) setTestStatus({ kind: "error", text: res.error });
      else if (res.sync?.state === "sent") setTestStatus({ kind: "ok", text: `Connected (HTTP ${res.sync.httpStatus}).` });
      else setTestStatus({ kind: "error", text: res.sync?.error ?? "Failed." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <form className="section" onSubmit={onSubmit}>
      <h2>General</h2>

      <label htmlFor="sheetUrl">Tracking sheet / endpoint URL</label>
      <input
        id="sheetUrl"
        type="url"
        placeholder="https://script.google.com/macros/s/…/exec or https://api.example.com/applications"
        value={draft.sheetUrl}
        onChange={(e) => setDraft({ ...draft, sheetUrl: e.target.value })}
      />
      <p className="hint">
        Every application you save is sent here as a JSON <code>POST</code> of{" "}
        <code>{"{ url, company, role, date, stage, inputs }"}</code>. Leave empty to keep applications in the extension only.
        Chrome asks once for access to the site when you save.
      </p>

      <details className="hint">
        <summary>Sending to a Google Sheet</summary>
        <ol>
          <li>
            Open your sheet → <b>Extensions → Apps Script</b>.
          </li>
          <li>
            Replace <code>Code.gs</code> with this script and save: <CopyButton getText={() => appsScript}>Copy script</CopyButton>
          </li>
          <li>
            <b>Deploy → New deployment</b> → type <b>Web app</b>. Execute as <b>Me</b>, access <b>Anyone</b>.
          </li>
          <li>Authorize, copy the Web app URL (ends in /exec), paste it above, then Save and Send test.</li>
        </ol>
        <p>
          Each application becomes a row (Date, Stage, Company, Role, URL, Saved at, then a column per question).
          Saving the same job again, or changing its stage, updates its row. Anyone with the /exec URL can add rows, so keep it private.
        </p>
      </details>

      <label>
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />{" "}
        Show the "Prefill" and "Save Application Data" buttons on pages
      </label>

      <p className="actions">
        <button type="submit" disabled={!loaded}>
          Save
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!settings.sheetUrl || unsavedUrl || testing}
          title={unsavedUrl ? "Save the URL first" : undefined}
          onClick={sendTest}
        >
          {testing ? "Sending…" : "Send test"}
        </button>
        {status && <span className={status.kind}>{status.text}</span>}
        {!status && testStatus && <span className={testStatus.kind}>{testStatus.text}</span>}
      </p>
    </form>
  );
}
