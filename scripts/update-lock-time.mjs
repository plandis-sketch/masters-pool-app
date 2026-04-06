/**
 * One-time script: Update firstTeeTime to 7:30 AM ET on the active tournament.
 * Preserves all existing entries, tiers, and golfer scores.
 *
 * Run with: node scripts/update-lock-time.mjs
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, updateDoc, doc, Timestamp } from 'firebase/firestore';
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
  // Fall back to process.env (CI)
}
const getEnv = (key) => process.env[key] || env[key];

const app = initializeApp({
  apiKey: getEnv('VITE_FIREBASE_API_KEY'),
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getEnv('VITE_FIREBASE_APP_ID'),
});

const db = getFirestore(app);

const NEW_LOCK_TIME = new Date('2026-04-09T07:30:00-04:00'); // 7:30 AM ET

async function main() {
  const snap = await getDocs(collection(db, 'tournaments'));
  const active = snap.docs.find(d => d.data().status !== 'complete') || snap.docs[0];

  if (!active) {
    console.error('No tournament found.');
    process.exit(1);
  }

  const { name, firstTeeTime } = active.data();
  const current = firstTeeTime?.toDate?.();
  console.log(`Tournament: "${name}" (${active.id})`);
  console.log(`Current firstTeeTime: ${current?.toLocaleString() ?? 'not set'}`);
  console.log(`New firstTeeTime:     ${NEW_LOCK_TIME.toLocaleString()} (7:30 AM ET)`);

  await updateDoc(doc(db, 'tournaments', active.id), {
    firstTeeTime: Timestamp.fromDate(NEW_LOCK_TIME),
  });

  console.log('\nDone. firstTeeTime updated to 7:30 AM ET. All entries preserved.');
  process.exit(0);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
