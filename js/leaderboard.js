import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const leaderboardEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const headers = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
});

export async function fetchScores(dateKey, limit = 100) {
  const params = new URLSearchParams({
    puzzle_date: `eq.${dateKey}`,
    select: 'name,time_ms,hints,created_at',
    order: 'time_ms.asc,created_at.asc',
    limit: String(limit),
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/daily_scores?${params}`, { headers: headers() });
  if (!res.ok) throw new Error(`Leaderboard request failed (${res.status})`);
  return res.json();
}

// Returns 'ok' or 'duplicate'. Throws on other failures.
export async function submitScore({ dateKey, name, timeMs, hints, clientId }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/daily_scores`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({
      puzzle_date: dateKey,
      name,
      time_ms: Math.round(timeMs),
      hints,
      client_id: clientId,
    }),
  });
  if (res.status === 409) return 'duplicate';
  if (!res.ok) throw new Error(`Could not submit score (${res.status})`);
  return 'ok';
}
