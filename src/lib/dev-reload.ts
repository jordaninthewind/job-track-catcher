// Dev builds only (`bun run dev`): reload the extension when the dev server rebuilds.
// Production builds strip the call to this, so it never ships.

export function connectDevReload(port: string) {
  const connect = () => {
    const ws = new WebSocket(`ws://localhost:${port}/__reload`);
    ws.onmessage = (event) => {
      if (event.data === "reload") chrome.runtime.reload();
    };
    // Reconnect whenever the dev server restarts. Its periodic pings also keep
    // this service worker alive while connected (Chrome 116+).
    ws.onclose = () => setTimeout(connect, 1000);
  };
  connect();
}
