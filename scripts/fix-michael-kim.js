/**
 * One-time fix: manually set Michael Kim's golferScore in Firestore.
 * ESPN is returning stale data for him; this overrides it directly.
 *
 * Usage:
 *   node scripts/fix-michael-kim.js               # dry-run (preview only)
 *   node scripts/fix-michael-kim.js --apply        # write changes to Firestore
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, getDocs, updateDoc,
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

const CORRECT_DATA = {
  position: 48,
  score: '+3',
  today: '+3',
  thru: 'F',
  points: 48,
  status: 'active',
};

const applyChanges = process.argv.includes('--apply');

console.log(`\n=== fix-michael-kim.js ===`);
console.log(`Mode: ${applyChanges ? 'APPLY (writing to Firestore)' : 'DRY RUN (preview only, pass --apply to write)'}`);
console.log(`Target values:`, CORRECT_DATA, '\n');

async function run() {
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournaments = tournamentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find(t => t.status !== 'complete') || tournaments[0];

  if (!tournament) {
    console.error('No tournament found.');
    process.exit(1);
  }

  console.log(`Tournament: "${tournament.name}" (id: ${tournament.id})\n`);

  const scoresSnap = await getDocs(collection(db, 'tournaments', tournament.id, 'golferScores'));

  const matches = scoresSnap.docs.filter(d => {
    const name = (d.data().name || '').toLowerCase();
    return name.includes('michael kim') || name.includes('kim, michael');
  });

  if (matches.length === 0) {
    console.error('ERROR: No golferScore document found for Michael Kim.');
    console.log('\nAll golfer names in Firestore:');
    scoresSnap.docs.forEach(d => console.log(' -', d.data().name, `(id: ${d.id})`));
    process.exit(1);
  }

  for (const match of matches) {
    const current = match.data();
    console.log(`Found: "${current.name}" (doc id: ${match.id})`);
    console.log(`  Current:`, {
      position: current.position,
      score: current.score,
      today: current.today,
      thru: current.thru,
      points: current.points,
      status: current.status,
    });
    console.log(`  → Setting to:`, CORRECT_DATA);

    if (applyChanges) {
      await updateDoc(
        doc(db, 'tournaments', tournament.id, 'golferScores', match.id),
        CORRECT_DATA,
      );
      console.log('  ✓ Written to Firestore');
    }
  }

  console.log('\n=== Done ===');
  if (!applyChanges) {
    console.log('This was a dry run. Run with --apply to write changes to Firestore.');
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
