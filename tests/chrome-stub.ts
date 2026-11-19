// Minimal in-memory stand-in for the chrome.* APIs the background worker uses,
// so src/background.ts can run under `bun test`.

type Listener = (...args: any[]) => unknown;

function area(data: Record<string, unknown>) {
  return {
    data,
    async get(keys: string | Record<string, unknown>) {
      if (typeof keys === "string") return keys in data ? { [keys]: structuredClone(data[keys]) } : {};
      const out: Record<string, unknown> = {};
      for (const k in keys) out[k] = k in data ? structuredClone(data[k]) : keys[k];
      return out;
    },
    async set(values: Record<string, unknown>) {
      Object.assign(data, structuredClone(values));
    },
  };
}

export function installChromeStub() {
  const messageListeners: Listener[] = [];
  const stub = {
    local: area({}),
    sync: area({ sheetUrl: "", enabled: true }),
    /** Whether chrome.permissions.contains reports access to the endpoint. */
    granted: true,
    /** Deliver a runtime message to the background's onMessage listener and await its reply. */
    send(message: unknown, sender: unknown = { tab: { url: "https://acme.com/jobs/1" } }): Promise<any> {
      return new Promise((resolve) => messageListeners.forEach((l) => l(message, sender, resolve)));
    },
  };

  (globalThis as any).chrome = {
    storage: { local: stub.local, sync: stub.sync, onChanged: { addListener() {} } },
    runtime: {
      onMessage: { addListener: (l: Listener) => messageListeners.push(l) },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
    },
    permissions: { contains: async () => stub.granted },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    tabs: { sendMessage: async () => {} },
  };
  return stub;
}
