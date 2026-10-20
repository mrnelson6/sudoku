import { LEADERBOARD_URL } from './config.js';

export const leaderboardEnabled = Boolean(LEADERBOARD_URL);

// Apps Script web apps answer with a redirect that browsers follow
// automatically. Posting as text/plain avoids a CORS preflight, which Apps
// Script doesn't support.

async function post(body) {
  const res = await fetch(LEADERBOARD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Leaderboard request failed (${res.status})`);
  const data = await res.json();
  if (data.error) throw Object.assign(new Error(data.error), { rejected: true });
  return data.result;
}

export async function fetchScores(dateKey, clientId) {
  const params = new URLSearchParams({ date: dateKey, client: clientId });
  const res = await fetch(`${LEADERBOARD_URL}?${params}`);
  if (!res.ok) throw new Error(`Leaderboard request failed (${res.status})`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.scores;
}

// Returns 'ok' or 'duplicate'. Throws on other failures.
export function submitScore({ dateKey, name, timeMs, hints, clientId }) {
  return post({ date: dateKey, name, time_ms: Math.round(timeMs), hints, client_id: clientId });
}

export function setName({ name, clientId }) {
  return post({ action: 'name', name, client_id: clientId });
}
