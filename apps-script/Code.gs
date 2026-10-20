// Daily leaderboard backend for the Sudoku app.
// Paste this into Extensions → Apps Script on a Google Sheet, then deploy it
// as a web app (Execute as: Me, Who has access: Anyone). See README.md.
//
// Two tabs are created automatically:
//   scores  - one row per daily submission
//   players - one row per device, holding the player's current display name
// Leaderboards show each player's current name, so renaming updates past days.

const SCORES = { name: 'scores', headers: ['date', 'name', 'time_ms', 'hints', 'client_id', 'created_at'], text: ['A:B', 'E:F'] };
const PLAYERS = { name: 'players', headers: ['client_id', 'name', 'updated_at'], text: ['A:C'] };
const MAX_RESULTS = 100;
const CACHE_SECONDS = 60;

function doGet(e) {
  const date = String(e.parameter.date || '');
  if (!isDateKey(date)) return json({ error: 'Invalid date' });
  const client = String(e.parameter.client || '');
  const names = playerNames();

  const scores = scoresFor(date).slice(0, MAX_RESULTS).map((r) => ({
    name: names[r.client_id] || r.name,
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

  const clientId = String(body.client_id || '');
  const name = cleanName(body.name);
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: 'Invalid client' });
  if (!name) return json({ error: 'Invalid name' });

  if (body.action === 'name') {
    withLock(() => savePlayerName(clientId, name));
    return json({ result: 'ok' });
  }

  const date = String(body.date || '');
  const timeMs = Math.round(Number(body.time_ms));
  const hints = Math.round(Number(body.hints) || 0);
  if (!isDateKey(date) || !isAroundToday(date)) return json({ error: 'Invalid date' });
  if (!(timeMs >= 15000 && timeMs <= 86400000)) return json({ error: 'Invalid time' });
  if (!(hints >= 0 && hints <= 81)) return json({ error: 'Invalid hints' });

  const result = withLock(() => {
    savePlayerName(clientId, name);
    if (readScores().some((r) => r.date === date && r.client_id === clientId)) return 'duplicate';
    sheet(SCORES).appendRow([date, name, timeMs, hints, clientId, new Date().toISOString()]);
    CacheService.getScriptCache().remove('scores:' + date);
    return 'ok';
  });
  return json({ result });
}

// ---------- Storage ----------

function sheet(spec) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(spec.name);
  if (!sh) {
    sh = ss.insertSheet(spec.name);
    sh.appendRow(spec.headers);
    sh.setFrozenRows(1);
    // Keep dates, names and IDs as plain text so Sheets doesn't reformat them.
    spec.text.forEach((range) => sh.getRange(range).setNumberFormat('@'));
  }
  return sh;
}

function readValues(spec) {
  const sh = sheet(spec);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, spec.headers.length).getDisplayValues();
}

function readScores() {
  return readValues(SCORES).map((v) => ({
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

  const top = readScores()
    .filter((r) => r.date === date && r.name)
    .sort((a, b) => a.time_ms - b.time_ms || a.created_at.localeCompare(b.created_at))
    .slice(0, MAX_RESULTS);
  try { cache.put(key, JSON.stringify(top), CACHE_SECONDS); } catch (err) { /* too large to cache */ }
  return top;
}

function playerNames() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('players');
  if (hit) return JSON.parse(hit);

  const names = {};
  readValues(PLAYERS).forEach((v) => { if (v[1]) names[v[0]] = v[1]; });
  try { cache.put('players', JSON.stringify(names), CACHE_SECONDS); } catch (err) { /* too large to cache */ }
  return names;
}

function savePlayerName(clientId, name) {
  const rows = readValues(PLAYERS);
  const index = rows.findIndex((v) => v[0] === clientId);
  const now = new Date().toISOString();
  if (index === -1) {
    sheet(PLAYERS).appendRow([clientId, name, now]);
  } else if (rows[index][1] !== name) {
    sheet(PLAYERS).getRange(index + 2, 2, 1, 2).setValues([[name, now]]);
  } else {
    return;
  }
  CacheService.getScriptCache().remove('players');
}

// ---------- Helpers ----------

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
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
