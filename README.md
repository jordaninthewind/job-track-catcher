# job-track-catcher

A Chrome extension that adds a **Save Application Data** button next to job application submit buttons
and saves your answers as JSON, ready for a tracking sheet.

Built with [Bun](https://bun.com), TypeScript and React.

## Setup

```sh
bun install
```

## Scripts

| Command             | What it does                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `bun run dev`       | Dev build into `dist/`, rebuilds on change, auto-reloads the extension, serves `test/` on :8000 |
| `bun run build`     | Production build into `dist/` (minified, no dev reloader)                                        |
| `bun run typecheck` | `tsc --noEmit` over `src/` and `scripts/`                                                        |
| `bun run clean`     | Delete `dist/`                                                                                   |

## Load the extension in Chrome

1. Run `bun run build` (or `bun run dev`)
2. Open `chrome://extensions` and turn on **Developer mode**
3. Click **Load unpacked** and select the `dist/` folder

You only load it once; `dist/` is rebuilt in place.

- **With `bun run dev`**, every change in `src/` rebuilds and reloads the extension automatically. The test
  pages at <http://localhost:8000> refresh themselves too. Other open tabs need a manual refresh to pick
  up a new content script.
- **With `bun run build`**, click the reload icon on the extension card after rebuilding.

The dev build is named "Job Track Catcher (dev)" and connects to the dev server. Run `bun run build` before
using the extension for real.

## How it works

1. On any page, the content script looks for an application's submit button: a button whose text is
   "Submit", "Submit Application", "Apply", etc., or a `type="submit"` button in a form with 3+ fields.
   Login forms (anything with a password field) are ignored.
2. It puts a **Save Application Data** button right after it. It keeps watching the page, so forms
   rendered later by React and similar frameworks still get the button.
3. Clicking it collects every question in that form, answered or not, and saves it as the record below.
   Saving the same page again replaces the earlier record.
4. The toolbar popup lists saved applications, where you can review the answers, copy one record or all
   of them as JSON, delete one, or clear everything. Records persist in `chrome.storage.local` until cleared.

Passwords and hidden fields are never captured. For file uploads, only the file name is recorded.

## Prefill

Saved answers are filled into any application question with the same label, on any site. Matching
ignores case, punctuation, `*` and "(optional)". Questions that already have an answer are never
overwritten.

- **Add answers from a page:** open the popup on an application and click **Pick fields**, then click
  question labels (or the fields themselves). Each one is captured with its current value and appears in
  **Settings → Prefill** to edit and save. Press Esc or **Done** to stop picking.
- **Add answers by hand:** in **Settings → Prefill**.
- **Fill a form:** click **Prefill** next to **Save Application Data**, or **Prefill page** in the popup.

Fills text fields, textareas, native dropdowns, radio and checkbox groups, and custom dropdowns
(Greenhouse's react-select). File uploads can't be filled by an extension.

Answers are stored in `chrome.storage.local` (`prefill`, plus `prefillPending` for captured answers awaiting
review), keyed by label rather than site.

## Record shape

This is what "Copy JSON" produces and what will later be sent to a sheet or endpoint
(`Application` in `src/lib/types.ts`):

```json
{
  "url": "https://thatch.com/jobs/software-engineer-full-stack-5113761008",
  "company": "Thatch",
  "role": "Software Engineer: Full Stack",
  "inputs": {
    "First Name": "Ada",
    "Preferred First Name": "",
    "Resume/CV": "Ada Lovelace CV.pdf",
    "How did you hear about this position?": "LinkedIn"
  }
}
```

- `url` is the address-bar URL, so forms embedded from an ATS iframe (Greenhouse etc.) are saved under the
  company's job page.
- `inputs` keys are the question labels in page order. Unanswered questions are kept as `""`.
- Custom dropdowns (react-select, used by Greenhouse) are read from the displayed selection.

In storage each record is wrapped as `{ id, savedAt, application }` (`StoredApplication`).

## Layout

```
src/
  manifest.json        MV3 manifest (version is filled in from package.json at build time)
  background.ts        service worker: stores records, badge count, relays "stop picker" to all frames
  content.ts           finds submit buttons, injects Prefill + Save buttons, handles popup commands
                       (plain TS, no React: it runs on every page, so it stays small)
  popup/               React toolbar popup: page actions, review/copy/delete saved applications
  options/             React settings page: general settings + <PrefillSettings />
  prefill/             everything for Prefill
    PrefillSettings.tsx    Settings → Prefill (review captured answers, edit saved ones)
    PrefillPageActions.tsx popup "Prefill page" / "Pick fields" buttons
    usePrefill.ts          live saved + pending answers hook
    storage.ts             chrome.storage.local helpers, label matching
    fill.ts                fills a form from saved answers (content script)
    picker.ts              click-to-capture mode (content script)
    overlay.ts             on-page banner, highlight and toasts (content script)
    types.ts
  components/          shared React components (CopyButton, ConfirmButton)
  lib/
    fields.ts          reads question labels + answers from a form (shared by Save and Prefill)
    types.ts           Application, StoredApplication, Settings, message types
    storage.ts         chrome.storage helpers + typed sendMessage
    hooks.ts           useApplications / useSettings React hooks
    dev-reload.ts      dev-build-only auto-reload (stripped from production builds)
scripts/
  build.ts             Bun.build: HTML pages, ESM service worker, IIFE content script → dist/
  dev.ts               watch + rebuild + reload server
test/
  sample-application.html
```
