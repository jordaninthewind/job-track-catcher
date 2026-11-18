# job-track-catcher
a chrome extension to catch all input data and add values to a tracking sheet

## Load the extension locally

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick the `extension/` folder
4. After editing files, hit the reload icon on the extension card (and refresh any open pages to re-inject the content script)

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

## Record shape

This is what "Copy JSON" produces and what will later be sent to a sheet or endpoint:

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

In storage each record is wrapped as `{ id, savedAt, application: { ...above } }`.

## Testing

`test/sample-application.html` is a filled-in sample form. Serve it over http (content scripts don't run
on `file://` by default):

```sh
python3 -m http.server 8000
# open http://localhost:8000/test/sample-application.html
```

## Layout

```
extension/
  manifest.json      MV3 manifest
  background.js      service worker: stores application records, updates the badge count
  content.js         finds submit buttons, injects the save button, parses labels + answers
  popup/             toolbar popup: review, copy JSON, delete, clear
  options/           settings page (tracking sheet URL placeholder, on/off toggle)
test/
  sample-application.html
```
