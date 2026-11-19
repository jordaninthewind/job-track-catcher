import { useApplications } from "../lib/hooks";
import { sendMessage } from "../lib/storage";
import { ApplicationCard } from "./ApplicationCard";
import { ConfirmButton, CopyButton } from "../components/buttons";
import { PrefillPageActions } from "../prefill/PrefillPageActions";
import { toJson } from "./json";

export function App() {
  const { records, loading } = useApplications();

  return (
    <>
      <PrefillPageActions />

      <header>
        <h1>Saved applications</h1>
        {records.length > 0 && <span className="muted">{records.length} saved</span>}
      </header>

      {!loading && records.length === 0 ? (
        <p className="empty muted">
          Nothing saved yet. Open a job application, fill it in, and click <strong>Save Application Data</strong>{" "}
          next to the submit button.
        </p>
      ) : (
        <ul className="list">
          {records.map((record) => (
            <ApplicationCard key={record.id} record={record} />
          ))}
        </ul>
      )}

      <footer>
        <CopyButton getText={() => toJson(records.map((r) => r.application))} disabled={!records.length}>
          Copy all JSON
        </CopyButton>
        <ConfirmButton
          className="secondary"
          disabled={!records.length}
          onConfirm={() => sendMessage({ type: "CLEAR_APPLICATIONS" })}
        >
          Clear all
        </ConfirmButton>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            chrome.runtime.openOptionsPage();
          }}
        >
          Settings
        </a>
      </footer>
    </>
  );
}
