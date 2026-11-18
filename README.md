# job-track-catcher
a chrome extension to catch all input data and add values to a tracking sheet

## Load the extension locally

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick the `extension/` folder
4. After editing files, hit the reload icon on the extension card (and refresh any open pages to re-inject the content script)

## Layout

```
extension/
  manifest.json      MV3 manifest
  background.js      service worker: stores captures in chrome.storage.local
  content.js         listens for form submits on every page, sends field values to background
  popup/             toolbar popup: lists captures, CSV export, clear
  options/           settings page (tracking sheet URL, on/off toggle)
```

Passwords, hidden fields and file inputs are never captured.
