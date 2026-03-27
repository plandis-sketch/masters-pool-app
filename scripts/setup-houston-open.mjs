/**
 * Setup script: Texas Children's Houston Open 2026
 * Run with: node scripts/setup-houston-open.mjs
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
  name: 'Texas Children\'s Houston Open 2026',
  dates: {
    start: Timestamp.fromDate(new Date('2026-03-26T07:00:00-05:00')),
    end: Timestamp.fromDate(new Date('2026-03-29T18:00:00-05:00')),
  },
  firstTeeTime: Timestamp.fromDate(new Date('2026-03-26T07:00:00-05:00')),
  cutLine: null,
  cutPlayerCount: null,
  picksLocked: false,
  currentRound: 1,
  prizeStructure: [],
  paymentMethods: {
    venmo: 'Phil-Overton',
    cashApp: 'PhilipOverton',
    payPal: 'pove1@juno.com',
  },
  entryFee: 10,
  status: 'picks_open',
};

// ── 6 Tiers × 10 golfers, sorted by OWGR ──
const TIERS = [
  {
    tierNumber: 1,
    label: 'Tier 1 — Favorites',
    golfers: [
      'Scottie Scheffler',
      'Min Woo Lee',
      'Sam Burns',
      'Jake Knapp',
      'Chris Gotterup',
      'Brooks Koepka',
      'Rickie Fowler',
      'Kurt Kitayama',
      'Ben Griffin',
      'Harry Hall',
    ],
  },
  {
    tierNumber: 2,
    label: 'Tier 2 — Contenders',
    golfers: [
      'Nicolai Hojgaard',
      'Harris English',
      'Adam Scott',
      'Michael Thorbjornsen',
      'Shane Lowry',
      'Ryan Gerard',
      'Marco Penge',
      'Keith Mitchell',
      'Jason Day',
      'Sam Stevens',
    ],
  },
  {
    tierNumber: 3,
    label: 'Tier 3 — Solid Picks',
    golfers: [
      'Rasmus Hojgaard',
      'Taylor Pendrith',
      'Wyndham Clark',
      'Sungjae Im',
      'Pierceson Coody',
      'Alex Smalley',
      'Stephan Jaeger',
      'Patrick Rodgers',
      'Davis Thompson',
      'Aaron Rai',
    ],
  },
  {
    tierNumber: 4,
    label: 'Tier 4 — Mid-Range',
    golfers: [
      'Will Zalatoris',
      'Sahith Theegala',
      'Max Greyserman',
      'Ricky Castillo',
      'Ryan Fox',
      'Tony Finau',
      'Kristoffer Reitan',
      'Thorbjorn Olesen',
      'Rico Hoey',
      'Jordan Smith',
    ],
  },
  {
    tierNumber: 5,
    label: 'Tier 5 — Sleepers',
    golfers: [
      'J.T. Poston',
      'Haotong Li',
      'Rasmus Neergaard-Petersen',
      'Christiaan Bezuidenhout',
      'Nico Echavarria',
      'Matt McCarty',
      'Mackenzie Hughes',
      'Denny McCarthy',
      'Tom Kim',
      'Bud Cauley',
    ],
  },
  {
    tierNumber: 6,
    label: 'Tier 6 — Long Shots',
    golfers: [
      'Mac Meissner',
      'Gary Woodland',
      'Adrien Dumont De Chassart',
      'Sudarshan Yellamaraju',
      'Max McGreevy',
      'John Parry',
      'S.H. Kim',
      'Matt Wallace',
      'Kevin Yu',
      'Chris Kirk',
    ],
  },
];

async function main() {
  console.log('Setting up Texas Children\'s Houston Open 2026...\n');

  // 1. Delete existing tournaments
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  for (const d of tournamentsSnap.docs) {
    // Delete sub-collections: tiers, entries, golferScores
    for (const sub of ['tiers', 'entries', 'golferScores']) {
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

  console.log('\nDone! Tournament is ready for testing.');
  console.log(`Tournament ID: ${tournamentRef.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
