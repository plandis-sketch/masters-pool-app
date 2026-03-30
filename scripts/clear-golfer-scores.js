/**
 * Clears all golferScores documents from the active (non-complete) tournament.
 * Run this to wipe stale Houston Open data before the Valero Texas Open begins.
 *
 * Usage: node scripts/clear-golfer-scores.js
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, deleteDoc, doc, query, orderBy
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
  // fall back to process.env
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

async function clearScores() {
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournaments = tournamentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find(t => t.status !== 'complete') || tournaments[0];

  if (!tournament) {
    console.log('No tournament found.');
    process.exit(1);
  }

  console.log(`Tournament: ${tournament.name} (${tournament.id})`);

  const scoresSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'golferScores')
  );

  if (scoresSnap.empty) {
    console.log('No golferScores documents found — nothing to clear.');
    process.exit(0);
  }

  console.log(`Deleting ${scoresSnap.docs.length} golferScores documents...`);
  for (const d of scoresSnap.docs) {
    await deleteDoc(doc(db, 'tournaments', tournament.id, 'golferScores', d.id));
  }
  console.log('Done. All golferScores cleared.');
}

clearScores().catch(err => {
  console.error(err);
  process.exit(1);
});
