/**
 * Setup script: 2026 Masters Tournament
 *
 * STEP 1: Deletes ALL existing tournament data (keeps users + messages)
 * STEP 2: Creates 2026 Masters Tournament document
 * STEP 4: Loads 6 tiers × 10 golfers (DraftKings odds-based)
 * STEP 5: Pre-populates golferScores for 30 non-tier full-field golfers
 *
 * Run with: node scripts/setup-masters-2026.mjs
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, setDoc, getDocs, deleteDoc, Timestamp,
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
  // Fall back to process.env (CI)
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

// ── Tournament config ──
const TOURNAMENT = {
  name: '2026 Masters Tournament',
  dates: {
    start: Timestamp.fromDate(new Date('2026-04-09T08:00:00-04:00')),
    end:   Timestamp.fromDate(new Date('2026-04-12T19:00:00-04:00')),
  },
  // Picks lock at 7:30 AM ET Thursday April 9 — earlier than first tee time
  firstTeeTime: Timestamp.fromDate(new Date('2026-04-09T07:30:00-04:00')),
  cutLine: null,
  cutPlayerCount: null,      // Top 50 + ties — set dynamically by scraper
  picksLocked: false,
  currentRound: 1,
  prizeStructure: [],
  paymentMethods: {
    venmo:   'Phil-Overton',
    cashApp: 'PhilipOverton',
    payPal:  'pove1@juno.com',
    zelle:   'pove1@juno.com',
  },
  entryFee: 10,
  status: 'picks_open',
};

// ── 6 Tiers × 10 golfers — ordered by DraftKings odds to win ──
const TIERS = [
  {
    tierNumber: 1,
    label: 'Tier 1 — Favorites',
    golfers: [
      'Scottie Scheffler',
      'Jon Rahm',
      'Rory McIlroy',
      'Bryson DeChambeau',
      'Ludvig Aberg',
      'Xander Schauffele',
      'Cameron Young',
      'Tommy Fleetwood',
      'Matt Fitzpatrick',
      'Collin Morikawa',
    ],
  },
  {
    tierNumber: 2,
    label: 'Tier 2 — Contenders',
    golfers: [
      'Justin Rose',
      'Jordan Spieth',
      'Brooks Koepka',
      'Hideki Matsuyama',
      'Robert MacIntyre',
      'Russell Henley',
      'Chris Gotterup',
      'Patrick Reed',
      'Viktor Hovland',
      'Si Woo Kim',
    ],
  },
  {
    tierNumber: 3,
    label: 'Tier 3 — Solid Picks',
    golfers: [
      'Min Woo Lee',
      'Justin Thomas',
      'Patrick Cantlay',
      'Adam Scott',
      'Akshay Bhatia',
      'Sepp Straka',
      'Jason Day',
      'Jake Knapp',
      'Tyrrell Hatton',
      'Shane Lowry',
    ],
  },
  {
    tierNumber: 4,
    label: 'Tier 4 — Mid-Range',
    golfers: [
      'Sam Burns',
      'Corey Conners',
      'Nicolai Hojgaard',
      'Kurt Kitayama',
      'J.J. Spaun',
      'Jacob Bridgeman',
      'Maverick McNealy',
      'Cameron Smith',
      'Harris English',
      'Gary Woodland',
    ],
  },
  {
    tierNumber: 5,
    label: 'Tier 5 — Sleepers',
    golfers: [
      'Ben Griffin',
      'Daniel Berger',
      'Max Homa',
      'Sungjae Im',
      'Rasmus Hojgaard',
      'Keegan Bradley',
      'Harry Hall',
      'Marco Penge',
      'Alex Noren',
      'Ryan Gerard',
    ],
  },
  {
    tierNumber: 6,
    label: 'Tier 6 — Long Shots',
    golfers: [
      'Nick Taylor',
      'Aaron Rai',
      'Brian Harman',
      'Sam Stevens',
      'Sergio Garcia',
      'Ryan Fox',
      'Wyndham Clark',
      'Max Greyserman',
      'Dustin Johnson',
      'Casey Jarvis',
    ],
  },
];

// ── Step 5: Full-field golfers NOT in any tier ──
// These appear on the Golfer Leaderboard for informational purposes.
// Pool scoring only applies to the 60 tier golfers above.
const FULL_FIELD_EXTRAS = [
  'Carlos Ortiz',
  'Haotong Li',
  'Tom McKibbin',
  'Nico Echavarria',
  'Kristoffer Reitan',
  'Rasmus Neergaard-Petersen',
  'John Keefer',
  'Michael Kim',
  'Andrew Novak',
  'Aldrich Potgieter',
  'Michael Brennan',
  'Sami Valimaki',
  'Davis Riley',
  'Charl Schwartzel',
  'Bubba Watson',
  'Zach Johnson',
  'Brian Campbell',
  'Ethan Fang',
  'Danny Willett',
  'Pongsapak Laopakdee',
  'Vijay Singh',
  'Mason Howell',
  'Mateo Pulcini',
  'Jackson Herrington',
  'Angel Cabrera',
  'Naoyuki Kataoka',
  'Brandon Holtz',
  'Mike Weir',
  'Fred Couples',
  'Jose Maria Olazabal',
];

async function deleteSubcollection(tournamentId, subcollection) {
  const snap = await getDocs(collection(db, 'tournaments', tournamentId, subcollection));
  for (const d of snap.docs) {
    await deleteDoc(doc(db, 'tournaments', tournamentId, subcollection, d.id));
  }
  return snap.docs.length;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   2026 Masters Tournament — Full Reset + Setup   ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ── STEP 1: Delete all existing tournament data ──
  console.log('STEP 1: Clearing all existing tournament data...');
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));

  for (const d of tournamentsSnap.docs) {
    const tName = d.data().name || d.id;
    console.log(`  Deleting tournament: "${tName}"`);

    const subcollections = ['tiers', 'entries', 'golferScores', 'dailyLeaderboards', 'withdrawalAlerts'];
    for (const sub of subcollections) {
      const count = await deleteSubcollection(d.id, sub);
      if (count > 0) console.log(`    └─ Deleted ${count} ${sub} document(s)`);
    }

    await deleteDoc(doc(db, 'tournaments', d.id));
    console.log(`    └─ Tournament document deleted ✓`);
  }

  if (tournamentsSnap.empty) {
    console.log('  (No existing tournaments found — starting fresh)');
  }

  // ── STEP 2: Create 2026 Masters Tournament ──
  console.log('\nSTEP 2: Creating 2026 Masters Tournament...');
  const tournamentRef = doc(collection(db, 'tournaments'));
  await setDoc(tournamentRef, TOURNAMENT);
  const tournamentId = tournamentRef.id;
  console.log(`  Tournament created: ${tournamentId}`);
  console.log(`  Name:   ${TOURNAMENT.name}`);
  console.log(`  Start:  ${new Date('2026-04-09T08:00:00-04:00').toLocaleString()}`);
  console.log(`  Status: picks_open`);

  // ── STEP 4: Create 6 tiers with 60 golfers ──
  console.log('\nSTEP 4: Loading 6 tiers...');
  for (const tier of TIERS) {
    const golfers = tier.golfers.map((name, idx) => ({
      id: `t${tier.tierNumber}_g${idx + 1}`,
      name,
      ranking: (tier.tierNumber - 1) * 10 + idx + 1,
    }));

    await setDoc(
      doc(db, 'tournaments', tournamentId, 'tiers', `tier${tier.tierNumber}`),
      { tierNumber: tier.tierNumber, label: tier.label, golfers }
    );

    console.log(`  Tier ${tier.tierNumber} (${tier.label.split('—')[1].trim()}): ${tier.golfers.join(', ')}`);
  }

  // ── STEP 5: Pre-populate golferScores for non-tier full-field golfers ──
  console.log('\nSTEP 5: Pre-populating full-field golferScores...');
  for (let i = 0; i < FULL_FIELD_EXTRAS.length; i++) {
    const name = FULL_FIELD_EXTRAS[i];
    const id = `field_${i}`;
    await setDoc(doc(db, 'tournaments', tournamentId, 'golferScores', id), {
      id,
      name,
      position: null,
      score: '--',
      today: '--',
      thru: '--',
      status: 'active',
      points: 0,
      roundScores: { r1: null, r2: null, r3: null, r4: null },
      lastUpdated: Timestamp.now(),
      source: 'manual',
    });
  }
  console.log(`  Pre-populated ${FULL_FIELD_EXTRAS.length} non-tier golfers in golferScores`);
  console.log(`  (${FULL_FIELD_EXTRAS.join(', ')})`);

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║                    DONE!  ✓                      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`\nTournament ID: ${tournamentId}`);
  console.log('\nNext steps:');
  console.log('  1. Verify site at https://phils-masters-pool.web.app');
  console.log('  2. Participant picks are now open');
  console.log('  3. Scraper activates automatically at first tee time (Thu Apr 9 ~8:00 AM ET)');
  console.log('  4. GitHub Actions cron runs every 5 min Thu–Sun Apr 9–12');
  process.exit(0);
}

main().catch(err => {
  console.error('\n✗ Setup failed:', err);
  process.exit(1);
});
