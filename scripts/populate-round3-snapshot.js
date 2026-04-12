/**
 * One-time script: Populate Round 3 Daily Leaderboard snapshot.
 *
 * Uses the same data source as Pool Standings:
 *   1. Fetches live ESPN positions (authoritative, tie-corrected)
 *   2. Falls back to Firestore position only if ESPN doesn't have the golfer
 *   3. Firestore status is authoritative for cut/withdrawn
 *   4. cutPlayerCount+1 from tournament doc for missed-cut points
 *
 * This guarantees the snapshot matches what Pool Standings displayed at end of Round 3.
 *
 * Usage:
 *   node scripts/populate-round3-snapshot.js          # dry run (preview only)
 *   node scripts/populate-round3-snapshot.js --write  # actually save to Firestore
 *   node scripts/populate-round3-snapshot.js --write --force  # overwrite if exists
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, setDoc, getDocs, getDoc, query, orderBy, Timestamp,
} from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
const env = {};
try {
  const envFile = readFileSync(envPath, 'utf-8');
  envFile.split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) env[key.trim()] = vals.join('=').trim();
  });
} catch { /* no .env file — fall back to process.env */ }
const getEnv = key => process.env[key] || env[key];

const firebaseConfig = {
  apiKey: getEnv('VITE_FIREBASE_API_KEY'),
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getEnv('VITE_FIREBASE_APP_ID'),
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--write');
const FORCE = args.includes('--force');

const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

/**
 * Fetch ESPN leaderboard and return a name→positionNum map for active golfers.
 * Uses the same tie-correction logic as espnApi.ts in the frontend.
 */
async function fetchEspnPositions() {
  try {
    const res = await fetch(ESPN_URL);
    if (!res.ok) { console.warn(`ESPN fetch failed: HTTP ${res.status}`); return null; }
    const data = await res.json();

    const events = data.events || [];
    // Accept any event state — tournament may be post (complete) when this runs
    const event =
      events.find(e => e.status?.type?.state === 'in') ||
      events.find(e => e.status?.type?.state === 'post') ||
      events.find(e => e.status?.type?.state === 'pre');
    if (!event) { console.warn('ESPN: no event found'); return null; }

    const comp = event.competitions?.[0];
    const competitors = comp?.competitors || [];
    if (competitors.length === 0) { console.warn('ESPN: no competitors'); return null; }

    const currentRound = comp?.status?.period || event.status?.period || '?';
    const eventState = event.status?.type?.state || '?';
    console.log(`ESPN: event="${event.name}", state=${eventState}, period=${currentRound}, ${competitors.length} competitors`);

    // Build raw golfer list
    const golfers = competitors.map(c => {
      const athlete = c.athlete || {};
      const statusVal = (c.status?.displayValue || '').toUpperCase().trim();
      let status = 'active';
      if (statusVal === 'CUT' || statusVal === 'MC' || statusVal === 'DQ') status = 'cut';
      else if (statusVal === 'WD' || statusVal === 'W/D') status = 'withdrawn';
      const name = (athlete.displayName || athlete.fullName || '').toLowerCase().trim();
      const order = c.order || 999;
      const score = typeof c.score === 'string' ? c.score : (c.score?.displayValue || '--');
      return { name, order, status, score };
    });

    // Apply true tied-position correction (same as espnApi.ts):
    // ESPN's `order` is sequential — group active golfers by score-to-par
    // and give each group the minimum order in that group.
    const scoreToMinPos = new Map();
    for (const g of golfers) {
      if (g.status === 'active' && g.score !== '--') {
        const existing = scoreToMinPos.get(g.score);
        if (existing === undefined || g.order < existing) scoreToMinPos.set(g.score, g.order);
      }
    }
    const positionByName = new Map();
    for (const g of golfers) {
      if (g.status === 'active') {
        const truePos = scoreToMinPos.get(g.score) ?? g.order;
        positionByName.set(g.name, truePos);
      }
    }

    return positionByName;
  } catch (err) {
    console.warn('ESPN fetch error:', err.message);
    return null;
  }
}

async function populateRound3Snapshot() {
  console.log(DRY_RUN ? '\n[DRY RUN — pass --write to save]\n' : '\n[WRITING to Firestore]\n');

  // Fetch ESPN positions first — same source as Pool Standings
  const espnPositions = await fetchEspnPositions();
  if (espnPositions) {
    console.log(`ESPN positions loaded for ${espnPositions.size} active golfers`);
  } else {
    console.warn('WARNING: ESPN unavailable — falling back to Firestore positions only');
  }

  // Find active tournament
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournaments = tournamentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find(t => t.status !== 'complete') || tournaments[0];
  if (!tournament) { console.log('No tournament found.'); return; }
  console.log(`Tournament: ${tournament.name} (${tournament.id})`);

  const cutPlayerCount = tournament.cutPlayerCount;
  const WD_POINTS = cutPlayerCount ? cutPlayerCount + 1 : 51;
  console.log(`cutPlayerCount: ${cutPlayerCount ?? '(not set)'} → WD/missed-cut points: ${WD_POINTS}`);

  // Check if snapshot already exists
  const snapshotRef = doc(db, 'tournaments', tournament.id, 'dailyLeaderboards', 'round3');
  const existing = await getDoc(snapshotRef);
  if (existing.exists()) {
    if (!FORCE) {
      const snap = existing.data();
      const snapTime = snap.snapshotAt?.toDate?.()?.toLocaleString() || '?';
      console.log(`Round 3 snapshot already exists (captured ${snapTime}). Pass --force to overwrite.`);
      return;
    }
    console.log('Round 3 snapshot exists — overwriting (--force).');
  }

  // Load roster
  const tiersSnap = await getDocs(
    query(collection(db, 'tournaments', tournament.id, 'tiers'), orderBy('tierNumber'))
  );
  const allGolfers = [];
  tiersSnap.docs.forEach(d => d.data().golfers.forEach(g => allGolfers.push(g)));
  console.log(`Roster: ${allGolfers.length} golfers across ${tiersSnap.docs.length} tiers`);

  // Load Firestore golfer scores (authoritative for status: cut/withdrawn, and for points)
  const scoresSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'golferScores')
  );
  const golferScores = new Map();
  scoresSnap.docs.forEach(d => golferScores.set(d.id, { id: d.id, ...d.data() }));
  console.log(`Loaded ${golferScores.size} golfer score documents`);

  // --- Resolve points for each golfer ---
  // Priority matches Pool Standings exactly:
  //   1. cut/withdrawn (Firestore status) → WD_POINTS
  //   2. ESPN positionNum (live, tie-corrected) for active players
  //   3. Firestore points as fallback (already computed by scraper)
  const r3Points = new Map();
  const espnMisses = [];
  const wdPlayers = [];
  let espnHits = 0;
  let firestoreFallbacks = 0;

  for (const golfer of allGolfers) {
    const score = golferScores.get(golfer.id);
    const name = (score?.name || golfer.name || '').toLowerCase().trim();
    const status = score?.status || 'active';

    if (status === 'cut' || status === 'withdrawn') {
      r3Points.set(golfer.id, WD_POINTS);
      wdPlayers.push(score?.name || golfer.name);
      continue;
    }

    // Active player: prefer ESPN live position, fall back to Firestore points
    const espnPos = espnPositions?.get(name);
    if (espnPos !== undefined) {
      r3Points.set(golfer.id, espnPos);
      espnHits++;
    } else {
      // Fall back to Firestore points (already computed by the scraper)
      const fsPoints = score?.points;
      if (fsPoints !== null && fsPoints !== undefined) {
        r3Points.set(golfer.id, fsPoints);
        firestoreFallbacks++;
        espnMisses.push(score?.name || golfer.name);
      } else {
        r3Points.set(golfer.id, WD_POINTS);
        wdPlayers.push(score?.name || golfer.name);
      }
    }
  }

  console.log(`\nPosition source: ${espnHits} from ESPN, ${firestoreFallbacks} Firestore fallbacks, ${wdPlayers.length} WD/missing`);
  if (espnMisses.length > 0) console.log('  ESPN misses (used Firestore): ' + espnMisses.join(', '));
  if (wdPlayers.length > 0) console.log(`  WD/missed-cut (${WD_POINTS} pts): ` + wdPlayers.join(', '));

  // --- Build entry standings ---
  const entriesSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'entries')
  );
  const allEntries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`Entries: ${allEntries.length}`);

  const entryStandings = allEntries.map(entry => {
    const pickIds = [
      entry.picks?.tier1, entry.picks?.tier2, entry.picks?.tier3,
      entry.picks?.tier4, entry.picks?.tier5, entry.picks?.tier6,
    ];
    const golfers = pickIds.map(id => {
      const points = r3Points.get(id) ?? WD_POINTS;
      const score = golferScores.get(id);
      return {
        id: id || '',
        name: score?.name || allGolfers.find(g => g.id === id)?.name || 'Unknown',
        points,
        score: score?.score || '--',
        status: score?.status || 'active',
      };
    });
    const totalScore = golfers.reduce((sum, g) => sum + g.points, 0);
    return {
      entryId: entry.id,
      participantName: entry.participantName || '',
      entryLabel: entry.entryLabel || entry.participantName || '',
      totalScore,
      golfers,
    };
  });

  // Sort by total (lowest wins) and take top 10
  entryStandings.sort((a, b) => a.totalScore - b.totalScore);
  const top10 = entryStandings.slice(0, 10);

  // --- Preview ---
  console.log('\n=== Top 10 at end of Round 3 ===');
  top10.forEach((entry, idx) => {
    const golferStr = entry.golfers.map(g => `${g.name}(${g.points})`).join(', ');
    console.log(`  ${idx + 1}. ${entry.entryLabel} — ${entry.totalScore} pts  [${golferStr}]`);
  });

  if (DRY_RUN) {
    console.log('\nDry run complete. Pass --write to save this to Firestore.');
    return;
  }

  await setDoc(snapshotRef, {
    round: 3,
    standings: top10,
    snapshotAt: Timestamp.now(),
  });
  console.log('\nRound 3 snapshot written to Firestore — Day 3 leaderboard is now live!');
}

populateRound3Snapshot()
  .then(() => process.exit(0))
  .catch(err => { console.error('Fatal:', err); process.exit(1); });
