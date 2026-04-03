/**
 * One-time script: Populate Round 1 Daily Leaderboard snapshot.
 *
 * Reconstructs Round 1 standings from the `roundScores.r1` stroke values
 * stored in golferScores — so it works correctly even after Round 2 has
 * started and live scores have been overwritten.
 *
 * Usage:
 *   node scripts/populate-round1-snapshot.js          # dry run (preview only)
 *   node scripts/populate-round1-snapshot.js --write  # actually save to Firestore
 *   node scripts/populate-round1-snapshot.js --write --force  # overwrite if exists
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

async function populateRound1Snapshot() {
  console.log(DRY_RUN ? '\n[DRY RUN — pass --write to save]\n' : '\n[WRITING to Firestore]\n');

  // Find active tournament
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournaments = tournamentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find(t => t.status !== 'complete') || tournaments[0];
  if (!tournament) { console.log('No tournament found.'); return; }
  console.log(`Tournament: ${tournament.name} (${tournament.id})`);

  // Check if snapshot already exists
  const snapshotRef = doc(db, 'tournaments', tournament.id, 'dailyLeaderboards', 'round1');
  const existing = await getDoc(snapshotRef);
  if (existing.exists()) {
    if (!FORCE) {
      console.log('Round 1 snapshot already exists. Pass --force to overwrite.');
      return;
    }
    console.log('Round 1 snapshot exists — overwriting (--force).');
  }

  // Load roster (for golfer names as fallback)
  const tiersSnap = await getDocs(
    query(collection(db, 'tournaments', tournament.id, 'tiers'), orderBy('tierNumber'))
  );
  const allGolfers = [];
  tiersSnap.docs.forEach(d => d.data().golfers.forEach(g => allGolfers.push(g)));
  console.log(`Roster: ${allGolfers.length} golfers across ${tiersSnap.docs.length} tiers`);

  // Load current golfer scores (contains roundScores.r1 for each golfer)
  const scoresSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'golferScores')
  );
  const golferScores = new Map();
  scoresSnap.docs.forEach(d => golferScores.set(d.id, { id: d.id, ...d.data() }));
  console.log(`Loaded ${golferScores.size} golfer score documents`);

  // --- Reconstruct Round 1 standings from roundScores.r1 ---
  //
  // At the end of Round 1 there is no cut yet, so all players are "active".
  // Points = R1 tournament position (rank by R1 strokes, ties share same rank).
  // WD players who have no R1 score get the missed-cut default (51 pts:
  // cutPlayerCount was null at R1 → default 50 → missedCutScore = 51).

  const WD_POINTS = 51;
  const playersWithR1 = [];
  const wdPlayers = [];

  for (const golfer of allGolfers) {
    const score = golferScores.get(golfer.id);
    if (!score) {
      wdPlayers.push({ id: golfer.id, name: golfer.name });
      continue;
    }
    const r1 = score.roundScores?.r1;
    if (r1 !== null && r1 !== undefined) {
      playersWithR1.push({ id: golfer.id, name: score.name || golfer.name, r1 });
    } else {
      wdPlayers.push({ id: golfer.id, name: score.name || golfer.name });
    }
  }

  // Sort by R1 strokes ascending (fewer strokes = better position in golf)
  playersWithR1.sort((a, b) => a.r1 - b.r1);

  // Assign tied positions: position = (number of players with fewer strokes) + 1
  const r1Points = new Map();
  let pos = 1;
  let i = 0;
  while (i < playersWithR1.length) {
    const strokesAtPos = playersWithR1[i].r1;
    let j = i;
    while (j < playersWithR1.length && playersWithR1[j].r1 === strokesAtPos) j++;
    // Players i..j-1 share the same position
    for (let k = i; k < j; k++) r1Points.set(playersWithR1[k].id, pos);
    pos = j + 1;
    i = j;
  }
  for (const wd of wdPlayers) r1Points.set(wd.id, WD_POINTS);

  console.log(`\nR1 field: ${playersWithR1.length} players with R1 strokes`);
  console.log(`WD/missing: ${wdPlayers.length} players → ${WD_POINTS} pts each`);
  if (wdPlayers.length > 0) {
    console.log('  WD players: ' + wdPlayers.map(w => w.name).join(', '));
  }

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
      const points = r1Points.get(id) ?? WD_POINTS;
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
  console.log('\n=== Top 10 at end of Round 1 ===');
  top10.forEach((entry, idx) => {
    const golferStr = entry.golfers.map(g => `${g.name}(${g.points})`).join(', ');
    console.log(`  ${idx + 1}. ${entry.entryLabel} — ${entry.totalScore} pts  [${golferStr}]`);
  });

  if (DRY_RUN) {
    console.log('\nDry run complete. Pass --write to save this to Firestore.');
    return;
  }

  await setDoc(snapshotRef, {
    round: 1,
    standings: top10,
    snapshotAt: Timestamp.now(),
  });
  console.log('\nRound 1 snapshot written to Firestore — Day 1 leaderboard is now live!');
}

populateRound1Snapshot()
  .then(() => process.exit(0))
  .catch(err => { console.error('Fatal:', err); process.exit(1); });
