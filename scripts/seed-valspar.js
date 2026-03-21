import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, doc, setDoc, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
const envFile = readFileSync(envPath, 'utf-8');
const env = {};
envFile.split('\n').forEach(line => {
  const [key, ...vals] = line.split('=');
  if (key && vals.length) env[key.trim()] = vals.join('=').trim();
});

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const tournament = {
  name: 'Valspar Championship 2026',
  dates: {
    start: Timestamp.fromDate(new Date('2026-03-20T07:00:00-04:00')),
    end: Timestamp.fromDate(new Date('2026-03-23T18:00:00-04:00')),
  },
  firstTeeTime: Timestamp.fromDate(new Date('2026-03-20T07:00:00-04:00')),
  cutLine: null,
  cutPlayerCount: null,
  picksLocked: false,
  currentRound: 1,
  prizeStructure: [],
  paymentMethods: { venmo: 'Phil-Overton', cashApp: 'PhilipOverton', payPal: 'pove1@juno.com' },
  entryFee: 0,
  status: 'picks_open',
};

const tiers = [
  { tierNumber: 1, label: 'Tier 1 — Favorites', golfers: ['Xander Schauffele','Matt Fitzpatrick','Viktor Hovland','Akshay Bhatia','Justin Thomas','Jacob Bridgeman','Patrick Cantlay','Jordan Spieth','Brooks Koepka','Ryo Hisatsune'] },
  { tierNumber: 2, label: 'Tier 2 — Contenders', golfers: ['Sahith Theegala','J.J. Spaun','Corey Conners','Ben Griffin','Nicolai Hojgaard','Keegan Bradley','Nick Taylor','Taylor Pendrith','Austin Smotherman','Tony Finau'] },
  { tierNumber: 3, label: 'Tier 3 — Solid Picks', golfers: ['Rasmus Hojgaard','Aaron Rai','Davis Thompson','Pierceson Coody','Alex Smalley','Ricky Castillo','Mac Meissner','Taylor Moore','Wyndham Clark','Christiaan Bezuidenhout'] },
  { tierNumber: 4, label: 'Tier 4 — Mid-Range', golfers: ['Max Greyserman','Patrick Rodgers','Bud Cauley','Max Homa','Matt McCarty','Nick Dunlap','Billy Horschel','Sungjae Im','Thorbjorn Olesen','Cam Davis'] },
  { tierNumber: 5, label: 'Tier 5 — Sleepers', golfers: ['Lucas Glover','Eric Cole','Lee Hodges','Garrick Higgo','Austin Eckroat','Luke Clanton','Blades Brown','Brian Campbell','Charley Hoffman','Adrien Dumont de Chassart'] },
  { tierNumber: 6, label: 'Tier 6 — Long Shots', golfers: ['Adam Hadwin','Emiliano Grillo','Gary Woodland','Kevin Yu','David Ford','Zac Blair','Andrew Putnam','Matthieu Pavon','Neal Shipley','Seamus Power'] },
];

async function seed() {
  console.log('Creating tournament...');
  const ref = await addDoc(collection(db, 'tournaments'), tournament);
  console.log('Tournament created: ' + ref.id);
  for (const tier of tiers) {
    const golfers = tier.golfers.map((name, idx) => ({ id: 't' + tier.tierNumber + '_g' + (idx+1), name, ranking: (tier.tierNumber-1)*10+idx+1 }));
    await setDoc(doc(db, 'tournaments', ref.id, 'tiers', 'tier' + tier.tierNumber), { tierNumber: tier.tierNumber, label: tier.label, golfers });
    console.log('  Tier ' + tier.tierNumber + ': ' + tier.golfers.length + ' golfers saved');
  }
  console.log('\nDone! Valspar Championship 2026 is ready.');
  process.exit(0);
}
seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
