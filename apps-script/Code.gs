// Daily leaderboard backend for the Sudoku app.
// Paste this into Extensions → Apps Script on a Google Sheet, then deploy it
// as a web app (Execute as: Me, Who has access: Anyone). See README.md.
// Scores are stored in a "scores" tab, one row per submission.

const SHEET_NAME = 'scores';
const HEADERS = ['date', 'name', 'time_ms', 'hints', 'client_id', 'created_at'];
const MAX_RESULTS = 100;
const CACHE_SECONDS = 30;

function doGet(e) {
  const date = String(e.parameter.date || '');
  if (!isDateKey(date)) return json({ error: 'Invalid date' });
  const client = String(e.parameter.client || '');

  const scores = scoresFor(date).slice(0, MAX_RESULTS).map((r) => ({
    name: r.name,
    time_ms: r.time_ms,
    hints: r.hints,
    created_at: r.created_at,
    me: client !== '' && r.client_id === client,
  }));
  return json({ scores });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ error: 'Invalid JSON' });
  }

  const date = String(body.date || '');
  const name = cleanName(body.name);
  const timeMs = Math.round(Number(body.time_ms));
  const hints = Math.round(Number(body.hints) || 0);
  const clientId = String(body.client_id || '');

  if (!isDateKey(date) || !isAroundToday(date)) return json({ error: 'Invalid date' });
  if (!name) return json({ error: 'Invalid name' });
  if (!(timeMs >= 15000 && timeMs <= 86400000)) return json({ error: 'Invalid time' });
  if (!(hints >= 0 && hints <= 81)) return json({ error: 'Invalid hints' });
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: 'Invalid client' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (readRows().some((r) => r.date === date && r.client_id === clientId)) {
      return json({ result: 'duplicate' });
    }
    sheet().appendRow([date, name, timeMs, hints, clientId, new Date().toISOString()]);
    CacheService.getScriptCache().remove('scores:' + date);
  } finally {
    lock.releaseLock();
  }
  return json({ result: 'ok' });
}

// ---------- Helpers ----------

function sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    // Keep dates and IDs as plain text so Sheets doesn't reformat them.
    sh.getRange('A:B').setNumberFormat('@');
    sh.getRange('E:F').setNumberFormat('@');
  }
  return sh;
}

function readRows() {
  const sh = sheet();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADERS.length).getDisplayValues().map((v) => ({
    date: v[0],
    name: v[1],
    time_ms: Number(v[2]),
    hints: Number(v[3]),
    client_id: v[4],
    created_at: v[5],
  }));
}

function scoresFor(date) {
  const cache = CacheService.getScriptCache();
  const key = 'scores:' + date;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const rows = readRows()
    .filter((r) => r.date === date && r.name)
    .sort((a, b) => a.time_ms - b.time_ms || a.created_at.localeCompare(b.created_at));
  const top = rows.slice(0, MAX_RESULTS);
  try { cache.put(key, JSON.stringify(top), CACHE_SECONDS); } catch (err) { /* too large to cache */ }
  return top;
}

function cleanName(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^[=+\-@\s]+/, '') // stop names being treated as spreadsheet formulas
    .trim()
    .slice(0, 20);
}

function isDateKey(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Players submit their local date, so allow one day either side of UTC today.
function isAroundToday(date) {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  return [-day, 0, day].some((offset) => Utilities.formatDate(new Date(now + offset), 'UTC', 'yyyy-MM-dd') === date);
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
