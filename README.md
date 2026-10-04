# The Ginvitational

Golf-tournament app: live Leaderboard, score entry by group code, TV Mode, print scorecards, a Broadcast
feed, multiple games (net/gross, better ball, scramble, multi-format rounds, match play) and multiple rounds.
React + Vite, with a Supabase (Postgres) database. Pushing to `main` deploys the live site.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine and helper tests (no database needed)
npm run lint
npm run build
```

Create `.env.local` (never committed) with:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Database

`supabase/migrations/` holds every change, in order. For a **brand-new** database run `0000_baseline_schema.sql`
first, then `0001`, `0002`, ... through the latest. The live database already has everything up to the last
file you ran; new files are run by pasting them into Supabase → SQL Editor. Each file is safe to run twice.
(`0000` is only for fresh databases; it was reconstructed, not dumped — see the note inside it.)

## Where things live

| Path | What it is |
| --- | --- |
| `src/App.jsx` | The app: screens, Admin, data loading (large — being split up over time) |
| `src/lib/golf.js` | Shared helpers: handicap strokes, `formatToPar`, names |
| `src/lib/gameCalc.js` | Leaderboard math for every game format |
| `src/lib/matchPlay.js` | Match play results (singles, four-ball, foursomes) |
| `src/lib/broadcastEngine.js` | What counts as a Broadcast "moment", and the wording |
| `src/lib/teeSheet.js` | Excel/tee-time reading and the phone group builder |
| `src/lib/paging.js` | Loads every row past the database's 1,000-row limit |
| `src/lib/supabase.js` | The database client |
| `tests/` | `node --test` tests for everything in `src/lib` |

## Things worth knowing

- Course pars and stroke index are constants at the top of `src/App.jsx`.
- The Admin PIN is a screen-level gate only, and the database is open to the app's key by design.
- Entered scores are saved on the phone first and uploaded after, so a dropped signal doesn't lose them.
- Test data convention: anything named `ZZ…` is throwaway and safe to delete.
