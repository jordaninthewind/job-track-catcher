const listEl = document.getElementById("captures");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");

async function load() {
  const { captures = [] } = await chrome.runtime.sendMessage({ type: "GET_CAPTURES" });
  render(captures);
  return captures;
}

function render(captures) {
  listEl.replaceChildren(
    ...captures.map((c) => {
      const li = document.createElement("li");

      const title = document.createElement("div");
      title.className = "title";
      title.textContent = c.pageTitle || c.url;
      title.title = c.url;

      const meta = document.createElement("div");
      meta.className = "meta";
      const fieldCount = Object.keys(c.fields).length;
      meta.textContent = `${new Date(c.capturedAt).toLocaleString()} · ${fieldCount} field${fieldCount === 1 ? "" : "s"}`;

      li.append(title, meta);
      return li;
    })
  );
  emptyEl.hidden = captures.length > 0;
  countEl.textContent = captures.length ? `${captures.length} caught` : "";
}

function toCsv(captures) {
  const fieldKeys = [...new Set(captures.flatMap((c) => Object.keys(c.fields)))];
  const header = ["capturedAt", "url", "pageTitle", ...fieldKeys];
  const escape = (v = "") => `"${String(v).replaceAll('"', '""')}"`;
  const rows = captures.map((c) =>
    [c.capturedAt, c.url, c.pageTitle, ...fieldKeys.map((k) => c.fields[k])].map(escape).join(",")
  );
  return [header.map(escape).join(","), ...rows].join("\n");
}

document.getElementById("export").addEventListener("click", async () => {
  const captures = await load();
  const blob = new Blob([toCsv(captures)], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `job-captures-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("clear").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_CAPTURES" });
  render([]);
});

document.getElementById("options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

load();
