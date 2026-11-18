const STORAGE_KEY = "applications";

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");

let records = [];
const openIds = new Set(); // keep expanded cards open across re-renders

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const toJson = (value) => JSON.stringify(value, null, 2);

async function copy(text, btn) {
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Copied ✓";
  } catch {
    btn.textContent = "Copy failed";
  }
  setTimeout(() => (btn.textContent = original), 1500);
}

// First click arms the button, second click within 3s runs the action.
function confirmClick(btn, label, action) {
  let armed = false;
  let timer;
  btn.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      btn.textContent = "Click again to confirm";
      btn.classList.add("confirm");
      timer = setTimeout(() => {
        armed = false;
        btn.textContent = label;
        btn.classList.remove("confirm");
      }, 3000);
      return;
    }
    clearTimeout(timer);
    action();
  });
}

function renderCard(record) {
  const app = record.application;
  const entries = Object.entries(app.inputs);
  const answered = entries.filter(([, v]) => v).length;

  const summary = el(
    "summary",
    {},
    el("div", { className: "company", textContent: app.company || "Unknown company" }),
    el("div", { className: "job", textContent: app.role || app.url }),
    el("div", {
      className: "meta muted",
      textContent: `${new Date(record.savedAt).toLocaleString()} · ${answered}/${entries.length} answered`,
    })
  );

  const fields = el("dl", { className: "fields" });
  for (const [label, value] of entries) {
    fields.append(
      el("dt", { textContent: label }),
      el("dd", { textContent: value || "—", className: value ? "" : "muted" })
    );
  }

  const json = el("pre", { textContent: toJson(app), hidden: true });

  const copyBtn = el("button", { type: "button", textContent: "Copy JSON" });
  copyBtn.addEventListener("click", () => copy(toJson(app), copyBtn));

  const jsonBtn = el("button", { type: "button", className: "secondary", textContent: "View JSON" });
  jsonBtn.addEventListener("click", () => {
    json.hidden = !json.hidden;
    jsonBtn.textContent = json.hidden ? "View JSON" : "Hide JSON";
  });

  const deleteBtn = el("button", { type: "button", className: "danger", textContent: "Delete" });
  confirmClick(deleteBtn, "Delete", () => {
    openIds.delete(record.id);
    chrome.runtime.sendMessage({ type: "DELETE_APPLICATION", id: record.id });
  });

  const link = el("a", { href: app.url, target: "_blank", textContent: "Open page" });

  const details = el(
    "details",
    { open: openIds.has(record.id) },
    summary,
    el("div", { className: "body" }, fields, json, el("div", { className: "actions" }, copyBtn, jsonBtn, deleteBtn, link))
  );
  details.addEventListener("toggle", () => (details.open ? openIds.add(record.id) : openIds.delete(record.id)));

  return el("li", {}, details);
}

function render(all) {
  records = all.filter((r) => r?.application?.inputs); // ignore anything from older versions
  listEl.replaceChildren(...records.map(renderCard));
  emptyEl.hidden = records.length > 0;
  countEl.textContent = records.length ? `${records.length} saved` : "";
}

const copyAllBtn = document.getElementById("copyAll");
copyAllBtn.addEventListener("click", () => copy(toJson(records.map((r) => r.application)), copyAllBtn));

confirmClick(document.getElementById("clear"), "Clear all", () => {
  openIds.clear();
  chrome.runtime.sendMessage({ type: "CLEAR_APPLICATIONS" });
});

document.getElementById("options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Live-update if something is saved while the popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) render(changes[STORAGE_KEY].newValue || []);
});

chrome.storage.local.get(STORAGE_KEY).then(({ [STORAGE_KEY]: all = [] }) => render(all));
