/**
 * One-time script: flag a specific golfer as withdrawn (WD) in Firestore.
 *
 * Usage:
 *   node scripts/flag-wd.js "Nicolai Hojgaard"
 *
 * What it does:
 *   1. Finds the active tournament
 *   2. Locates the named golfer in the tiers roster
 *   3. Writes/overwrites their golferScore with status:'withdrawn', points:999
 *   4. Creates a withdrawalAlert for all entries that picked them
 *   5. Prints affected participant names
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, setDoc, getDocs, getDoc,
  addDoc, query, orderBy, Timestamp
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
} catch { /* use process.env */ }
const getEnv = (key) => process.env[key] || env[key];

const firebaseConfig = {
  apiKey:            getEnv('VITE_FIREBASE_API_KEY'),
  authDomain:        getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId:         getEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket:     getEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId:             getEnv('VITE_FIREBASE_APP_ID'),
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function normalizeName(name) {
  return name
    .replace(/ø/g, 'o').replace(/Ø/g, 'o')
    .replace(/æ/g, 'ae').replace(/Æ/g, 'ae')
    .replace(/ñ/g, 'n').replace(/Ñ/g, 'n')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findGolferByName(targetName, allGolfers) {
  const norm = normalizeName(targetName);
  return allGolfers.find(g => normalizeName(g.name) === norm) || null;
}

async function main() {
  const targetName = process.argv[2];
  if (!targetName) {
    console.error('Usage: node scripts/flag-wd.js "Golfer Name"');
    process.exit(1);
  }

  // --- Find active tournament ---
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournaments = tournamentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find(t => t.status !== 'complete') || tournaments[0];
  if (!tournament) {
    console.error('No tournament found in Firestore.');
    process.exit(1);
  }
  console.log(`Tournament: ${tournament.name} (${tournament.id})`);
  console.log(`Status: ${tournament.status}, picksLocked: ${tournament.picksLocked}`);

  // --- Load tiers roster ---
  const tiersSnap = await getDocs(
    query(collection(db, 'tournaments', tournament.id, 'tiers'), orderBy('tierNumber'))
  );
  const allGolfers = [];
  const golferToTier = new Map();
  tiersSnap.docs.forEach(d => {
    const tier = d.data();
    tier.golfers.forEach(g => {
      allGolfers.push(g);
      golferToTier.set(g.id, tier.tierNumber);
    });
  });

  // --- Find target golfer ---
  const golfer = findGolferByName(targetName, allGolfers);
  if (!golfer) {
    console.error(`"${targetName}" not found in roster. Available names (normalized):`);
    allGolfers.forEach(g => console.log(`  [${golferToTier.get(g.id)}] ${g.name}  (id: ${g.id})`));
    process.exit(1);
  }
  const tierNumber = golferToTier.get(golfer.id);
  console.log(`\nFound: ${golfer.name} (id: ${golfer.id}) in Tier ${tierNumber}`);

  // --- Check for existing WD score ---
  const existingScoreSnap = await getDoc(
    doc(db, 'tournaments', tournament.id, 'golferScores', golfer.id)
  );
  if (existingScoreSnap.exists() && existingScoreSnap.data().status === 'withdrawn') {
    console.log(`${golfer.name} is ALREADY flagged as withdrawn.`);
  } else {
    // Write WD score
    await setDoc(doc(db, 'tournaments', tournament.id, 'golferScores', golfer.id), {
      name: golfer.name,
      position: null,
      score: '--',
      today: '--',
      thru: '--',
      status: 'withdrawn',
      points: 999,
      roundScores: { r1: null, r2: null, r3: null, r4: null },
      teeTime: null,
      lastUpdated: Timestamp.now(),
      source: 'manual',
    });
    console.log(`✓ Flagged ${golfer.name} as WITHDRAWN in golferScores.`);
  }

  // --- Load entries ---
  const entriesSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'entries')
  );
  const allEntries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tierKey = `tier${tierNumber}`;
  const affectedEntries = allEntries.filter(e => e.picks?.[tierKey] === golfer.id);

  console.log(`\nEntries with ${golfer.name} in Tier ${tierNumber}: ${affectedEntries.length}`);
  affectedEntries.forEach(e => {
    console.log(`  - ${e.participantName || e.entryLabel} (entryId: ${e.id})`);
  });

  if (affectedEntries.length === 0) {
    console.log('No affected entries — no alert needed.');
    process.exit(0);
  }

  // --- Check for existing alert ---
  const alertsSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'withdrawalAlerts')
  );
  const existingAlert = alertsSnap.docs.find(d => d.data().golferId === golfer.id);
  if (existingAlert) {
    console.log(`\nWithdrawal alert ALREADY EXISTS for ${golfer.name} (alertId: ${existingAlert.id})`);
    console.log(`  Status: ${existingAlert.data().status}`);
    console.log(`  Affected entries: ${existingAlert.data().affectedEntryIds.length}`);
  } else {
    // Swap deadline = firstTeeTime
    const deadline = tournament.firstTeeTime?.toDate?.()
      ? tournament.firstTeeTime.toDate()
      : new Date(tournament.firstTeeTime);

    const alertData = {
      golferId: golfer.id,
      golferName: golfer.name,
      tierNumber,
      affectedEntryIds: affectedEntries.map(e => e.id),
      swapDeadline: Timestamp.fromDate(deadline),
      status: 'active',
      createdAt: Timestamp.now(),
    };
    const alertRef = await addDoc(
      collection(db, 'tournaments', tournament.id, 'withdrawalAlerts'),
      alertData
    );
    console.log(`\n✓ Withdrawal alert created (id: ${alertRef.id})`);
    console.log(`  Deadline: ${deadline.toLocaleString()}`);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Golfer: ${golfer.name} (Tier ${tierNumber}) — WITHDRAWN`);
  console.log(`Affected participants (${affectedEntries.length}):`);
  affectedEntries.forEach((e, i) => {
    console.log(`  ${i + 1}. ${e.participantName || e.entryLabel} (entry: ${e.entryLabel || e.id})`);
  });

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
