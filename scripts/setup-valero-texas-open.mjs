/**
 * Setup script: 2026 Valero Texas Open
 * Run with: node scripts/setup-valero-texas-open.mjs
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc, Timestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyA5oRWbwPLYfudX4bzJsfE6GGLjvTiENaA',
  authDomain: 'phils-masters-pool.firebaseapp.com',
  projectId: 'phils-masters-pool',
  storageBucket: 'phils-masters-pool.firebasestorage.app',
  messagingSenderId: '150609854004',
  appId: '1:150609854004:web:f0bda95ef549e4846b1461',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ── Tournament config ──
const TOURNAMENT = {
  name: '2026 Valero Texas Open',
  dates: {
    start: Timestamp.fromDate(new Date('2026-04-02T07:00:00-05:00')),
    end: Timestamp.fromDate(new Date('2026-04-05T18:00:00-05:00')),
  },
  firstTeeTime: Timestamp.fromDate(new Date('2026-04-02T07:00:00-05:00')),
  cutLine: null,
  cutPlayerCount: null,
  picksLocked: false,
  currentRound: 1,
  prizeStructure: [],
  paymentMethods: {
    venmo: 'Phil-Overton',
    cashApp: 'PhilipOverton',
    payPal: 'pove1@juno.com',
    zelle: 'pove1@juno.com',
  },
  entryFee: 10,
  status: 'picks_open',
};

// ── 6 Tiers × 10 golfers, ordered by DraftKings odds to win ──
const TIERS = [
  {
    tierNumber: 1,
    label: 'Tier 1 — Favorites',
    golfers: [
      'Tommy Fleetwood',
      'Russell Henley',
      'Robert MacIntyre',
      'Ludvig Aberg',
      'Si Woo Kim',
      'Collin Morikawa',
      'Jordan Spieth',
      'Nicolai Hojgaard',
      'Hideki Matsuyama',
      'Maverick McNealy',
    ],
  },
  {
    tierNumber: 2,
    label: 'Tier 2 — Contenders',
    golfers: [
      'Michael Thorbjornsen',
      'Rickie Fowler',
      'J.J. Spaun',
      'Sepp Straka',
      'Keith Mitchell',
      'Alex Noren',
      'Daniel Berger',
      'Ryo Hisatsune',
      'Gary Woodland',
      'Nick Taylor',
    ],
  },
  {
    tierNumber: 3,
    label: 'Tier 3 — Solid Picks',
    golfers: [
      'Marco Penge',
      'Jordan Smith',
      'Pierceson Coody',
      'Thorbjorn Olesen',
      'Ricky Castillo',
      'Will Zalatoris',
      'Denny McCarthy',
      'John Keefer',
      'Davis Thompson',
      'Stephan Jaeger',
    ],
  },
  {
    tierNumber: 4,
    label: 'Tier 4 — Mid-Range',
    golfers: [
      'Alex Smalley',
      'Brian Harman',
      'Rico Hoey',
      'J.T. Poston',
      'Tony Finau',
      'Sudarshan Yellamaraju',
      'Christiaan Bezuidenhout',
      'Patrick Rodgers',
      'Matt McCarty',
      'Haotong Li',
    ],
  },
  {
    tierNumber: 5,
    label: 'Tier 5 — Sleepers',
    golfers: [
      'Max McGreevy',
      'Matt Wallace',
      'Chris Kirk',
      'Kristoffer Reitan',
      'Bud Cauley',
      'Mac Meissner',
      'Tom Kim',
      'Zecheng Dou',
      'Andrew Novak',
      'Adrien Dumont de Chassart',
    ],
  },
  {
    tierNumber: 6,
    label: 'Tier 6 — Long Shots',
    golfers: [
      'Max Homa',
      'Mackenzie Hughes',
      'Chad Ramey',
      'John Parry',
      'Taylor Moore',
      'Eric Cole',
      'Doug Ghim',
      'Austin Smotherman',
      'Michael Kim',
      'Matthias Schmid',
    ],
  },
];

async function main() {
  console.log('Setting up 2026 Valero Texas Open...\n');

  // 1. Delete existing tournaments
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  for (const d of tournamentsSnap.docs) {
    // Delete sub-collections: tiers, entries, golferScores, dailyLeaderboards
    for (const sub of ['tiers', 'entries', 'golferScores', 'dailyLeaderboards', 'withdrawalAlerts']) {
      const subSnap = await getDocs(collection(db, 'tournaments', d.id, sub));
      for (const sd of subSnap.docs) {
        await deleteDoc(doc(db, 'tournaments', d.id, sub, sd.id));
      }
    }
    await deleteDoc(doc(db, 'tournaments', d.id));
    console.log(`  Deleted old tournament: ${d.id}`);
  }

  // 2. Create new tournament
  const tournamentRef = doc(collection(db, 'tournaments'));
  await setDoc(tournamentRef, TOURNAMENT);
  console.log(`  Created tournament: ${tournamentRef.id}`);

  // 3. Create tiers
  for (const tier of TIERS) {
    const golfers = tier.golfers.map((name, idx) => ({
      id: `t${tier.tierNumber}_g${idx + 1}`,
      name,
      ranking: (tier.tierNumber - 1) * 10 + idx + 1,
    }));

    await setDoc(doc(db, 'tournaments', tournamentRef.id, 'tiers', `tier${tier.tierNumber}`), {
      tierNumber: tier.tierNumber,
      label: tier.label,
      golfers,
    });

    console.log(`  Tier ${tier.tierNumber}: ${tier.golfers.join(', ')}`);
  }

  console.log('\nDone! Tournament is ready for participant picks.');
  console.log(`Tournament ID: ${tournamentRef.id}`);
  console.log('\nNext steps:');
  console.log('  1. Run: node scripts/submit-test-entry.mjs  (to create a test entry)');
  console.log('  2. Verify picks are open at https://phils-masters-pool.web.app');
  process.exit(0);
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
