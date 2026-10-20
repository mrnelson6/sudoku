-- Run this once in the Supabase SQL editor to create the daily leaderboard.

create table if not exists public.daily_scores (
  id          bigint generated always as identity primary key,
  puzzle_date date        not null,
  name        text        not null check (char_length(btrim(name)) between 1 and 20),
  time_ms     integer     not null check (time_ms between 15000 and 86400000),
  hints       smallint    not null default 0 check (hints between 0 and 81),
  client_id   uuid        not null,
  created_at  timestamptz not null default now(),
  unique (puzzle_date, client_id)
);

create index if not exists daily_scores_date_time on public.daily_scores (puzzle_date, time_ms);

alter table public.daily_scores enable row level security;

-- Anyone can read the board.
drop policy if exists "read scores" on public.daily_scores;
create policy "read scores" on public.daily_scores
  for select to anon using (true);

-- Anyone can add a score, but only for "today" (allowing for time zones).
drop policy if exists "insert today's score" on public.daily_scores;
create policy "insert today's score" on public.daily_scores
  for insert to anon
  with check (puzzle_date between current_date - 1 and current_date + 1);

-- Keep client_id private so nobody can block another player's submission.
revoke all on public.daily_scores from anon;
grant select (id, puzzle_date, name, time_ms, hints, created_at) on public.daily_scores to anon;
grant insert (puzzle_date, name, time_ms, hints, client_id) on public.daily_scores to anon;
