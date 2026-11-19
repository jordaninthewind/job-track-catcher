/**
 * Job Track Catcher → Google Sheets
 *
 * Receives applications POSTed by the extension and writes one row per application.
 * Columns: Saved at, Company, Role, URL, then one column per question (added as new
 * questions appear). Saving the same job URL again updates its row instead of adding one.
 *
 * Setup:
 *   1. Open your tracking sheet → Extensions → Apps Script.
 *   2. Replace the contents of Code.gs with this file and save.
 *   3. Deploy → New deployment → type "Web app".
 *        Execute as: Me    Who has access: Anyone
 *   4. Authorize, then copy the Web app URL (ends in /exec).
 *   5. Paste it into the extension: Settings → Tracking sheet / endpoint URL → Save → Send test.
 *
 * "Anyone" means anyone who has the URL can add rows, so keep it private.
 * After editing this script, deploy a new version (Deploy → Manage deployments → Edit → New version).
 */

// Name of the tab to write to. Leave empty to use the first tab.
const SHEET_NAME = "";

const FIXED_COLUMNS = ["Saved at", "Company", "Role", "URL"];

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: "Body is not JSON" });
  }

  // "Send test" from the extension's Settings: confirm the connection without writing a row.
  if (data.test) return reply({ ok: true, test: true });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const book = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = SHEET_NAME ? book.getSheetByName(SHEET_NAME) : book.getSheets()[0];
    if (!sheet) return reply({ ok: false, error: `No tab named "${SHEET_NAME}"` });

    const row = Object.assign(
      { "Saved at": new Date(), Company: data.company || "", Role: data.role || "", URL: data.url || "" },
      data.inputs || {}
    );

    // Header row: keep existing columns, append any new questions.
    let headers = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
    if (!headers.some(String)) headers = FIXED_COLUMNS.slice();
    const missing = Object.keys(row).filter((key) => headers.indexOf(key) === -1);
    headers = headers.concat(missing);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    const values = headers.map((h) => (h in row ? row[h] : ""));

    // Same job saved again → update its row.
    const urlColumn = headers.indexOf("URL") + 1;
    const lastRow = sheet.getLastRow();
    if (urlColumn && lastRow > 1 && row.URL) {
      const urls = sheet.getRange(2, urlColumn, lastRow - 1, 1).getValues();
      const index = urls.findIndex((r) => r[0] === row.URL);
      if (index !== -1) {
        sheet.getRange(index + 2, 1, 1, values.length).setValues([values]);
        return reply({ ok: true, updated: true });
      }
    }

    sheet.appendRow(values);
    return reply({ ok: true, updated: false });
  } finally {
    lock.releaseLock();
  }
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
