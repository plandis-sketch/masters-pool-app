/**
 * One-time fix: correct the missed-cut score from 73 → 71 across all Firestore data.
 *
 * Background: the scraper locked cutPlayerCount=72 in Firestore (it counted active
 * competitors at the moment of locking). ESPN's actual cutPlayerCount is 70.
 * That caused missed-cut golfers to be scored 73 pts instead of the correct 71.
 *
 * This script:
 *   1. Updates tournament.cutPlayerCount from 72 → 70
 *   2. Updates all golferScore documents where status=cut/withdrawn from points=73 → 71
 *   3. Recalculates and updates totalScore in every daily leaderboard snapshot
 *      where any golfer's stored points need correction
 *
 * Usage:
 *   node scripts/fix-cut-score.js               # dry-run (preview only)
 *   node scripts/fix-cut-score.js --apply        # write changes to Firestore
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, getDocs, updateDoc, setDoc,
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
  // No .env file — fall back to process.env
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

const WRONG_CUT_COUNT = 72;   // what the scraper locked in Firestore
const CORRECT_CUT_COUNT = 70; // ESPN's actual count of golfers who made the cut
const WRONG_POINTS = WRONG_CUT_COUNT + 1;   // 73
const CORRECT_POINTS = CORRECT_CUT_COUNT + 1; // 71

const applyChanges = process.argv.includes('--apply');

console.log(`\n=== fix-cut-score.js ===`);
console.log(`Mode: ${applyChanges ? 'APPLY (writing to Firestore)' : 'DRY RUN (preview only, pass --apply to write)'}`);
console.log(`Correcting cutPlayerCount: ${WRONG_CUT_COUNT} → ${CORRECT_CUT_COUNT}`);
console.log(`Correcting missed-cut points: ${WRONG_POINTS} → ${CORRECT_POINTS}\n`);

async function run() {
  // --- 1. Find the active tournament ---
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournaments = tournamentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find(t => t.status !== 'complete') || tournaments[0];

  if (!tournament) {
    console.error('No tournament found.');
    process.exit(1);
  }

  console.log(`Tournament: "${tournament.name}" (id: ${tournament.id})`);
  console.log(`Current cutPlayerCount in Firestore: ${tournament.cutPlayerCount}`);

  if (tournament.cutPlayerCount !== WRONG_CUT_COUNT) {
    console.warn(`\nWARNING: tournament.cutPlayerCount is ${tournament.cutPlayerCount}, not ${WRONG_CUT_COUNT}.`);
    console.warn('If the Firestore value has already been corrected, this script may not be needed.');
    console.warn('Proceeding anyway to fix any golfer scores/snapshots with wrong points...\n');
  }

  // --- 2. Fix tournament.cutPlayerCount ---
  if (tournament.cutPlayerCount === WRONG_CUT_COUNT) {
    console.log(`[tournament] cutPlayerCount: ${WRONG_CUT_COUNT} → ${CORRECT_CUT_COUNT}`);
    if (applyChanges) {
      await updateDoc(doc(db, 'tournaments', tournament.id), { cutPlayerCount: CORRECT_CUT_COUNT });
      console.log('  ✓ Written');
    }
  } else {
    console.log(`[tournament] cutPlayerCount is already ${tournament.cutPlayerCount} — skipping`);
  }

  // --- 3. Fix golferScore documents ---
  console.log('\n--- Golfer Scores ---');
  const scoresSnap = await getDocs(collection(db, 'tournaments', tournament.id, 'golferScores'));
  let golferFixCount = 0;
  for (const scoreDoc of scoresSnap.docs) {
    const data = scoreDoc.data();
    const isMissedCut = data.status === 'cut' || data.status === 'withdrawn';
    if (isMissedCut && data.points === WRONG_POINTS) {
      console.log(`  [golfer] ${data.name} (${data.status}): points ${WRONG_POINTS} → ${CORRECT_POINTS}`);
      if (applyChanges) {
        await updateDoc(doc(db, 'tournaments', tournament.id, 'golferScores', scoreDoc.id), {
          points: CORRECT_POINTS,
        });
      }
      golferFixCount++;
    }
  }
  console.log(`Total golfer score fixes: ${golferFixCount}`);

  // --- 4. Fix daily leaderboard snapshots ---
  console.log('\n--- Daily Leaderboard Snapshots ---');
  const snapshotsSnap = await getDocs(collection(db, 'tournaments', tournament.id, 'dailyLeaderboards'));
  let snapshotFixCount = 0;

  for (const snapDoc of snapshotsSnap.docs) {
    const data = snapDoc.data();
    let snapshotChanged = false;

    const fixedStandings = data.standings.map(entry => {
      let entryChanged = false;
      const fixedGolfers = entry.golfers.map(g => {
        const isMissedCut = g.status === 'cut' || g.status === 'withdrawn';
        if (isMissedCut && g.points === WRONG_POINTS) {
          entryChanged = true;
          snapshotChanged = true;
          return { ...g, points: CORRECT_POINTS };
        }
        return g;
      });

      if (!entryChanged) return entry;

      const oldTotal = entry.totalScore;
      // Recalculate: each corrected golfer saves 2 points
      const correctedCount = entry.golfers.filter(
        g => (g.status === 'cut' || g.status === 'withdrawn') && g.points === WRONG_POINTS
      ).length;
      const newTotal = oldTotal - correctedCount * (WRONG_POINTS - CORRECT_POINTS);

      console.log(`  [snapshot round ${data.round}] ${entry.entryLabel}: totalScore ${oldTotal} → ${newTotal} (${correctedCount} missed-cut golfer(s) fixed)`);
      return { ...entry, golfers: fixedGolfers, totalScore: newTotal };
    });

    if (snapshotChanged) {
      snapshotFixCount++;
      if (applyChanges) {
        await setDoc(
          doc(db, 'tournaments', tournament.id, 'dailyLeaderboards', snapDoc.id),
          { ...data, standings: fixedStandings }
        );
        console.log(`  ✓ Round ${data.round} snapshot written`);
      }
    } else {
      console.log(`  Round ${data.round}: no corrections needed`);
    }
  }
  console.log(`Total snapshot fixes: ${snapshotFixCount}`);

  console.log('\n=== Done ===');
  if (!applyChanges) {
    console.log('\nThis was a dry run. Run with --apply to write changes to Firestore.');
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
