// Settings → Prefill: review answers captured from pages, and edit saved answers.

import { useEffect, useState, type FormEvent } from "react";
import { ConfirmButton } from "../components/buttons";
import { acceptPending, deleteEntry, discardPending, findEntry, saveEntry } from "./storage";
import type { PendingPrefill, PrefillEntry } from "./types";
import { usePrefill } from "./usePrefill";

export function PrefillSettings() {
  const { entries, pending, loaded } = usePrefill();

  return (
    <section className="section">
      <h2>Prefill</h2>
      <p className="hint">
        Saved answers are filled into any application question with the same label, on any site. Questions
        that already have an answer are never overwritten. File uploads can't be prefilled.
      </p>
      <p className="hint">
        To add questions from a page: open the extension popup on an application, choose <b>Pick fields</b>,
        then click each question's label. They appear below for you to review and save.
      </p>

      {pending.length > 0 && (
        <div className="group pending">
          <div className="group-header">
            <h3>Captured from pages ({pending.length})</h3>
            <button type="button" onClick={() => acceptPending(pending)}>
              Save all
            </button>
            <button type="button" className="secondary" onClick={() => discardPending(pending.map((p) => p.id))}>
              Discard all
            </button>
          </div>
          {pending.map((item) => (
            <PendingRow key={item.id} item={item} existing={findEntry(entries, item.label)} />
          ))}
        </div>
      )}

      <div className="group">
        <h3>Saved answers ({entries.length})</h3>
        {loaded && entries.length === 0 && <p className="hint">No saved answers yet.</p>}
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
        <AddEntry />
      </div>
    </section>
  );
}

/** Label + answer inputs shared by every row type. */
function Fields({
  label,
  value,
  onLabel,
  onValue,
}: {
  label: string;
  value: string;
  onLabel: (v: string) => void;
  onValue: (v: string) => void;
}) {
  return (
    <div className="fields">
      <input
        type="text"
        aria-label="Question label"
        placeholder="Question label, e.g. LinkedIn Profile"
        value={label}
        onChange={(e) => onLabel(e.target.value)}
      />
      <textarea
        aria-label="Answer"
        placeholder="Answer"
        rows={Math.min(6, Math.max(1, Math.ceil(value.length / 70)))}
        value={value}
        onChange={(e) => onValue(e.target.value)}
      />
    </div>
  );
}

function PendingRow({ item, existing }: { item: PendingPrefill; existing?: PrefillEntry }) {
  const [label, setLabel] = useState(item.label);
  const [value, setValue] = useState(item.value);

  // Picking the same question again on a page updates the captured value.
  useEffect(() => {
    setLabel(item.label);
    setValue(item.value);
  }, [item.label, item.value]);

  return (
    <div className="row">
      <Fields label={label} value={value} onLabel={setLabel} onValue={setValue} />
      <div className="row-meta">
        <span className="hint">
          From {hostOf(item.url)}
          {existing && existing.value !== value && <> · replaces saved answer “{truncate(existing.value)}”</>}
        </span>
        <span className="row-actions">
          <button type="button" disabled={!label.trim()} onClick={() => acceptPending([{ id: item.id, label, value }])}>
            Save
          </button>
          <button type="button" className="secondary" onClick={() => discardPending([item.id])}>
            Discard
          </button>
        </span>
      </div>
    </div>
  );
}

function EntryRow({ entry }: { entry: PrefillEntry }) {
  const [label, setLabel] = useState(entry.label);
  const [value, setValue] = useState(entry.value);

  useEffect(() => {
    setLabel(entry.label);
    setValue(entry.value);
  }, [entry.label, entry.value]);

  const dirty = label !== entry.label || value !== entry.value;

  return (
    <div className="row">
      <Fields label={label} value={value} onLabel={setLabel} onValue={setValue} />
      <div className="row-meta">
        <span />
        <span className="row-actions">
          {dirty && (
            <>
              <button type="button" disabled={!label.trim()} onClick={() => saveEntry({ id: entry.id, label, value })}>
                Save
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setLabel(entry.label);
                  setValue(entry.value);
                }}
              >
                Cancel
              </button>
            </>
          )}
          <ConfirmButton className="danger" onConfirm={() => deleteEntry(entry.id)}>
            Delete
          </ConfirmButton>
        </span>
      </div>
    </div>
  );
}

function AddEntry() {
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await saveEntry({ label, value });
    setLabel("");
    setValue("");
  };

  return (
    <form className="row add" onSubmit={onSubmit}>
      <Fields label={label} value={value} onLabel={setLabel} onValue={setValue} />
      <div className="row-meta">
        <span className="hint">Or add one by hand.</span>
        <button type="submit" disabled={!label.trim()}>
          Add answer
        </button>
      </div>
    </form>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "a page";
  }
}

const truncate = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);
