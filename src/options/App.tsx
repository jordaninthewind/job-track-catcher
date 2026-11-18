import { useEffect, useState, type FormEvent } from "react";
import { useSettings } from "../lib/hooks";
import type { Settings } from "../lib/types";

export function App() {
  const { settings, loaded, save } = useSettings();
  const [draft, setDraft] = useState<Settings>(settings);
  const [status, setStatus] = useState("");

  // Load stored settings into the form once they arrive.
  useEffect(() => {
    if (loaded) setDraft(settings);
  }, [loaded, settings]);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(""), 1500);
    return () => clearTimeout(t);
  }, [status]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await save({ ...draft, sheetUrl: draft.sheetUrl.trim() });
    setStatus("Saved.");
  };

  return (
    <form onSubmit={onSubmit}>
      <h1>Settings</h1>

      <label htmlFor="sheetUrl">Tracking sheet URL</label>
      <input
        id="sheetUrl"
        type="text"
        placeholder="https://docs.google.com/spreadsheets/d/..."
        value={draft.sheetUrl}
        onChange={(e) => setDraft({ ...draft, sheetUrl: e.target.value })}
      />
      <p className="hint">Not wired up yet — applications are stored locally and can be copied as JSON from the popup.</p>

      <label>
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />{" "}
        Show the "Save Application Data" button on pages
      </label>

      <p>
        <button type="submit" disabled={!loaded}>
          Save
        </button>{" "}
        <span>{status}</span>
      </p>
    </form>
  );
}
