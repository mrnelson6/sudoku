# Sudoku

A mobile-first sudoku web app that installs to the home screen on iOS and Android (PWA).
No build step and no dependencies: just static files you can host on GitHub Pages.

- Unlimited puzzles in four difficulties (Easy, Medium, Hard, Expert), each with a unique solution and graded by the techniques needed to solve it
- A daily puzzle that is the same for everyone, plus a streak counter
- An optional online leaderboard for the daily puzzle, backed by a Google Sheet
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

Pushing to `main` updates the site within about a minute. Installed apps pick up the change the next time they're opened while online. Saved games and stats carry over.

## Enable the daily leaderboard (optional)

GitHub Pages only serves static files, so scores are stored in a Google Sheet through a small Apps Script web app. It's free and doesn't go to sleep.
Everything else works without it, and the leaderboard sheet shows your own history until you set it up.

1. Create a new Google Sheet, for example "Sudoku leaderboard".
2. Open **Extensions → Apps Script**, replace the starter code with the contents of `apps-script/Code.gs`, and save.
3. Click **Deploy → New deployment**, choose the type **Web app**, and set:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy** and approve the permissions prompt. Google warns that the app is unverified because you wrote it yourself: choose **Advanced → Go to (project name)**.
5. Copy the **Web app URL** (it ends in `/exec`) into `LEADERBOARD_URL` in `js/config.js`, then commit and push.

Two tabs are created automatically: `scores`, with one row per daily result, and `players`, with each device's current name. To remove a score, delete its row in `scores`. To rename someone, edit their name in `players`.

If you edit the script later, go to **Deploy → Manage deployments → ✏️ → Version: New version**. This keeps the same URL. A *new* deployment gets a different URL.

**Players:** there are no accounts. Each device gets a random ID stored in the browser, which allows one score per device per day and highlights your own row. The ID is never shown to other players. The home-screen app and Safari keep separate storage, so they count as two devices.

**Names:** players are asked for a name the first time they finish a daily puzzle, and can change it later under Settings → Your name. After that, daily times post automatically. The leaderboard always shows each player's current name, so renaming also updates past days. A result finished offline is saved and posted when the device is back online.

**Cheating:** times are measured in the browser, so a determined player could submit a fake time. The server rejects times under 15 seconds and dates other than today. Beyond that, it trusts the players, which is fine for friendly competition.

## Notes

- The daily puzzle is generated from the date with a seeded random number generator in `js/sudoku.js`. If you change the generator, future daily puzzles change too. Avoid changing it mid-day, or players will see different puzzles.
- Each daily hint adds a 30-second penalty to the leaderboard time. You can change this in `js/config.js`.
- Keyboard shortcuts on desktop: arrow keys move, 1–9 enter a number, Backspace erases, N toggles notes, Z undoes, H gives a hint, and Space pauses.
