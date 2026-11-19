// Runs integrations/google-sheets/Code.gs against an in-memory stand-in for a Google Sheet.

import { beforeEach, expect, test } from "bun:test";

let rows: unknown[][] = [];
const width = () => Math.max(0, ...rows.map((r) => r.length));
const sheet = {
  getLastColumn: () => width(),
  getLastRow: () => rows.length,
  getRange: (r: number, c: number, nr: number, nc: number) => ({
    getValues: () =>
      Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? "")),
    setValues: (values: unknown[][]) =>
      values.forEach((row, i) => row.forEach((v, j) => ((rows[r - 1 + i] ??= [])[c - 1 + j] = v))),
  }),
  appendRow: (values: unknown[]) => rows.push([...values]),
};

const g = globalThis as any;
g.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheets: () => [sheet], getSheetByName: () => null }) };
g.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
g.ContentService = {
  MimeType: { JSON: "json" },
  createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }),
};

const code = await Bun.file(new URL("../integrations/google-sheets/Code.gs", import.meta.url)).text();
const doPost = new Function(`${code}; return doPost;`)() as (e: unknown) => unknown;
const post = (body: unknown) => doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } });

const app = (overrides: Record<string, unknown> = {}) => ({
  url: "u1",
  company: "Acme",
  role: "Eng",
  date: "2026-11-18T23:42:10.512Z",
  stage: "applied",
  inputs: { Email: "a@b.c", Phone: "" },
  ...overrides,
});

beforeEach(() => {
  rows = [];
});

test("writes Date, Stage, Company, Role, URL, Saved at, then a column per question", () => {
  expect(post(app())).toEqual({ ok: true, updated: false });
  expect(post(app({ url: "u2", stage: "interviewing", inputs: { Email: "x@y.z", "Why us?": "Because" } }))).toEqual({
    ok: true,
    updated: false,
  });

  expect(rows[0]).toEqual(["Date", "Stage", "Company", "Role", "URL", "Saved at", "Email", "Phone", "Why us?"]);
  expect(rows[1]![0]).toEqual(new Date("2026-11-18T23:42:10.512Z"));
  expect(rows[1]!.slice(1, 5)).toEqual(["applied", "Acme", "Eng", "u1"]);
  expect(rows[1]![5]).toBeInstanceOf(Date);
  expect(rows[1]!.slice(6)).toEqual(["a@b.c", ""]);
  expect(rows[2]!.slice(1, 5)).toEqual(["interviewing", "Acme", "Eng", "u2"]);
  expect(rows[2]!.slice(6)).toEqual(["x@y.z", "", "Because"]);
});

test("same URL again (e.g. a stage change) updates its row, keeping the applied date", () => {
  post(app());
  expect(post(app({ stage: "offer", role: "Senior Eng" }))).toEqual({ ok: true, updated: true });
  expect(rows).toHaveLength(2);
  expect(rows[1]![0]).toEqual(new Date("2026-11-18T23:42:10.512Z"));
  expect(rows[1]!.slice(1, 4)).toEqual(["offer", "Acme", "Senior Eng"]);
});

test("existing sheets with the old columns get Date and Stage appended", () => {
  rows = [["Saved at", "Company", "Role", "URL", "Email"]];
  post(app());
  expect(rows[0]).toEqual(["Saved at", "Company", "Role", "URL", "Email", "Date", "Stage", "Phone"]);
  expect(rows[1]!.slice(1, 7)).toEqual(["Acme", "Eng", "u1", "a@b.c", new Date("2026-11-18T23:42:10.512Z"), "applied"]);
});

test("test pings write nothing; bad JSON is rejected", () => {
  expect(post({ test: true })).toEqual({ ok: true, test: true });
  expect(rows).toHaveLength(0);
  expect(post("not json")).toEqual({ ok: false, error: "Body is not JSON" });
});
