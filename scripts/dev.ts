// Local development:
//   - builds ./dist in dev mode and rebuilds on every change in ./src
//   - reloads the extension in Chrome after each rebuild (over a WebSocket)
//   - serves ./test at http://localhost:PORT and refreshes those pages after each rebuild
//
//   bun run dev            (PORT=9000 bun run dev to change the port)

import { watch } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { build, DIST, ROOT, SRC } from "./build";

const PORT = Number(process.env.PORT) || 8000;
const TEST_DIR = path.join(ROOT, "test");
const TOPIC = "reload";

const time = () => new Date().toLocaleTimeString();

// Added to served test pages so they refresh after the extension reloads
// (an already-open page keeps the old, disconnected content script otherwise).
const PAGE_RELOADER = `
<script>
  (function connect() {
    const ws = new WebSocket("ws://" + location.host + "/__reload");
    ws.onmessage = (e) => {
      if (e.data === "reload") setTimeout(() => location.reload(), 500); // let the extension restart first
      if (e.data === "reload-page") location.reload();
    };
    ws.onclose = () => setTimeout(connect, 1000);
  })();
</script>`;

const server = Bun.serve({
  port: PORT,
  hostname: "localhost",
  async fetch(req, server) {
    const { pathname } = new URL(req.url);

    if (pathname === "/__reload") {
      return server.upgrade(req) ? undefined : new Response("Expected a WebSocket", { status: 400 });
    }

    if (pathname === "/") {
      const pages = (await readdir(TEST_DIR)).filter((f) => f.endsWith(".html"));
      const links = pages.map((p) => `<li><a href="/${p}">${p}</a></li>`).join("");
      return new Response(`<!doctype html><title>Test pages</title><h1>Test pages</h1><ul>${links}</ul>`, {
        headers: { "content-type": "text/html" },
      });
    }

    const filePath = path.join(TEST_DIR, path.normalize(decodeURIComponent(pathname)));
    if (!filePath.startsWith(TEST_DIR + path.sep)) return new Response("Forbidden", { status: 403 });

    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    if (filePath.endsWith(".html")) {
      const html = (await file.text()).replace(/<\/body>/i, `${PAGE_RELOADER}</body>`);
      return new Response(html, { headers: { "content-type": "text/html" } });
    }
    return new Response(file);
  },
  websocket: {
    open: (ws) => {
      ws.subscribe(TOPIC);
    },
    close: (ws) => {
      ws.unsubscribe(TOPIC);
    },
    message: () => {},
  },
});

// Keeps the extension's service worker alive while connected.
setInterval(() => server.publish(TOPIC, "ping"), 20_000);

// ---------- build + watch ----------

let timer: ReturnType<typeof setTimeout> | undefined;
let queue = Promise.resolve();

function rebuild(reason: string) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    queue = queue.then(async () => {
      try {
        await build({ dev: true, devPort: PORT });
        console.log(`[${time()}] rebuilt (${reason}) → reloading extension`);
        server.publish(TOPIC, "reload");
      } catch (err) {
        console.error(`[${time()}] build failed:\n${err instanceof Error ? err.message : err}`);
      }
    });
  }, 100);
}

watch(SRC, { recursive: true }, (_event, file) => rebuild(file ?? "change"));
watch(TEST_DIR, { recursive: true }, (_event, file) => {
  console.log(`[${time()}] ${file ?? "test page"} changed → reloading test pages`);
  server.publish(TOPIC, "reload-page");
});

try {
  await build({ dev: true, devPort: PORT });
} catch (err) {
  console.error(`Initial build failed:\n${err instanceof Error ? err.message : err}\nWatching for changes…`);
}

console.log(`
Dev build ready in ${path.relative(process.cwd(), DIST) || "dist"}/

  1. chrome://extensions → Developer mode → Load unpacked → select dist/   (first time only)
  2. Test pages: ${server.url}

Edits in src/ rebuild dist/ and reload the extension automatically.
Run \`bun run build\` before loading dist/ for normal use (removes the dev reloader).
`);
