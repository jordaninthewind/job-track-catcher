import { useEffect, useState } from "react";
import { getPending, getPrefill, PENDING_KEY, PREFILL_KEY } from "./storage";
import type { PendingPrefill, PrefillEntry } from "./types";

/** Saved and captured-but-unsaved Prefill answers, kept live as pages add new ones. */
export function usePrefill() {
  const [entries, setEntries] = useState<PrefillEntry[]>([]);
  const [pending, setPending] = useState<PendingPrefill[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([getPrefill(), getPending()]).then(([e, p]) => {
      setEntries(e);
      setPending(p);
      setLoaded(true);
    });

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      const list = (key: string) => {
        const next: unknown = changes[key]?.newValue;
        return Array.isArray(next) ? next : [];
      };
      if (changes[PREFILL_KEY]) setEntries(list(PREFILL_KEY));
      if (changes[PENDING_KEY]) setPending(list(PENDING_KEY));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  return { entries, pending, loaded };
}
