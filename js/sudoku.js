// Sudoku engine: seeded generation, uniqueness checking and logic-based grading.
// Everything here is deterministic for a given seed so the daily puzzle is the
// same for every player. Changing this file changes future daily puzzles.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---- Board geometry -------------------------------------------------------

export const ROW = new Int8Array(81);
export const COL = new Int8Array(81);
export const BOX = new Int8Array(81);
const UNITS = []; // 27 arrays of 9 cell indexes
export const PEERS = []; // 81 arrays of 20 cell indexes

for (let i = 0; i < 81; i++) {
  ROW[i] = Math.floor(i / 9);
  COL[i] = i % 9;
  BOX[i] = Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3);
}
for (let u = 0; u < 9; u++) {
  UNITS.push([...Array(81).keys()].filter((i) => ROW[i] === u));
  UNITS.push([...Array(81).keys()].filter((i) => COL[i] === u));
  UNITS.push([...Array(81).keys()].filter((i) => BOX[i] === u));
}
for (let i = 0; i < 81; i++) {
  const s = new Set();
  for (let j = 0; j < 81; j++) {
    if (j !== i && (ROW[i] === ROW[j] || COL[i] === COL[j] || BOX[i] === BOX[j])) s.add(j);
  }
  PEERS.push([...s]);
}

const ALL = 0x3fe; // bits 1..9

function popcount(m) {
  let c = 0;
  while (m) { m &= m - 1; c++; }
  return c;
}

function bitToDigit(bit) {
  return 31 - Math.clz32(bit);
}

// ---- Brute-force solver ---------------------------------------------------

// Counts solutions up to `limit`. Returns {count, solution}.
export function solve(puzzle, limit = 2, rng = null) {
  const g = Array.from(puzzle);
  const rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9);
  for (let i = 0; i < 81; i++) {
    const v = g[i];
    if (!v) continue;
    const bit = 1 << v;
    if ((rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & bit) return { count: 0, solution: null };
    rows[ROW[i]] |= bit; cols[COL[i]] |= bit; boxes[BOX[i]] |= bit;
  }
  let count = 0;
  let solution = null;

  function search() {
    let best = -1, bestMask = 0, bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & ALL;
      const c = popcount(m);
      if (c === 0) return;
      if (c < bestCount) {
        best = i; bestMask = m; bestCount = c;
        if (c === 1) break;
      }
    }
    if (best === -1) {
      count++;
      if (!solution) solution = g.slice();
      return;
    }
    const digits = [];
    for (let m = bestMask; m; m &= m - 1) digits.push(bitToDigit(m & -m));
    if (rng) shuffle(digits, rng);
    const r = ROW[best], c = COL[best], b = BOX[best];
    for (const v of digits) {
      const bit = 1 << v;
      g[best] = v; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      search();
      g[best] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
      if (count >= limit) return;
    }
  }

  search();
  return { count, solution };
}

// ---- Human-style grader ---------------------------------------------------
// Level 1: singles only. Level 2: also needs locked candidates / naked pairs.
// Level 3: needs something harder than that.

export function rate(puzzle) {
  const g = Array.from(puzzle);
  const cand = new Int32Array(81);
  for (let i = 0; i < 81; i++) {
    if (g[i]) continue;
    let m = ALL;
    for (const p of PEERS[i]) if (g[p]) m &= ~(1 << g[p]);
    cand[i] = m;
  }

  const place = (i, v) => {
    g[i] = v; cand[i] = 0;
    const bit = 1 << v;
    for (const p of PEERS[i]) cand[p] &= ~bit;
  };

  const singles = () => {
    let progress = false;
    for (let i = 0; i < 81; i++) {
      if (!g[i] && popcount(cand[i]) === 1) { place(i, bitToDigit(cand[i])); progress = true; }
    }
    for (const unit of UNITS) {
      for (let v = 1; v <= 9; v++) {
        const bit = 1 << v;
        let only = -1, n = 0;
        for (const i of unit) if (cand[i] & bit) { only = i; n++; }
        if (n === 1) { place(only, v); progress = true; }
      }
    }
    return progress;
  };

  const eliminate = (cells, bit) => {
    let changed = false;
    for (const i of cells) if (cand[i] & bit) { cand[i] &= ~bit; changed = true; }
    return changed;
  };

  const lockedCandidates = () => {
    let progress = false;
    for (const unit of UNITS) {
      for (let v = 1; v <= 9; v++) {
        const bit = 1 << v;
        const cells = unit.filter((i) => cand[i] & bit);
        if (cells.length < 2) continue;
        // Cells sharing a row, column or box with all candidates in this unit.
        for (const key of [ROW, COL, BOX]) {
          const k = key[cells[0]];
          if (!cells.every((i) => key[i] === k)) continue;
          const others = [];
          for (let i = 0; i < 81; i++) if (key[i] === k && !unit.includes(i)) others.push(i);
          if (eliminate(others, bit)) progress = true;
        }
      }
    }
    return progress;
  };

  const nakedPairs = () => {
    let progress = false;
    for (const unit of UNITS) {
      const pairs = unit.filter((i) => popcount(cand[i]) === 2);
      for (let a = 0; a < pairs.length; a++) {
        for (let b = a + 1; b < pairs.length; b++) {
          const m = cand[pairs[a]];
          if (m !== cand[pairs[b]]) continue;
          for (const i of unit) {
            if (i === pairs[a] || i === pairs[b] || !(cand[i] & m)) continue;
            cand[i] &= ~m; progress = true;
          }
        }
      }
    }
    return progress;
  };

  let level = 1;
  for (;;) {
    if (singles()) continue;
    if (lockedCandidates() || nakedPairs()) { level = 2; continue; }
    break;
  }
  return g.every((v) => v) ? level : 3;
}

// ---- Generator ------------------------------------------------------------

export const DIFFICULTIES = {
  easy:   { label: 'Easy',   clues: 42, levels: [1] },
  medium: { label: 'Medium', clues: 34, levels: [1, 2] },
  hard:   { label: 'Hard',   clues: 29, levels: [2] },
  expert: { label: 'Expert', clues: 0,  levels: [3] },
};

function carve(solution, targetClues, rng) {
  const puzzle = solution.slice();
  let clues = 81;
  // Remove symmetric pairs (180° rotation) for a classic look.
  const order = shuffle([...Array(41).keys()], rng);
  for (const i of order) {
    if (clues <= targetClues) break;
    const j = 80 - i;
    const saved = [puzzle[i], puzzle[j]];
    puzzle[i] = 0; puzzle[j] = 0;
    if (solve(puzzle, 2).count !== 1) {
      puzzle[i] = saved[0]; puzzle[j] = saved[1];
    } else {
      clues -= i === j ? 1 : 2;
    }
  }
  return puzzle;
}

export function generate(difficulty, seed, spec = DIFFICULTIES[difficulty]) {
  const rng = mulberry32(seed);
  let fallback = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const solution = solve(new Array(81).fill(0), 1, rng).solution;
    const puzzle = carve(solution, spec.clues, rng);
    const level = rate(puzzle);
    if (spec.levels.includes(level)) return { puzzle, solution, difficulty };
    if (!fallback || Math.abs(level - spec.levels[0]) < Math.abs(fallback.level - spec.levels[0])) {
      fallback = { puzzle, solution, difficulty, level };
    }
  }
  delete fallback.level;
  return fallback;
}

// The daily switched to always-medium (with the easier clue counts) on this
// date. Earlier dates keep their original schedule and clue counts so a puzzle
// already in play doesn't change under anyone.
const DAILY_MEDIUM_FROM = '2026-10-25';
const LEGACY_CLUES = { easy: 38, medium: 31, hard: 26, expert: 0 };

export function dailyDifficulty(dateKey) {
  if (dateKey >= DAILY_MEDIUM_FROM) return 'medium';
  // Gentle start to the week, toughest at the weekend.
  const day = new Date(dateKey + 'T12:00:00').getDay();
  return ['expert', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert'][day];
}

export function generateDaily(dateKey) {
  const difficulty = dailyDifficulty(dateKey);
  const spec = dateKey >= DAILY_MEDIUM_FROM
    ? DIFFICULTIES[difficulty]
    : { ...DIFFICULTIES[difficulty], clues: LEGACY_CLUES[difficulty] };
  return generate(difficulty, hashString('daily:' + dateKey), spec);
}
