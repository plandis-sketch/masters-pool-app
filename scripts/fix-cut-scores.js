/**
 * One-time fix: correct cutPlayerCount from 91 → 54,
 * set all missed-cut golfer points to 55, and recalculate entry totals.
 *
 * Run: node scripts/fix-cut-scores.js
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

const CORRECT_CUT_PLAYER_COUNT = 54;
const CORRECT_MISSED_CUT_SCORE = 55; // 54 + 1

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function fixCutScores() {
  // 1. Find the active tournament
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournaments = tournamentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find(t => t.status !== 'complete') || tournaments[0];

  if (!tournament) {
    console.error('No tournament found.');
    process.exit(1);
  }

  console.log(`Tournament: ${tournament.name} (${tournament.id})`);
  console.log(`Current cutPlayerCount in Firestore: ${tournament.cutPlayerCount}`);
  console.log(`Correcting to: ${CORRECT_CUT_PLAYER_COUNT}`);

  // 2. Fix cutPlayerCount on the tournament document
  await updateDoc(doc(db, 'tournaments', tournament.id), {
    cutPlayerCount: CORRECT_CUT_PLAYER_COUNT,
  });
  console.log(`✓ Set tournament.cutPlayerCount = ${CORRECT_CUT_PLAYER_COUNT}`);

  // 3. Load all golfer scores and fix missed-cut players
  const scoresSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'golferScores')
  );

  const scoreMap = new Map();
  let fixedCount = 0;

  for (const scoreDoc of scoresSnap.docs) {
    const data = scoreDoc.data();
    scoreMap.set(scoreDoc.id, data);

    if (data.status === 'cut' || data.status === 'withdrawn') {
      const oldPoints = data.points;
      if (oldPoints !== CORRECT_MISSED_CUT_SCORE) {
        await updateDoc(
          doc(db, 'tournaments', tournament.id, 'golferScores', scoreDoc.id),
          { points: CORRECT_MISSED_CUT_SCORE }
        );
        scoreMap.set(scoreDoc.id, { ...data, points: CORRECT_MISSED_CUT_SCORE });
        console.log(`  Fixed: ${data.name} (${data.status}) ${oldPoints} → ${CORRECT_MISSED_CUT_SCORE} pts`);
        fixedCount++;
      } else {
        console.log(`  OK: ${data.name} (${data.status}) already at ${CORRECT_MISSED_CUT_SCORE} pts`);
      }
    }
  }

  console.log(`\n✓ Fixed ${fixedCount} golfer scores.`);

  // 4. Load all golfers to resolve names
  const tiersSnap = await getDocs(
    query(collection(db, 'tournaments', tournament.id, 'tiers'), orderBy('tierNumber'))
  );
  const allGolfers = [];
  tiersSnap.docs.forEach(d => d.data().golfers.forEach(g => allGolfers.push(g)));

  // 5. Recalculate all entry totals
  const entriesSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'entries')
  );
  const entries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  let entryUpdates = 0;
  for (const entry of entries) {
    const picks = [
      entry.picks?.tier1, entry.picks?.tier2, entry.picks?.tier3,
      entry.picks?.tier4, entry.picks?.tier5, entry.picks?.tier6,
    ];
    const newTotal = picks.reduce((sum, id) => {
      const score = scoreMap.get(id);
      return sum + (score?.points ?? 0);
    }, 0);

    if (newTotal !== entry.totalScore) {
      await updateDoc(
        doc(db, 'tournaments', tournament.id, 'entries', entry.id),
        { totalScore: newTotal }
      );
      console.log(`  Entry ${entry.entryLabel || entry.participantName}: ${entry.totalScore} → ${newTotal}`);
      entryUpdates++;
    }
  }
  console.log(`\n✓ Updated ${entryUpdates} entry totals.`);

  // 6. Fix the Round 2 daily leaderboard snapshot if it was saved with wrong scores
  const r2Ref = doc(db, 'tournaments', tournament.id, 'dailyLeaderboards', 'round2');
  const r2Snap = await getDoc(r2Ref);
  if (r2Snap.exists()) {
    const r2Data = r2Snap.data();
    const fixedStandings = r2Data.standings.map(standing => {
      const fixedGolfers = standing.golfers.map(g => {
        const current = scoreMap.get(g.id);
        if (current && (current.status === 'cut' || current.status === 'withdrawn')) {
          return { ...g, points: CORRECT_MISSED_CUT_SCORE };
        }
        return g;
      });
      const fixedTotal = fixedGolfers.reduce((sum, g) => sum + g.points, 0);
      return { ...standing, golfers: fixedGolfers, totalScore: fixedTotal };
    });
    fixedStandings.sort((a, b) => a.totalScore - b.totalScore);
    await setDoc(r2Ref, {
      ...r2Data,
      standings: fixedStandings,
      snapshotAt: Timestamp.now(),
    });
    console.log('✓ Fixed Round 2 daily leaderboard snapshot.');
  } else {
    console.log('No Round 2 daily leaderboard snapshot found — nothing to fix there.');
  }

  console.log('\nAll done. Missed cut score is now 55 for all affected golfers.');
}

fixCutScores()
  .then(() => process.exit(0))
  .catch(err => { console.error('Fatal:', err); process.exit(1); });
