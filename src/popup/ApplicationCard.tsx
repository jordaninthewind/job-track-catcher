import { useState } from "react";
import { sendMessage } from "../lib/storage";
import type { StoredApplication, SyncStatus } from "../lib/types";
import { ConfirmButton, CopyButton } from "../components/buttons";
import { toJson } from "./json";

/** "Sent" / "Send failed" note for the card's summary line. */
function syncLabel(sync?: SyncStatus): { text: string; className: string } | null {
  if (!sync) return null;
  return sync.state === "sent"
    ? { text: "Sent", className: "sent" }
    : { text: "Send failed", className: "failed" };
}

function SendButton({ id, sync }: { id: string; sync?: SyncStatus }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    setSending(true);
    setError("");
    try {
      const res = await sendMessage({ type: "SEND_APPLICATION", id });
      if (!res.ok) setError(res.error);
    } finally {
      setSending(false); // the card re-renders with the new sync status from storage
    }
  };
  return (
    <>
      <button type="button" className="secondary" disabled={sending} onClick={send}>
        {sending ? "Sending…" : sync ? "Send again" : "Send"}
      </button>
      {error && <span className="failed">{error}</span>}
    </>
  );
}

export function ApplicationCard({ record, canSend }: { record: StoredApplication; canSend: boolean }) {
  const { application: app } = record;
  const [showJson, setShowJson] = useState(false);

  const entries = Object.entries(app.inputs);
  const answered = entries.filter(([, value]) => value).length;
  const sync = syncLabel(record.sync);

  return (
    <li>
      <details>
        <summary>
          <div className="company">{app.company || "Unknown company"}</div>
          <div className="job">{app.role || app.url}</div>
          <div className="meta muted">
            {new Date(record.savedAt).toLocaleString()} · {answered}/{entries.length} answered
            {sync && (
              <>
                {" · "}
                <span className={sync.className}>{sync.text}</span>
              </>
            )}
          </div>
        </summary>

        <div className="body">
          <dl className="fields">
            {entries.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={value ? undefined : "muted"}>{value || "—"}</dd>
              </div>
            ))}
          </dl>

          {record.sync?.state === "failed" && (
            <p className="failed sync-error">
              Last send failed ({new Date(record.sync.at).toLocaleString()}): {record.sync.error}
            </p>
          )}

          {showJson && <pre>{toJson(app)}</pre>}

          <div className="actions">
            <CopyButton getText={() => toJson(app)}>Copy JSON</CopyButton>
            {canSend && <SendButton id={record.id} sync={record.sync} />}
            <button type="button" className="secondary" onClick={() => setShowJson((v) => !v)}>
              {showJson ? "Hide JSON" : "View JSON"}
            </button>
            <ConfirmButton className="danger" onConfirm={() => sendMessage({ type: "DELETE_APPLICATION", id: record.id })}>
              Delete
            </ConfirmButton>
            <a href={app.url} target="_blank" rel="noreferrer">
              Open page
            </a>
          </div>
        </div>
      </details>
    </li>
  );
}
