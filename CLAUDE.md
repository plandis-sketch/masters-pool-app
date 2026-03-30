# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server (Vite HMR)
npm run build     # tsc + Vite production build
npm run lint      # ESLint
npm run preview   # Preview production build locally

# Run the scraper manually (fetches ESPN scores → Firestore)
node scripts/scrape-scores.js --once

# Firebase deployment (automated via GitHub Actions on push to main)
firebase deploy --only hosting
firebase deploy --only functions
```

There are no unit tests in this project.

## Architecture

**Stack:** React 19 + TypeScript + Vite, Firebase (Auth, Firestore, Cloud Functions, Hosting), Tailwind CSS 4, React Router 7.

**Data flow:**
1. `scripts/scrape-scores.js` (and `functions/index.js` cloud function) poll the ESPN scoreboard API every 5 minutes during tournament days, do fuzzy name matching against the tournament roster, and write `golferScores/{golferId}` documents to Firestore.
2. The frontend reads Firestore via `src/hooks/useTournament.ts` (real-time listeners) and also polls ESPN directly via `src/lib/espnApi.ts` / `useEspnLeaderboard` for live Today/Thru data not persisted to Firestore.
3. Scores are combined in `Leaderboard.tsx` — Firestore scores (position/points) merged with live ESPN data (today's round score, holes completed).

**Firestore schema:**
```
tournaments/{tourId}
  tiers/{tierId}            — 6 tiers, each with a golfers array
  golferScores/{golferId}   — live scores written by scraper
  entries/{entryId}         — user picks + totalScore
  dailyLeaderboards/{roundX} — top 10 snapshots per round
users/{uid}                 — profile (displayName, isAdmin, feeAcknowledged)
```

**Scoring:** Lower is better (position → points). Missed cut / withdrawn = `cutPlayerCount + 1`. Once `tournament.cutPlayerCount` is set in Firestore, no golfer's points can exceed that value (safety cap against stale ESPN data). Entry total = sum of 6 golfer point values.

**Auth & routing (`src/App.tsx`):**
- Public: `/`, `/name-entry`, `/fee-acknowledgment`
- `RequireAuth` guard wraps all main routes under `Layout`
- `RequireAdmin` guard wraps `/admin/*` routes; admin status is `users/{uid}.isAdmin` in Firestore plus a client-side password check (`AdminLogin.tsx`)
- Picks lock automatically when `tournament.picksLocked` is set (triggered at `firstTeeTime` by the scraper)

**Key files:**
- `src/lib/types.ts` — all TypeScript interfaces (source of truth for data shapes)
- `src/constants/scoring.ts` — scoring functions (position → points, missed cut, total calc)
- `src/constants/theme.ts` — tier labels/colors, payment methods, entry fee amount
- `src/lib/espnApi.ts` — ESPN API fetch + parsing + `useEspnLeaderboard` hook
- `src/hooks/useTournament.ts` — all Firestore reads (tournament, tiers, entries, scores, daily leaderboards)
- `functions/index.js` — Cloud Function that runs the scraper; mirrors `scripts/scrape-scores.js`

**CI/CD:**
- Push to `main` → GitHub Actions builds and deploys to Firebase Hosting (`phils-masters-pool`)
- `.github/workflows/scrape-scores.yml` runs `node scripts/scrape-scores.js --once` on a cron every 5 minutes during March Thu–Sun 7am–8pm ET

## Environment

Copy `.env.example` to `.env` and fill in Firebase config values (`VITE_FIREBASE_*`). The Firebase project is `phils-masters-pool`.

Firestore rules are currently open (`allow read, write: if true`) — suitable for this private pool app but should be tightened before any public exposure.
