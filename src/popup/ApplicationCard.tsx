import { useState } from "react";
import { sendMessage } from "../lib/storage";
import type { StoredApplication } from "../lib/types";
import { ConfirmButton, CopyButton } from "../components/buttons";
import { toJson } from "./json";

export function ApplicationCard({ record }: { record: StoredApplication }) {
  const { application: app } = record;
  const [showJson, setShowJson] = useState(false);

  const entries = Object.entries(app.inputs);
  const answered = entries.filter(([, value]) => value).length;

  return (
    <li>
      <details>
        <summary>
          <div className="company">{app.company || "Unknown company"}</div>
          <div className="job">{app.role || app.url}</div>
          <div className="meta muted">
            {new Date(record.savedAt).toLocaleString()} · {answered}/{entries.length} answered
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

          {showJson && <pre>{toJson(app)}</pre>}

          <div className="actions">
            <CopyButton getText={() => toJson(app)}>Copy JSON</CopyButton>
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
