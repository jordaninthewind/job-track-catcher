// Saving applications, date/stage handling, and POSTing to the tracking endpoint,
// run through the real background message handler against a local HTTP server.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { originsFor, validateEndpoint } from "../src/lib/endpoint";
import { installChromeStub } from "./chrome-stub";

const chrome = installChromeStub();
const records = () => chrome.local.data.applications as any[];

// ---------- local endpoint ----------

const received: { method: string; type: string | null; body: any }[] = [];
let mode: "ok" | "500" | "okfalse" | "redirect" = "ok";

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/final") return Response.json({ ok: true });
    received.push({ method: req.method, type: req.headers.get("content-type"), body: await req.json() });
    if (mode === "500") return new Response("boom", { status: 500 });
    if (mode === "okfalse") return Response.json({ ok: false, error: 'No tab named "Apps"' });
    if (mode === "redirect") return Response.redirect(new URL("/final", req.url).toString(), 302); // like Apps Script
    return Response.json({ ok: true });
  },
});
const ENDPOINT = `http://localhost:${server.port}/hook`;

const page = { url: "https://boards.greenhouse.io/acme/jobs/1", company: "Acme", role: "Eng", inputs: { Email: "a@b.c", Phone: "" } };

beforeAll(async () => {
  await import("../src/background");
});
afterAll(() => server.stop(true));

describe("saving", () => {
  test("new application gets the tab URL, a date and stage 'applied'", async () => {
    const before = Date.now();
    const res = await chrome.send({ type: "SAVE_APPLICATION", application: page });
    expect(res).toMatchObject({ ok: true, updated: false });
    expect(res.sync).toBeUndefined(); // no URL configured yet

    const app = records()[0].application;
    expect(app).toMatchObject({ url: "https://acme.com/jobs/1", company: "Acme", role: "Eng", stage: "applied" });
    expect(Date.parse(app.date)).toBeGreaterThanOrEqual(before);
    expect(app.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("re-saving the same page keeps the original date and stage", async () => {
    const { id, application } = records()[0];
    await chrome.send({ type: "SET_STAGE", id, stage: "interviewing" });
    await Bun.sleep(5);

    const res = await chrome.send({ type: "SAVE_APPLICATION", application: { ...page, role: "Senior Eng" } });
    expect(res.updated).toBe(true);
    expect(records()).toHaveLength(1);
    expect(records()[0].application).toMatchObject({ role: "Senior Eng", date: application.date, stage: "interviewing" });
  });

  test("SET_STAGE rejects unknown stages and missing records", async () => {
    const { id } = records()[0];
    expect(await chrome.send({ type: "SET_STAGE", id, stage: "ghosted" })).toEqual({ ok: false, error: 'Error: Unknown stage "ghosted"' });
    expect((await chrome.send({ type: "SET_STAGE", id: "nope", stage: "offer" })).ok).toBe(false);
  });

  test("records saved before date/stage existed are upgraded when read", async () => {
    const saved = [...records()];
    chrome.local.data.applications = [
      { id: "old", savedAt: "2026-01-02T03:04:05.000Z", application: { url: "u", company: "C", role: "R", inputs: {} } },
    ];
    await chrome.send({ type: "SET_STAGE", id: "old", stage: "offer" });
    expect(records()[0].application).toEqual({
      url: "u", company: "C", role: "R", date: "2026-01-02T03:04:05.000Z", stage: "offer", inputs: {},
    });
    chrome.local.data.applications = saved;
  });
});

describe("sending to the tracking endpoint", () => {
  test("POSTs { url, company, role, date, stage, inputs } as JSON and records 'sent'", async () => {
    chrome.sync.data.sheetUrl = ENDPOINT;
    const res = await chrome.send({ type: "SAVE_APPLICATION", application: page });
    expect(res.sync).toMatchObject({ state: "sent", httpStatus: 200 });

    const { method, type, body } = received.at(-1)!;
    expect(method).toBe("POST");
    expect(type).toBe("application/json");
    expect(Object.keys(body)).toEqual(["url", "company", "role", "date", "stage", "inputs"]);
    expect(body).toMatchObject({ url: "https://acme.com/jobs/1", stage: "interviewing", date: records()[0].application.date });
    expect(records()[0].sync.state).toBe("sent");
  });

  test("changing the stage re-sends with the new stage", async () => {
    const before = received.length;
    const res = await chrome.send({ type: "SET_STAGE", id: records()[0].id, stage: "offer" });
    expect(res.sync.state).toBe("sent");
    expect(received.length).toBe(before + 1);
    expect(received.at(-1)!.body.stage).toBe("offer");
  });

  test("follows a 302 redirect (Apps Script style)", async () => {
    mode = "redirect";
    const res = await chrome.send({ type: "SEND_TEST" });
    expect(res.sync.state).toBe("sent");
    expect(received.at(-1)!.body).toMatchObject({ test: true, stage: "applied" });
  });

  test("HTTP 500 → failed with status and body", async () => {
    mode = "500";
    const res = await chrome.send({ type: "SEND_APPLICATION", id: records()[0].id });
    expect(res.sync).toMatchObject({ state: "failed", httpStatus: 500, error: "HTTP 500: boom" });
    expect(records()[0].sync.state).toBe("failed");
  });

  test("200 with { ok: false } → failed with the endpoint's error", async () => {
    mode = "okfalse";
    const res = await chrome.send({ type: "SEND_TEST" });
    expect(res.sync).toMatchObject({ state: "failed", error: 'No tab named "Apps"' });
  });

  test("missing host permission → failed without a request", async () => {
    mode = "ok";
    chrome.granted = false;
    const before = received.length;
    const res = await chrome.send({ type: "SEND_TEST" });
    expect(res.sync.state).toBe("failed");
    expect(res.sync.error).toContain("Open Settings");
    expect(received.length).toBe(before);
    chrome.granted = true;
  });

  test("unreachable endpoint → failed, but the save still succeeds", async () => {
    chrome.sync.data.sheetUrl = "http://localhost:1/nothing";
    const res = await chrome.send({ type: "SAVE_APPLICATION", application: page }, { tab: { url: "https://other.com/2" } });
    expect(res.ok).toBe(true);
    expect(res.sync.state).toBe("failed");
    expect(records()).toHaveLength(2);
  });

  test("SEND_APPLICATION without a URL → clear error", async () => {
    chrome.sync.data.sheetUrl = "";
    const res = await chrome.send({ type: "SEND_APPLICATION", id: records()[0].id });
    expect(res).toEqual({ ok: false, error: "No tracking URL is set. Add one in Settings." });
  });
});

test("validateEndpoint / originsFor", () => {
  expect(validateEndpoint("nope")).toBe("That isn't a valid URL.");
  expect(validateEndpoint("ftp://x.com")).toContain("https://");
  expect(validateEndpoint("https://docs.google.com/spreadsheets/d/abc/edit")).toContain("Apps Script");
  expect(validateEndpoint("https://script.google.com/macros/s/abc/exec")).toBeNull();
  expect(originsFor("https://script.google.com/macros/s/abc/exec")).toEqual([
    "https://script.google.com/*",
    "https://script.googleusercontent.com/*",
  ]);
  expect(originsFor("http://localhost:3000/api")).toEqual(["http://localhost/*"]);
});
