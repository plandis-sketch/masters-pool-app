/**
 * One-time script: Apply missed-cut scores for Round 2 cut.
 *
 * Run when the automatic cut detection failed to fire (because espnRound was
 * still 2 when the cut was made, so the espnRound >= 3 guard never triggered).
 *
 * What this does:
 *   1. Sets tournament.cutPlayerCount = 54 (locks it permanently)
 *   2. Sets points = 55 for every golfer already marked cut or withdrawn
 *   3. Sets status = 'cut', points = 55 for any 'active' golfer whose
 *      tournament score is +5 or worse (missed the cut line of +4)
 *   4. Recalculates all entry totals
 *   5. Rewrites the Round 2 daily leaderboard snapshot with corrected scores
 *
 * Usage:
 *   node scripts/apply-cut.js
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, setDoc, getDocs, getDoc, updateDoc,
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
} catch { /* fall back to process.env */ }
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

// Cut details for the 2026 Masters (Round 2 cut)
const CUT_PLAYER_COUNT = 54;   // 54 golfers made the cut
const MISSED_CUT_SCORE = 55;   // 54 + 1
const CUT_LINE_STROKES = 4;    // +4 made the cut; +5 or worse = missed

/**
 * Parse a score-to-par string into an integer.
 * "+5" → 5, "-3" → -3, "E" → 0, "--" → null
 */
function parseScoreToPar(scoreStr) {
  if (!scoreStr || scoreStr === '--' || scoreStr === '') return null;
  const s = scoreStr.trim().toUpperCase();
  if (s === 'E') return 0;
  const n = parseInt(s.replace('+', ''));
  return isNaN(n) ? null : n;
}

async function applyCut() {
  console.log('=== apply-cut.js: Applying Round 2 cut scores ===\n');

  // Load active tournament
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournaments = tournamentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find(t => t.status !== 'complete') || tournaments[0];

  if (!tournament) {
    console.error('No tournament found in Firestore.');
    process.exit(1);
  }
  console.log(`Tournament: ${tournament.name} (${tournament.id})`);
  console.log(`Current cutPlayerCount in Firestore: ${tournament.cutPlayerCount ?? 'NOT SET'}\n`);

  // Step 1: Lock cutPlayerCount
  if (tournament.cutPlayerCount && tournament.cutPlayerCount !== CUT_PLAYER_COUNT) {
    console.warn(`WARNING: cutPlayerCount is already ${tournament.cutPlayerCount}, expected ${CUT_PLAYER_COUNT}.`);
    console.warn('Proceeding anyway — the value in this script takes precedence.\n');
  }
  if (!tournament.cutPlayerCount) {
    await updateDoc(doc(db, 'tournaments', tournament.id), {
      cutPlayerCount: CUT_PLAYER_COUNT,
    });
    console.log(`✓ Set tournament.cutPlayerCount = ${CUT_PLAYER_COUNT}`);
  } else if (tournament.cutPlayerCount !== CUT_PLAYER_COUNT) {
    await updateDoc(doc(db, 'tournaments', tournament.id), {
      cutPlayerCount: CUT_PLAYER_COUNT,
    });
    console.log(`✓ Updated tournament.cutPlayerCount from ${tournament.cutPlayerCount} → ${CUT_PLAYER_COUNT}`);
  } else {
    console.log(`  cutPlayerCount already = ${CUT_PLAYER_COUNT}, no change needed.`);
  }

  // Load all golfer scores
  const scoresSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'golferScores')
  );
  const scoreMap = new Map();
  scoresSnap.docs.forEach(d => scoreMap.set(d.id, { id: d.id, ...d.data() }));
  console.log(`\nLoaded ${scoreMap.size} golfer scores from Firestore.\n`);

  // Step 2 & 3: Apply MISSED_CUT_SCORE to all cut/withdrawn golfers,
  //             AND to any 'active' golfer whose score is above the cut line.
  let fixedCount = 0;
  const fixedNames = [];

  for (const [golferId, data] of scoreMap) {
    let needsFix = false;
    let reason = '';

    if (data.status === 'cut' || data.status === 'withdrawn') {
      if (data.points !== MISSED_CUT_SCORE) {
        needsFix = true;
        reason = `status=${data.status}, points was ${data.points} → ${MISSED_CUT_SCORE}`;
      }
    } else if (data.status === 'active') {
      const scoreToPar = parseScoreToPar(data.score);
      if (scoreToPar !== null && scoreToPar > CUT_LINE_STROKES) {
        needsFix = true;
        reason = `status=active but score=${data.score} (above cut line +${CUT_LINE_STROKES}) → marking cut`;
      }
    }

    if (!needsFix) continue;

    const newStatus = (data.status === 'withdrawn') ? 'withdrawn' : 'cut';
    await updateDoc(doc(db, 'tournaments', tournament.id, 'golferScores', golferId), {
      status: newStatus,
      points: MISSED_CUT_SCORE,
      lastUpdated: Timestamp.now(),
    });

    // Update in-memory map for entry total recalculation
    scoreMap.set(golferId, { ...data, status: newStatus, points: MISSED_CUT_SCORE });

    console.log(`  ✓ ${data.name}: ${reason}`);
    fixedNames.push(data.name);
    fixedCount++;
  }

  if (fixedCount === 0) {
    console.log('  No golfer score corrections needed.');
  } else {
    console.log(`\nFixed ${fixedCount} golfer(s).`);
  }

  // Verify the named golfers from the issue are correctly set
  const verifyNames = [
    'Bryson DeChambeau', 'Akshay Bhatia', 'Danny Willett',
    'Bubba Watson', 'Zach Johnson', 'J.J. Spaun', 'Robert MacIntyre',
  ];
  console.log('\n--- Verification of named missed-cut golfers ---');
  for (const [, data] of scoreMap) {
    if (verifyNames.some(n => data.name?.toLowerCase().includes(n.split(' ')[1]?.toLowerCase() || n.toLowerCase()))) {
      const icon = data.points === MISSED_CUT_SCORE ? '✓' : '✗';
      console.log(`  ${icon} ${data.name}: status=${data.status}, points=${data.points}`);
    }
  }

  // Step 4: Recalculate entry totals
  console.log('\n--- Recalculating entry totals ---');
  const entriesSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'entries')
  );
  const allEntries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  let entryUpdates = 0;
  for (const entry of allEntries) {
    const picks = [
      entry.picks?.tier1, entry.picks?.tier2, entry.picks?.tier3,
      entry.picks?.tier4, entry.picks?.tier5, entry.picks?.tier6,
    ];
    const newTotal = picks.reduce((sum, id) => {
      const s = scoreMap.get(id);
      return sum + (s?.points ?? 0);
    }, 0);

    if (newTotal !== entry.totalScore) {
      await updateDoc(doc(db, 'tournaments', tournament.id, 'entries', entry.id), {
        totalScore: newTotal,
      });
      const label = entry.entryLabel || entry.participantName;
      console.log(`  ✓ ${label}: ${entry.totalScore} → ${newTotal}`);
      entryUpdates++;
    }
  }

  if (entryUpdates === 0) {
    console.log('  All entry totals already correct — no changes.');
  } else {
    console.log(`\nUpdated ${entryUpdates} entry total(s).`);
  }

  // Step 5: Rewrite Round 2 daily leaderboard snapshot with corrected scores
  console.log('\n--- Updating Round 2 daily leaderboard snapshot ---');

  // Load tiers for golfer name lookups
  const tiersSnap = await getDocs(
    query(collection(db, 'tournaments', tournament.id, 'tiers'), orderBy('tierNumber'))
  );
  const allGolfers = [];
  tiersSnap.docs.forEach(d => d.data().golfers.forEach(g => allGolfers.push(g)));

  const entryStandings = allEntries.map(entry => {
    const pickIds = [
      entry.picks?.tier1, entry.picks?.tier2, entry.picks?.tier3,
      entry.picks?.tier4, entry.picks?.tier5, entry.picks?.tier6,
    ];
    const golfers = pickIds.map(id => {
      const score = scoreMap.get(id);
      return {
        id,
        name: score?.name || allGolfers.find(g => g.id === id)?.name || 'Unknown',
        points: score?.points ?? 0,
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

  const snapshotRef = doc(db, 'tournaments', tournament.id, 'dailyLeaderboards', 'round2');
  // Always overwrite Round 2 snapshot — it captured wrong scores before the cut was applied
  await setDoc(snapshotRef, {
    round: 2,
    standings: top10,
    snapshotAt: Timestamp.now(),
  });
  console.log(`  ✓ Round 2 snapshot saved (top ${top10.length} entries, corrected cut scores)`);
  console.log('  Top 5:');
  top10.slice(0, 5).forEach((e, i) => {
    console.log(`    ${i + 1}. ${e.entryLabel || e.participantName}: ${e.totalScore} pts`);
  });

  console.log('\n=== Done! Cut applied successfully. ===');
  console.log(`  cutPlayerCount = ${CUT_PLAYER_COUNT}`);
  console.log(`  Missed cut score = ${MISSED_CUT_SCORE}`);
  console.log(`  Golfer scores corrected: ${fixedCount}`);
  console.log(`  Entry totals updated: ${entryUpdates}`);
}

applyCut()
  .then(() => process.exit(0))
  .catch(err => { console.error('Fatal:', err); process.exit(1); });
