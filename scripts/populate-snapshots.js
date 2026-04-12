/**
 * Manual Daily Leaderboard Snapshot Tool
 *
 * Reconstructs end-of-round standings from per-round score data stored in
 * Firestore and writes (or overwrites) the dailyLeaderboards snapshot.
 *
 * Usage:
 *   node scripts/populate-snapshots.js --round 3           # Populate round 3
 *   node scripts/populate-snapshots.js --round 2 --round 3 # Populate rounds 2 and 3
 *   node scripts/populate-snapshots.js --round 3 --force   # Overwrite if exists
 *   node scripts/populate-snapshots.js --check             # Show which rounds exist
 *
 * For rounds 1-3, standings are derived from each golfer's per-round stroke
 * counts (roundScores.r1/r2/r3) stored by the scraper. This gives accurate
 * end-of-round standings even when R4 is already underway.
 *
 * For round 4 (Final Day), the current live points are used since it should
 * only be run after the tournament is complete.
 *
 * Augusta National par = 72 per round (288 total). Rank is determined by
 * cumulative strokes through the target round; tied strokes share the
 * lowest (best) rank in the group, which equals pool points.
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, setDoc, getDocs, getDoc,
  query, orderBy, Timestamp
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
} catch {
  // No .env — fall back to process.env (CI)
}
const getEnv = (key) => process.env[key] || env[key];

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

// Augusta National par per round
const PAR_PER_ROUND = 72;

function calculatePoints(position, status, cutPlayerCount, round) {
  const missedCutScore = (cutPlayerCount ?? 50) + 1;
  if (status === 'cut') return missedCutScore;
  if (status === 'withdrawn') {
    // WD in R3 or later = made the cut, so points = cutPlayerCount (not +1)
    if (round && round >= 3) return cutPlayerCount ?? 50;
    return missedCutScore;
  }
  const rawPoints = position ?? 999;
  if (cutPlayerCount && cutPlayerCount > 0 && rawPoints > missedCutScore) {
    return missedCutScore;
  }
  return rawPoints;
}

/**
 * Compute position-based points from per-round stroke data for a set of
 * active golfers, assigning tied positions to tied stroke totals.
 * Returns a Map<golferId, points>.
 */
function computePositionPoints(activeGolfers, round, cutPlayerCount) {
  // activeGolfers: [{ id, roundScores: { r1, r2, r3, r4 } }]
  const withStrokes = activeGolfers
    .map(g => {
      let total = 0;
      for (let r = 1; r <= round; r++) {
        const s = g.roundScores?.['r' + r];
        if (s == null) return null; // incomplete data — skip
        total += s;
      }
      return { id: g.id, totalStrokes: total };
    })
    .filter(Boolean);

  // Sort ascending (fewer strokes = better)
  withStrokes.sort((a, b) => a.totalStrokes - b.totalStrokes);

  const pointsMap = new Map();

  // Assign positions: position = 1-based index of first occurrence of each stroke total
  let i = 0;
  while (i < withStrokes.length) {
    const position = i + 1; // 1-based rank (= pool points for tied players)
    const strokes = withStrokes[i].totalStrokes;
    // Collect all players tied at this stroke total
    let j = i;
    while (j < withStrokes.length && withStrokes[j].totalStrokes === strokes) {
      pointsMap.set(withStrokes[j].id, calculatePoints(position, 'active', cutPlayerCount, round));
      j++;
    }
    i = j;
  }

  return pointsMap;
}

async function populateSnapshot(round, force) {
  console.log(`\n=== Populating Round ${round} snapshot ===`);

  // Load tournament
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournaments = tournamentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find(t => t.status !== 'complete') || tournaments[0];
  if (!tournament) { console.log('No tournament found.'); return; }
  console.log(`Tournament: ${tournament.name} (${tournament.id})`);

  const cutPlayerCount = tournament.cutPlayerCount;
  if (!cutPlayerCount) {
    console.warn('WARNING: cutPlayerCount not set in Firestore — cut/WD points may be inaccurate.');
  }
  console.log(`cutPlayerCount: ${cutPlayerCount ?? '(not set)'}`);

  // Check if snapshot already exists
  const snapshotRef = doc(db, 'tournaments', tournament.id, 'dailyLeaderboards', 'round' + round);
  const existing = await getDoc(snapshotRef);
  if (existing.exists()) {
    if (!force) {
      const snap = existing.data();
      const snapTime = snap.snapshotAt?.toDate?.()?.toLocaleString() || '?';
      console.log(`Round ${round} snapshot already exists (captured ${snapTime}). Use --force to overwrite.`);
      return;
    }
    console.log(`Round ${round} snapshot exists — overwriting (--force).`);
  }

  // Load tiers / roster
  const tiersSnap = await getDocs(
    query(collection(db, 'tournaments', tournament.id, 'tiers'), orderBy('tierNumber'))
  );
  const allGolfers = [];
  tiersSnap.docs.forEach(d => {
    d.data().golfers.forEach(g => allGolfers.push(g));
  });
  console.log(`Roster: ${allGolfers.length} golfers`);

  // Load golfer scores
  const scoresSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'golferScores')
  );
  const scoresMap = new Map();
  scoresSnap.docs.forEach(d => scoresMap.set(d.id, { id: d.id, ...d.data() }));
  console.log(`Loaded ${scoresMap.size} golfer score records from Firestore`);

  // Load entries
  const entriesSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'entries')
  );
  const allEntries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`Entries: ${allEntries.length}`);

  // --- Compute round N standings ---
  // For round 4: use current points directly (tournament should be complete).
  // For rounds 1-3: reconstruct from per-round stroke counts.
  let golferPointsMap; // Map<golferId, points>

  if (round === 4) {
    // Use current points as-is
    golferPointsMap = new Map();
    for (const [id, score] of scoresMap) {
      golferPointsMap.set(id, score.points ?? 0);
    }
    console.log('Round 4: using current Firestore points directly.');
  } else {
    // Reconstruct end-of-round standings from stroke data
    const activeAtRound = []; // golfers who completed this round (have r1..rN data)
    const nonActivePoints = new Map(); // golfers who did not complete this round

    for (const golfer of allGolfers) {
      const score = scoresMap.get(golfer.id);
      if (!score) {
        // No score record at all — treat as withdrawn before tournament
        const pts = calculatePoints(null, 'withdrawn', cutPlayerCount, round);
        nonActivePoints.set(golfer.id, pts);
        continue;
      }

      // Check if this golfer played through the target round
      const hasTargetRound = score.roundScores?.['r' + round] != null;

      if (hasTargetRound) {
        // They played through round N — include in position calculation
        activeAtRound.push({ id: golfer.id, roundScores: score.roundScores });
      } else {
        // Missed cut or withdrew before this round
        // Use their status from Firestore (cut / withdrawn)
        const status = score.status || 'cut';
        const pts = calculatePoints(null, status, cutPlayerCount, round);
        nonActivePoints.set(golfer.id, pts);
      }
    }

    console.log(`Golfers with R${round} data: ${activeAtRound.length}`);
    console.log(`Golfers cut/WD before R${round}: ${nonActivePoints.size}`);

    // Compute position-based points for active golfers
    const positionPoints = computePositionPoints(activeAtRound, round, cutPlayerCount);

    golferPointsMap = new Map([...nonActivePoints, ...positionPoints]);

    // Report computed standings
    const activeWithPts = activeAtRound
      .map(g => ({
        name: scoresMap.get(g.id)?.name || g.id,
        points: positionPoints.get(g.id) ?? '?',
        totalStrokes: [1, 2, 3].slice(0, round).reduce((s, r) => s + (g.roundScores?.['r' + r] ?? 0), 0),
      }))
      .sort((a, b) => a.points - b.points);

    console.log(`\nTop 10 golfers at end of R${round} (by reconstructed position):`);
    activeWithPts.slice(0, 10).forEach((g, i) =>
      console.log(`  ${i + 1}. ${g.name} — ${g.totalStrokes} strokes → ${g.points} pts`)
    );
  }

  // --- Build entry standings ---
  const entryStandings = allEntries.map(entry => {
    const pickIds = [
      entry.picks?.tier1, entry.picks?.tier2, entry.picks?.tier3,
      entry.picks?.tier4, entry.picks?.tier5, entry.picks?.tier6,
    ];
    const golfers = pickIds.map(id => {
      const score = scoresMap.get(id);
      const pts = golferPointsMap.get(id) ?? score?.points ?? 0;
      return {
        id: id || '',
        name: score?.name || allGolfers.find(g => g.id === id)?.name || 'Unknown',
        points: pts,
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

  entryStandings.sort((a, b) => a.totalScore - b.totalScore);
  const top10 = entryStandings.slice(0, 10);

  console.log(`\nTop 10 entries at end of Round ${round}:`);
  top10.forEach((e, i) => {
    console.log(`  ${i + 1}. ${e.entryLabel} — ${e.totalScore} pts`);
    e.golfers.forEach(g => console.log(`       ${g.name}: ${g.points} pts`));
  });

  // --- Write snapshot ---
  await setDoc(snapshotRef, {
    round,
    standings: top10,
    snapshotAt: Timestamp.now(),
  });
  console.log(`\nSaved Round ${round} snapshot to dailyLeaderboards/round${round}`);
}

async function checkSnapshots() {
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournaments = tournamentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find(t => t.status !== 'complete') || tournaments[0];
  if (!tournament) { console.log('No tournament found.'); return; }
  console.log(`Tournament: ${tournament.name}\n`);

  for (let round = 1; round <= 4; round++) {
    const ref = doc(db, 'tournaments', tournament.id, 'dailyLeaderboards', 'round' + round);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      const snapTime = data.snapshotAt?.toDate?.()?.toLocaleString() || '?';
      console.log(`Round ${round}: EXISTS — captured ${snapTime}, ${data.standings?.length ?? 0} entries`);
    } else {
      console.log(`Round ${round}: MISSING`);
    }
  }
}

// --- CLI ---
const args = process.argv.slice(2);
const force = args.includes('--force');
const check = args.includes('--check');

const rounds = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--round' && args[i + 1]) {
    const r = parseInt(args[i + 1]);
    if (r >= 1 && r <= 4) rounds.push(r);
    else console.warn(`Invalid round: ${args[i + 1]}`);
  }
}

async function main() {
  if (check) {
    await checkSnapshots();
    return;
  }
  if (rounds.length === 0) {
    console.log('Usage:');
    console.log('  node scripts/populate-snapshots.js --round 3');
    console.log('  node scripts/populate-snapshots.js --round 2 --round 3');
    console.log('  node scripts/populate-snapshots.js --round 3 --force');
    console.log('  node scripts/populate-snapshots.js --check');
    return;
  }
  for (const round of rounds) {
    await populateSnapshot(round, force);
  }
  console.log('\nDone.');
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('Fatal:', err); process.exit(1); });
