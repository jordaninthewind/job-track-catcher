// Builds the extension from ./src into ./dist.
//
//   bun run build        production build (minified, no dev reloader)
//
// Also exports build() for scripts/dev.ts.

import { rm } from "node:fs/promises";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dir, "..");
export const SRC = path.join(ROOT, "src");
export const DIST = path.join(ROOT, "dist");

interface BuildOptions {
  dev?: boolean;
  devPort?: number;
}

export async function build({
  dev = false,
  devPort = 8000,
}: BuildOptions = {}) {
  await rm(DIST, { recursive: true, force: true });

  const common = {
    outdir: DIST,
    target: "browser",
    throw: false, // report errors via result.logs instead of a bare "Bundle failed"
    minify: !dev,
    sourcemap: dev ? "inline" : "none",
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        dev ? "development" : "production",
      ),
      "process.env.DEV_SERVER_PORT": JSON.stringify(String(devPort)),
    },
  } satisfies Partial<Bun.BuildConfig>;

  // Chrome needs three different kinds of output, so these are separate builds.
  const results = await Promise.all([
    // Popup + options pages: HTML entrypoints; Bun bundles their React + CSS.
    Bun.build({
      ...common,
      entrypoints: [
        path.join(SRC, "popup/index.html"),
        path.join(SRC, "options/index.html"),
      ],
      root: SRC,
      splitting: true,
    }),
    // Service worker: an ES module (manifest has "type": "module").
    Bun.build({
      ...common,
      entrypoints: [path.join(SRC, "background.ts")],
      format: "esm",
      naming: "[name].js",
    }),
    // Content script: Chrome can't load these as modules, so bundle to a single IIFE.
    Bun.build({
      ...common,
      entrypoints: [path.join(SRC, "content.ts")],
      format: "iife",
      naming: "[name].js",
    }),
  ]);

  const failed = results.filter((r) => !r.success);
  if (failed.length) {
    const messages = failed.flatMap((r) =>
      r.logs.map((log) => {
        const pos = log.position;
        const where = pos
          ? `${path.relative(ROOT, pos.file)}:${pos.line}:${pos.column}  `
          : "";
        return `${where}${log.message}${pos?.lineText ? `\n    ${pos.lineText.trim()}` : ""}`;
      }),
    );
    throw new Error(messages.join("\n"));
  }

  const manifest = await writeManifest(dev);
  await validate(manifest);
  return manifest;
}

async function writeManifest(dev: boolean) {
  const pkg = await Bun.file(path.join(ROOT, "package.json")).json();
  const manifest = await Bun.file(path.join(SRC, "manifest.json")).json();

  // package.json is the source of truth for the version. Chrome only accepts
  // 1-4 dot-separated integers, so a prerelease tag goes in version_name.
  const [version] = String(pkg.version).split(/[-+]/);
  manifest.version = version;
  if (version !== pkg.version) manifest.version_name = pkg.version;
  if (dev) manifest.name += " (dev)";

  await Bun.write(
    path.join(DIST, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}

// Fail the build if the manifest points at files that weren't produced.
async function validate(manifest: chrome.runtime.ManifestV3) {
  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
    ...(manifest.content_scripts ?? []).flatMap((cs) => [
      ...(cs.js ?? []),
      ...(cs.css ?? []),
    ]),
    ...Object.values(manifest.icons ?? {}),
  ].filter((f): f is string => typeof f === "string");

  const missing: string[] = [];
  for (const file of referenced) {
    if (!(await Bun.file(path.join(DIST, file)).exists())) missing.push(file);
  }
  if (missing.length)
    throw new Error(
      `manifest.json references files that weren't built: ${missing.join(", ")}`,
    );
}

if (import.meta.main) {
  try {
    const manifest = await build();
    console.log(
      `Built ${manifest.name} v${manifest.version} → ${path.relative(process.cwd(), DIST) || "."}/`,
    );
  } catch (err) {
    console.error(`Build failed:\n${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
