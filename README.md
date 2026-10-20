# Sudoku

A mobile-first sudoku web app that installs to the home screen on iOS and Android (PWA).
No build step and no dependencies: just static files you can host on GitHub Pages.

- Unlimited puzzles in four difficulties (Easy, Medium, Hard, Expert), each with a unique solution and graded by the techniques needed to solve it
- A daily puzzle that is the same for everyone, plus a streak counter
- An optional online leaderboard for the daily puzzle, backed by Supabase's free tier
- Notes, undo, erase, hints, mistake highlighting, auto-save/resume, dark mode, and offline play

## Run locally

```sh
python -m http.server 8000
```

Then open http://localhost:8000. A plain `file://` URL won't work because the app uses JS modules and a service worker.

## Deploy to GitHub Pages

1. Create a GitHub repo and push these files to the `main` branch.
2. In the repo, go to **Settings → Pages**, set **Source** to "Deploy from a branch", and pick `main` / `/ (root)`.
3. After a minute, the site is live at `https://<user>.github.io/<repo>/`.

To install it as an app:
- **iPhone/iPad (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** use the "Install" button on the home screen, or ⋮ → Install app.

After deploying changes, bump `VERSION` in `sw.js`. Installed apps then fetch the new files.

## Enable the daily leaderboard (optional)

GitHub Pages only serves static files, so the leaderboard needs a small hosted database.
Everything else works without one, and the leaderboard sheet shows your own history until you set this up.

1. Create a free project at https://supabase.com.
2. Open **SQL Editor**, paste the contents of `supabase.sql`, and run it.
3. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key into `js/config.js`.
4. Commit and push.

The anon key is meant to be public. Row-level security only allows reading scores and inserting one score per device per day, and only for today's date.

**Cheating:** times are measured in the browser, so a determined player could submit a fake time.
For a casual leaderboard among friends, this is usually fine.

## Notes

- The daily puzzle is generated from the date with a seeded random number generator in `js/sudoku.js`. If you change the generator, future daily puzzles change too. Avoid changing it mid-day, or players will see different puzzles.
- Each daily hint adds a 30-second penalty to the leaderboard time. You can change this in `js/config.js`.
- Keyboard shortcuts on desktop: arrow keys move, 1–9 enter a number, Backspace erases, N toggles notes, Z undoes, H gives a hint, and Space pauses.
