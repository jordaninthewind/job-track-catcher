import { useCallback, useEffect, useState } from "react";
import { APPLICATIONS_KEY, DEFAULT_SETTINGS, getRecords, getSettings, isStoredApplication, saveSettings } from "./storage";
import type { Settings, StoredApplication } from "./types";

/** Saved applications, kept live as the background worker writes new ones. */
export function useApplications(): { records: StoredApplication[]; loading: boolean } {
  const [records, setRecords] = useState<StoredApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getRecords().then((r) => {
      setRecords(r);
      setLoading(false);
    });

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const change = changes[APPLICATIONS_KEY];
      if (area !== "local" || !change) return;
      const next: unknown = change.newValue;
      setRecords(Array.isArray(next) ? next.filter(isStoredApplication) : []);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  return { records, loading };
}

/** Extension settings from chrome.storage.sync, with a save function. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
  }, []);

  const save = useCallback(async (next: Settings) => {
    await saveSettings(next);
    setSettings(next);
  }, []);

  return { settings, loaded, save };
}
