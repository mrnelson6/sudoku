import { generate, generateDaily, dailyDifficulty, DIFFICULTIES, PEERS, ROW, COL, BOX } from './sudoku.js';
import { leaderboardEnabled, fetchScores, submitScore, setName } from './leaderboard.js';
import { HINT_PENALTY_SECONDS } from './config.js';

const $ = (sel) => document.querySelector(sel);

// ---------- Storage ----------

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('sudoku:' + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('sudoku:' + key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  },
  remove(key) {
    try { localStorage.removeItem('sudoku:' + key); } catch { /* ignore */ }
  },
};

const settings = { checkMistakes: true, highlightSame: true, haptics: true, theme: 'auto', ...store.get('settings', {}) };

function clientId() {
  let id = store.get('clientId', null);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
    store.set('clientId', id);
  }
  return id;
}

// ---------- Helpers ----------

function dateKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftDate(key, days) {
  const d = new Date(key + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

function formatDate(key, opts = { weekday: 'long', month: 'short', day: 'numeric' }) {
  return new Date(key + 'T12:00:00').toLocaleDateString(undefined, opts);
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function vibrate(pattern) {
  if (settings.haptics && navigator.vibrate) navigator.vibrate(pattern);
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function confirmAction(message, okLabel = 'Continue') {
  const dialog = $('#confirm-dialog');
  $('#confirm-text').textContent = message;
  $('#confirm-ok').textContent = okLabel;
  dialog.showModal();
  return new Promise((resolve) => {
    const done = (result) => {
      dialog.close();
      $('#confirm-ok').onclick = $('#confirm-cancel').onclick = null;
      resolve(result);
    };
    $('#confirm-ok').onclick = () => done(true);
    $('#confirm-cancel').onclick = () => done(false);
    dialog.oncancel = () => done(false);
  });
}

// ---------- Game state ----------

let game = null;     // see newGameState()
let selected = -1;
let notesMode = false;
let runningSince = 0; // timestamp when the timer last started, 0 when stopped
let manuallyPaused = false;

function newGameState({ mode, difficulty, puzzle, solution, date }) {
  return {
    mode, difficulty, date,
    puzzle, solution,
    values: puzzle.slice(),
    notes: new Array(81).fill(0),
    locked: puzzle.map((v) => v !== 0), // givens and hinted cells
    elapsed: 0,
    mistakes: 0,
    hints: 0,
    completed: false,
    history: [],
  };
}

function storageKey(g) {
  return g.mode === 'daily' ? 'daily:' + g.date : 'current';
}

function elapsed() {
  return game.elapsed + (runningSince ? Date.now() - runningSince : 0);
}

function saveGame() {
  if (!game) return;
  store.set(storageKey(game), { ...game, elapsed: elapsed(), history: game.history.slice(-200) });
}

function startTimer() {
  if (runningSince || !game || game.completed) return;
  runningSince = Date.now();
}

function stopTimer() {
  if (!runningSince) return;
  game.elapsed += Date.now() - runningSince;
  runningSince = 0;
}

setInterval(() => {
  if (game && !$('#game').hidden) $('#timer').textContent = formatTime(elapsed());
}, 250);

// ---------- Board rendering ----------

const board = $('#board');
const cells = [];

function buildBoard() {
  for (let i = 0; i < 81; i++) {
    const cell = document.createElement('div');
    const r = ROW[i], c = COL[i];
    cell.className = 'cell';
    if (c === 8) cell.classList.add('c8');
    if (r === 8) cell.classList.add('r8');
    if (c === 2 || c === 5) cell.classList.add('box-r');
    if (r === 2 || r === 5) cell.classList.add('box-b');
    cell.style.setProperty('--d', `${(r + c) * 35}ms`);
    cell.setAttribute('role', 'gridcell');
    cell.innerHTML = '<span class="value"></span><div class="notes">' +
      '<span></span>'.repeat(9) + '</div>';
    cell.addEventListener('click', () => select(i));
    board.appendChild(cell);
    cells.push(cell);
  }

  const numpad = $('#numpad');
  for (let d = 1; d <= 9; d++) {
    const btn = document.createElement('button');
    btn.className = 'num';
    btn.dataset.digit = d;
    btn.setAttribute('aria-label', String(d));
    btn.innerHTML = `${d}<small></small>`;
    btn.addEventListener('click', () => input(d));
    numpad.appendChild(btn);
  }
}

function isWrong(i) {
  return game.values[i] !== 0 && game.values[i] !== game.solution[i];
}

function render() {
  if (!game) return;
  const selVal = selected >= 0 ? game.values[selected] : 0;
  const counts = new Array(10).fill(0);
  for (let i = 0; i < 81; i++) if (game.values[i] && !isWrong(i)) counts[game.values[i]]++;

  for (let i = 0; i < 81; i++) {
    const cell = cells[i];
    const v = game.values[i];
    const isPeer = selected >= 0 && i !== selected &&
      (ROW[i] === ROW[selected] || COL[i] === COL[selected] || BOX[i] === BOX[selected]);
    const wrong = settings.checkMistakes && isWrong(i);
    cell.classList.toggle('selected', i === selected);
    cell.classList.toggle('peer', isPeer);
    cell.classList.toggle('same', settings.highlightSame && selVal !== 0 && v === selVal && i !== selected);
    cell.classList.toggle('given', game.locked[i]);
    cell.classList.toggle('user', !game.locked[i] && v !== 0);
    cell.classList.toggle('error', wrong);
    cell.firstChild.textContent = v || '';

    const noteSpans = cell.lastChild.children;
    const mask = v ? 0 : game.notes[i];
    for (let d = 1; d <= 9; d++) {
      const span = noteSpans[d - 1];
      const on = (mask >> d) & 1;
      span.textContent = on ? d : '';
      span.classList.toggle('match', on && settings.highlightSame && d === selVal);
    }

    const label = `Row ${ROW[i] + 1}, column ${COL[i] + 1}, ${v ? v : 'empty'}`;
    if (cell.getAttribute('aria-label') !== label) cell.setAttribute('aria-label', label);
  }

  for (const btn of $('#numpad').children) {
    const d = Number(btn.dataset.digit);
    const left = 9 - counts[d];
    btn.classList.toggle('done', left <= 0);
    btn.lastChild.textContent = left > 0 ? left : '';
  }

  $('#numpad').classList.toggle('notes-mode', notesMode);
  $('#notes-btn').setAttribute('aria-pressed', String(notesMode));
  $('#notes-badge').textContent = notesMode ? 'On' : 'Off';
  $('#undo-btn').disabled = game.history.length === 0 || game.completed;

  const sub = [];
  if (settings.checkMistakes) sub.push(`Mistakes: ${game.mistakes}`);
  if (game.hints) sub.push(`Hints: ${game.hints}`);
  $('#game-sub').textContent = sub.join(' · ');
}

function popCell(i) {
  const cell = cells[i];
  cell.classList.remove('pop');
  void cell.offsetWidth;
  cell.classList.add('pop');
}

// ---------- Input ----------

function select(i) {
  if (!game || game.completed) return;
  selected = i;
  render();
}

// Records a move as a list of [index, oldValue, oldNotes] so it can be undone.
function applyChanges(changes) {
  game.history.push(changes);
}

function snapshot(i) {
  return [i, game.values[i], game.notes[i]];
}

function input(d) {
  if (!game || game.completed || runningSince === 0) return;
  if (selected < 0) { toast('Select a square first'); return; }
  const i = selected;
  if (game.locked[i]) {
    // Tapping a number on a given just highlights it.
    vibrate(5);
    return;
  }

  if (notesMode) {
    if (game.values[i]) return;
    applyChanges([snapshot(i)]);
    game.notes[i] ^= 1 << d;
    vibrate(5);
    render();
    saveGame();
    return;
  }

  if (game.values[i] === d) {
    applyChanges([snapshot(i)]);
    game.values[i] = 0;
    render();
    saveGame();
    return;
  }

  const changes = [snapshot(i)];
  game.values[i] = d;
  game.notes[i] = 0;
  // Clear this digit from notes in the same row, column and box.
  for (const p of PEERS[i]) {
    if (game.notes[p] & (1 << d)) {
      changes.push(snapshot(p));
      game.notes[p] &= ~(1 << d);
    }
  }
  applyChanges(changes);

  if (d !== game.solution[i]) {
    game.mistakes++;
    vibrate(settings.checkMistakes ? [30, 40, 30] : 8);
  } else {
    vibrate(8);
  }
  popCell(i);
  render();
  saveGame();
  checkWin();
}

function erase() {
  if (!game || game.completed || selected < 0 || game.locked[selected]) return;
  const i = selected;
  if (!game.values[i] && !game.notes[i]) return;
  applyChanges([snapshot(i)]);
  game.values[i] = 0;
  game.notes[i] = 0;
  vibrate(8);
  render();
  saveGame();
}

function undo() {
  if (!game || game.completed) return;
  const changes = game.history.pop();
  if (!changes) return;
  for (const [i, value, notes] of changes.reverse()) {
    if (game.locked[i]) continue;
    game.values[i] = value;
    game.notes[i] = notes;
  }
  selected = changes[changes.length - 1][0];
  vibrate(5);
  render();
  saveGame();
}

function hint() {
  if (!game || game.completed || runningSince === 0) return;
  let target = selected >= 0 && !game.locked[selected] && game.values[selected] !== game.solution[selected] ? selected : -1;
  if (target < 0) {
    const candidates = [];
    for (let i = 0; i < 81; i++) if (!game.locked[i] && game.values[i] !== game.solution[i]) candidates.push(i);
    if (!candidates.length) return;
    target = candidates[Math.floor(Math.random() * candidates.length)];
  }
  const d = game.solution[target];
  game.values[target] = d;
  game.notes[target] = 0;
  game.locked[target] = true;
  for (const p of PEERS[target]) game.notes[p] &= ~(1 << d);
  game.hints++;
  selected = target;
  if (game.mode === 'daily') toast(`Hint used: +${HINT_PENALTY_SECONDS}s`);
  vibrate(10);
  popCell(target);
  render();
  saveGame();
  checkWin();
}

function toggleNotes() {
  notesMode = !notesMode;
  vibrate(5);
  render();
}

function moveSelection(dr, dc) {
  if (selected < 0) { select(40); return; }
  const r = (ROW[selected] + dr + 9) % 9;
  const c = (COL[selected] + dc + 9) % 9;
  select(r * 9 + c);
}

document.addEventListener('keydown', (e) => {
  if ($('#game').hidden || document.querySelector('dialog[open]')) return;
  if (e.metaKey || e.ctrlKey) {
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    return;
  }
  const k = e.key;
  if (k >= '1' && k <= '9') input(Number(k));
  else if (k === 'Backspace' || k === 'Delete' || k === '0') erase();
  else if (k === 'ArrowUp') moveSelection(-1, 0);
  else if (k === 'ArrowDown') moveSelection(1, 0);
  else if (k === 'ArrowLeft') moveSelection(0, -1);
  else if (k === 'ArrowRight') moveSelection(0, 1);
  else if (k === 'n' || k === 'N') toggleNotes();
  else if (k === 'z' || k === 'Z') undo();
  else if (k === 'h' || k === 'H') hint();
  else if (k === ' ' || k === 'p' || k === 'P') togglePause();
  else return;
  e.preventDefault();
});

// ---------- Pause ----------

function setPaused(paused) {
  if (!game || game.completed) return;
  if (paused) stopTimer(); else startTimer();
  $('#pause-overlay').hidden = !paused;
  saveGame();
}

function togglePause() {
  manuallyPaused = !manuallyPaused;
  setPaused(manuallyPaused);
}

document.addEventListener('visibilitychange', () => {
  if ($('#game').hidden || !game || game.completed) return;
  if (document.hidden) {
    stopTimer();
    saveGame();
  } else if (!manuallyPaused) {
    startTimer();
  }
});
window.addEventListener('pagehide', saveGame);

// ---------- Winning ----------

function checkWin() {
  if (!game.values.every((v, i) => v === game.solution[i])) return;
  stopTimer();
  game.completed = true;
  selected = -1;
  const time = game.elapsed;

  if (game.mode === 'free') {
    const stats = store.get('stats', {});
    const s = stats[game.difficulty] || { played: 0, won: 0, best: null };
    s.won++;
    const isBest = s.best == null || time < s.best;
    if (isBest) s.best = time;
    stats[game.difficulty] = s;
    store.set('stats', stats);
    store.remove('current');
    game.isBest = isBest && s.won > 1;
  } else {
    const history = store.get('dailyHistory', {});
    const entry = { timeMs: time, hints: game.hints, finalMs: time + game.hints * HINT_PENALTY_SECONDS * 1000 };
    history[game.date] = entry;
    store.set('dailyHistory', history);
    if (leaderboardEnabled && game.date === dateKey()) {
      const pending = store.get('pendingScores', {});
      pending[game.date] = entry;
      store.set('pendingScores', pending);
    }
    saveGame();
  }

  vibrate([20, 60, 20, 60, 40]);
  render();
  board.classList.add('solved');
  setTimeout(() => showWin(), 900);
}

function showWin() {
  const g = game;
  const finalMs = g.elapsed + (g.mode === 'daily' ? g.hints * HINT_PENALTY_SECONDS * 1000 : 0);
  $('#win-time').textContent = formatTime(finalMs);
  $('#win-mistakes').textContent = g.mistakes;
  $('#win-hints').textContent = g.hints;

  let note = '';
  if (g.mode === 'daily' && g.hints) note = `Includes +${g.hints * HINT_PENALTY_SECONDS}s hint penalty`;
  else if (g.isBest) note = `New best time for ${DIFFICULTIES[g.difficulty].label}!`;
  $('#win-note').textContent = note;

  const isDaily = g.mode === 'daily';
  const pending = isDaily && store.get('pendingScores', {})[g.date];
  const name = store.get('name', '');
  $('#submit-form').hidden = !(pending && !name);
  $('#win-post').textContent = '';
  if (pending && name) postScores();

  $('#win-share').hidden = !isDaily;
  $('#win-primary').textContent = isDaily ? 'View leaderboard' : 'New game';
  $('#win-primary').onclick = () => {
    $('#win-dialog').close();
    if (isDaily) { goHome(); openLeaderboard(g.date); }
    else startFreeGame(g.difficulty);
  };
  $('#win-dialog').showModal();
}

$('#submit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = cleanName($('#name-input').value);
  if (!name) return;
  store.set('name', name);
  $('#submit-form').hidden = true;
  postScores();
});

// ---------- Leaderboard sync ----------
// Daily results are queued in 'pendingScores' and sent once the player has a
// name. Anything that fails because of the network is retried on the next
// launch or when the device comes back online.

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

let syncing = null;

function syncLeaderboard() {
  if (!leaderboardEnabled || !navigator.onLine) return Promise.resolve();
  syncing ||= (async () => {
    const name = store.get('name', '');
    if (!name) return;
    if (store.get('nameSynced', '') !== name) {
      try {
        await setName({ name, clientId: clientId() });
        store.set('nameSynced', name);
      } catch { /* retry later */ }
    }
    const pending = store.get('pendingScores', {});
    for (const [date, entry] of Object.entries(pending)) {
      try {
        await submitScore({ dateKey: date, name, timeMs: entry.finalMs, hints: entry.hints, clientId: clientId() });
      } catch (err) {
        if (!err.rejected) continue; // offline or server hiccup: keep it for later
        // Rejected by the server (e.g. too old): drop it.
      }
      delete pending[date];
      store.set('pendingScores', pending);
    }
  })().finally(() => { syncing = null; });
  return syncing;
}

async function postScores() {
  const status = $('#win-post');
  status.textContent = 'Posting to the leaderboard…';
  await syncLeaderboard();
  const stillPending = store.get('pendingScores', {})[game.date];
  status.textContent = stillPending
    ? "You're offline. Your time will be posted when you reconnect."
    : `Posted to today's leaderboard as ${store.get('name', '')}`;
}

window.addEventListener('online', syncLeaderboard);

$('#win-share').addEventListener('click', async () => {
  const entry = store.get('dailyHistory', {})[game.date];
  const text = `Sudoku daily · ${formatDate(game.date, { month: 'short', day: 'numeric' })} · ` +
    `${DIFFICULTIES[game.difficulty].label}\n⏱ ${formatTime(entry.finalMs)}` +
    (entry.hints ? ` (${entry.hints} hint${entry.hints > 1 ? 's' : ''})` : '') + `\n${location.href.split('#')[0]}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  } catch { /* share cancelled */ }
});

$('#win-home').addEventListener('click', () => { $('#win-dialog').close(); goHome(); });

// ---------- Navigation ----------

function showGameView() {
  $('#home').hidden = true;
  $('#game').hidden = false;
  if (history.state?.view !== 'game') history.pushState({ view: 'game' }, '');
}

function goHome() {
  if (game) {
    stopTimer();
    saveGame();
  }
  $('#pause-overlay').hidden = true;
  $('#game').hidden = true;
  $('#home').hidden = false;
  if (history.state?.view === 'game') history.back();
  renderHome();
}

window.addEventListener('popstate', () => {
  if (!$('#game').hidden) {
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    goHome();
  }
});

function loadGame(g) {
  game = g;
  selected = -1;
  notesMode = false;
  manuallyPaused = false;
  runningSince = 0;
  board.classList.remove('solved');
  $('#pause-overlay').hidden = true;
  $('#loading-overlay').hidden = true;
  $('#game-label').textContent = g.mode === 'daily'
    ? `Daily · ${formatDate(g.date, { month: 'short', day: 'numeric' })}`
    : DIFFICULTIES[g.difficulty].label;
  $('#timer').textContent = formatTime(g.elapsed);
  showGameView();
  render();
  if (!g.completed) startTimer();
}

function withLoading(work) {
  showGameView();
  game = null;
  cells.forEach((c) => { c.className = c.className.replace(/\b(selected|peer|same|error|user|given)\b/g, ''); c.firstChild.textContent = ''; });
  $('#game-label').textContent = '';
  $('#game-sub').textContent = '';
  $('#timer').textContent = '0:00';
  $('#loading-overlay').hidden = false;
  // Let the spinner paint before the (synchronous) generator runs.
  requestAnimationFrame(() => setTimeout(() => loadGame(work()), 20));
}

async function startFreeGame(difficulty) {
  const current = store.get('current', null);
  if (current && !current.completed) {
    const ok = await confirmAction(`Start a new ${DIFFICULTIES[difficulty].label} game? Your current game will be lost.`, 'New game');
    if (!ok) return;
  }
  withLoading(() => {
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const { puzzle, solution } = generate(difficulty, seed);
    const g = newGameState({ mode: 'free', difficulty, puzzle, solution });
    const stats = store.get('stats', {});
    stats[difficulty] = { played: 0, won: 0, best: null, ...stats[difficulty] };
    stats[difficulty].played++;
    store.set('stats', stats);
    store.set('current', g);
    return g;
  });
}

function startDaily() {
  const key = dateKey();
  const saved = store.get('daily:' + key, null);
  if (saved?.completed) { openLeaderboard(key); return; }
  if (saved) { loadGame(saved); return; }
  withLoading(() => {
    const { puzzle, solution, difficulty } = generateDaily(key);
    const g = newGameState({ mode: 'daily', difficulty, puzzle, solution, date: key });
    store.set('daily:' + key, g);
    return g;
  });
}

// ---------- Home ----------

function streak() {
  const history = store.get('dailyHistory', {});
  let key = dateKey();
  if (!history[key]) key = shiftDate(key, -1);
  let n = 0;
  while (history[key]) { n++; key = shiftDate(key, -1); }
  return n;
}

function renderHome() {
  const key = dateKey();
  $('#daily-date').textContent = formatDate(key);
  const done = store.get('dailyHistory', {})[key];
  const inProgress = store.get('daily:' + key, null);
  const label = DIFFICULTIES[dailyDifficulty(key)].label;
  if (done) {
    $('#daily-meta').textContent = `${label} · Solved in ${formatTime(done.finalMs)}`;
    $('#daily-play').textContent = 'View results';
  } else if (inProgress) {
    $('#daily-meta').textContent = `${label} · ${formatTime(inProgress.elapsed)} so far`;
    $('#daily-play').textContent = 'Continue';
  } else {
    $('#daily-meta').textContent = `${label} · Same puzzle for everyone today`;
    $('#daily-play').textContent = 'Play';
  }
  const s = streak();
  $('#streak').hidden = s < 1;
  $('#streak').textContent = `🔥 ${s} day${s === 1 ? '' : 's'}`;

  const current = store.get('current', null);
  $('#continue-card').hidden = !current || current.completed;
  if (current && !current.completed) {
    const filled = current.values.filter((v, i) => v && !current.puzzle[i]).length;
    const total = current.puzzle.filter((v) => !v).length;
    $('#continue-meta').textContent =
      `${DIFFICULTIES[current.difficulty].label} · ${formatTime(current.elapsed)} · ${Math.round((filled / total) * 100)}%`;
  }

  const stats = store.get('stats', {});
  for (const btn of document.querySelectorAll('.difficulty')) {
    const s = stats[btn.dataset.difficulty];
    btn.querySelector('small').textContent = s?.best != null ? `Best ${formatTime(s.best)}` : 'Not played yet';
  }
}

$('#daily-play').addEventListener('click', startDaily);
$('#daily-board-btn').addEventListener('click', () => openLeaderboard(dateKey()));
$('#continue-btn').addEventListener('click', () => {
  const current = store.get('current', null);
  if (current) loadGame(current);
});
for (const btn of document.querySelectorAll('.difficulty')) {
  btn.addEventListener('click', () => startFreeGame(btn.dataset.difficulty));
}

// ---------- Leaderboard ----------

let lbDate = dateKey();
let lbRequest = 0;

function openLeaderboard(key) {
  lbDate = key;
  $('#leaderboard-dialog').showModal();
  renderLeaderboard();
}

async function renderLeaderboard() {
  const key = lbDate;
  const today = dateKey();
  $('#lb-date').textContent = key === today ? 'Today' : formatDate(key);
  $('#lb-next').disabled = key >= today;
  const list = $('#lb-list');
  const status = $('#lb-status');
  list.replaceChildren();

  const mine = store.get('dailyHistory', {})[key];
  $('#lb-mine').textContent = mine
    ? `Your time: ${formatTime(mine.finalMs)}${mine.hints ? ` (${mine.hints} hint${mine.hints > 1 ? 's' : ''})` : ''}`
    : key === today ? "You haven't solved today's puzzle yet." : '';

  if (!leaderboardEnabled) {
    status.textContent = 'The online leaderboard is not set up yet. Your recent daily results:';
    const history = store.get('dailyHistory', {});
    const keys = Object.keys(history).sort().reverse().slice(0, 14);
    keys.forEach((k) => list.appendChild(row('', formatDate(k, { weekday: 'short', month: 'short', day: 'numeric' }), history[k].finalMs, history[k].hints, k === key)));
    if (!keys.length) status.textContent = 'The online leaderboard is not set up yet. Solve a daily puzzle to start your history.';
    return;
  }

  status.textContent = 'Loading…';
  const req = ++lbRequest;
  try {
    const scores = await fetchScores(key, clientId());
    if (req !== lbRequest) return;
    scores.forEach((s, idx) => list.appendChild(row(idx + 1, s.name, s.time_ms, s.hints, s.me)));
    status.textContent = scores.length ? '' : 'No times yet. Be the first!';
    list.querySelector('.me')?.scrollIntoView({ block: 'nearest' });
  } catch {
    if (req === lbRequest) status.textContent = "Couldn't load the leaderboard. Are you offline?";
  }
}

function row(rank, name, ms, hints, isMe) {
  const li = document.createElement('li');
  if (isMe) li.className = 'me';
  const r = document.createElement('span');
  r.className = 'rank';
  r.textContent = rank;
  const n = document.createElement('span');
  n.className = 'name';
  n.textContent = name;
  const t = document.createElement('span');
  t.className = 'time';
  t.textContent = formatTime(ms);
  if (hints) {
    const small = document.createElement('small');
    small.textContent = `${hints} hint${hints > 1 ? 's' : ''}`;
    t.appendChild(small);
  }
  li.append(r, n, t);
  return li;
}

$('#lb-prev').addEventListener('click', () => { lbDate = shiftDate(lbDate, -1); renderLeaderboard(); });
$('#lb-next').addEventListener('click', () => { lbDate = shiftDate(lbDate, 1); renderLeaderboard(); });

// ---------- Settings ----------

function applyTheme() {
  if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = settings.theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (settings.theme === 'auto') m.setAttribute('content', m.media.includes('dark') ? '#0f1115' : '#f4f5f8');
    else m.setAttribute('content', bg);
  });
  document.querySelectorAll('#theme-select button').forEach((b) => b.classList.toggle('active', b.dataset.themeValue === settings.theme));
}

function saveSettings() {
  store.set('settings', settings);
}

$('#settings-btn').addEventListener('click', () => {
  document.querySelectorAll('[data-setting]').forEach((input) => { input.checked = settings[input.dataset.setting]; });
  $('#profile-name').value = store.get('name', '');
  const stats = store.get('stats', {});
  const won = Object.values(stats).reduce((n, s) => n + (s.won || 0), 0);
  const dailies = Object.keys(store.get('dailyHistory', {})).length;
  $('#stats-summary').textContent = `${won} game${won === 1 ? '' : 's'} solved · ${dailies} daily puzzle${dailies === 1 ? '' : 's'} completed`;
  $('#settings-dialog').showModal();
});

document.querySelectorAll('[data-setting]').forEach((input) => {
  input.addEventListener('change', () => {
    settings[input.dataset.setting] = input.checked;
    saveSettings();
    render();
  });
});

$('#profile-name').addEventListener('change', async (e) => {
  const name = cleanName(e.target.value);
  e.target.value = name;
  if (!name || name === store.get('name', '')) return;
  store.set('name', name);
  if (!leaderboardEnabled) return;
  await syncLeaderboard();
  if (store.get('nameSynced', '') !== name) await syncLeaderboard(); // a sync was already running
  toast(store.get('nameSynced', '') === name ? 'Name updated' : 'Name saved. It will sync when you reconnect.');
});
$('#profile-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

document.querySelectorAll('#theme-select button').forEach((btn) => {
  btn.addEventListener('click', () => {
    settings.theme = btn.dataset.themeValue;
    saveSettings();
    applyTheme();
  });
});

// Close buttons and tap-outside for sheet dialogs.
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && dialog.id !== 'win-dialog' && dialog.id !== 'confirm-dialog') dialog.close();
  });
});

// ---------- Game controls ----------

$('#back-btn').addEventListener('click', goHome);
$('#pause-btn').addEventListener('click', togglePause);
$('#resume-btn').addEventListener('click', togglePause);
$('#undo-btn').addEventListener('click', undo);
$('#erase-btn').addEventListener('click', erase);
$('#notes-btn').addEventListener('click', toggleNotes);
$('#hint-btn').addEventListener('click', hint);

// ---------- Install prompt ----------

const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installEvent = null;

function maybeShowInstall() {
  if (isStandalone || store.get('installDismissed', false)) return;
  if (installEvent) {
    $('#install-btn').hidden = false;
    $('#install-card').hidden = false;
  } else if (isIOS) {
    $('#install-text').textContent = 'Tap the Share button, then “Add to Home Screen” for full-screen, offline play.';
    $('#install-card').hidden = false;
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  maybeShowInstall();
});

$('#install-btn').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('#install-card').hidden = true;
});

$('#install-dismiss').addEventListener('click', () => {
  store.set('installDismissed', true);
  $('#install-card').hidden = true;
});

// ---------- Boot ----------

buildBoard();
applyTheme();
renderHome();
maybeShowInstall();
syncLeaderboard();
history.replaceState({ view: 'home' }, '');

// Refresh the daily card if the app is left open past midnight.
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#home').hidden) renderHome(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
}
