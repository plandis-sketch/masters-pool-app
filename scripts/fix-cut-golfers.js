/**
 * One-time fix: Force status='cut' and points=55 for Bubba Watson,
 * Zach Johnson, and Danny Willett — ESPN is not marking them correctly.
 *
 * Usage:
 *   node scripts/fix-cut-golfers.js
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, getDocs, updateDoc, Timestamp
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

// Golfers to force-cut (case-insensitive partial match against stored name)
const TARGET_GOLFERS = ['bubba watson', 'zach johnson', 'danny willett'];
const FORCED_STATUS = 'cut';
const FORCED_POINTS = 55;

function matchesTarget(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return TARGET_GOLFERS.some(t => lower.includes(t));
}

async function fixCutGolfers() {
  console.log('=== fix-cut-golfers.js: Forcing cut status for 3 golfers ===\n');

  // Find active tournament
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournament = tournamentsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .find(t => t.status !== 'complete') || tournamentsSnap.docs[0]?.data();

  if (!tournament) {
    console.error('No tournament found in Firestore.');
    process.exit(1);
  }
  console.log(`Tournament: ${tournament.name} (${tournament.id})\n`);

  // Load all golfer scores
  const scoresSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'golferScores')
  );
  const scoreMap = new Map();
  scoresSnap.docs.forEach(d => scoreMap.set(d.id, { id: d.id, ...d.data() }));
  console.log(`Loaded ${scoreMap.size} golfer scores.\n`);

  // Apply forced cut to matching golfers
  const updatedIds = new Set();
  for (const [golferId, data] of scoreMap) {
    if (!matchesTarget(data.name)) continue;

    const alreadyCorrect = data.status === FORCED_STATUS && data.points === FORCED_POINTS;
    console.log(
      `${data.name}: status=${data.status}, points=${data.points}` +
      (alreadyCorrect ? ' — already correct, updating anyway to be safe' : ' — FIXING')
    );

    await updateDoc(doc(db, 'tournaments', tournament.id, 'golferScores', golferId), {
      status: FORCED_STATUS,
      points: FORCED_POINTS,
      lastUpdated: Timestamp.now(),
    });

    // Update in-memory map for entry recalc
    scoreMap.set(golferId, { ...data, status: FORCED_STATUS, points: FORCED_POINTS });
    updatedIds.add(golferId);
  }

  if (updatedIds.size === 0) {
    console.error('ERROR: None of the target golfers were found in golferScores. Check stored names.');
    process.exit(1);
  }

  const missing = TARGET_GOLFERS.filter(t =>
    !Array.from(scoreMap.values()).some(d => d.name?.toLowerCase().includes(t))
  );
  if (missing.length > 0) {
    console.warn(`\nWARNING: Could not find: ${missing.join(', ')}`);
  }

  console.log(`\nUpdated ${updatedIds.size} golfer(s).\n`);

  // Recalculate entry totals only for entries that picked one of these golfers
  console.log('--- Recalculating affected entry totals ---');
  const entriesSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'entries')
  );
  const allEntries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  let entryUpdates = 0;
  for (const entry of allEntries) {
    const pickIds = [
      entry.picks?.tier1, entry.picks?.tier2, entry.picks?.tier3,
      entry.picks?.tier4, entry.picks?.tier5, entry.picks?.tier6,
    ];

    // Only recalculate if this entry picked one of the changed golfers
    if (!pickIds.some(id => updatedIds.has(id))) continue;

    const newTotal = pickIds.reduce((sum, id) => {
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
    console.log('  All affected entry totals already correct — no changes needed.');
  } else {
    console.log(`\nUpdated ${entryUpdates} entry total(s).`);
  }

  console.log('\n=== Done! ===');
  console.log(`  Golfers force-cut: ${updatedIds.size}`);
  console.log(`  Entry totals updated: ${entryUpdates}`);
}

fixCutGolfers()
  .then(() => process.exit(0))
  .catch(err => { console.error('Fatal:', err); process.exit(1); });
