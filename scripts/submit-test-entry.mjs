/**
 * Creates a test user and submits a test entry
 * Run with: node scripts/submit-test-entry.mjs
 */
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDocs, addDoc, Timestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyA5oRWbwPLYfudX4bzJsfE6GGLjvTiENaA',
  authDomain: 'phils-masters-pool.firebaseapp.com',
  projectId: 'phils-masters-pool',
  storageBucket: 'phils-masters-pool.firebasestorage.app',
  messagingSenderId: '150609854004',
  appId: '1:150609854004:web:f0bda95ef549e4846b1461',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const TEST_EMAIL = 'testuser@masterspool.com';
const TEST_PASSWORD = 'test123456';
const TEST_NAME = 'Test User';

async function main() {
  console.log('Setting up test user and entry...\n');

  // 1. Create or sign in test user
  let userCred;
  try {
    userCred = await createUserWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
    console.log('  Created test user:', TEST_EMAIL);
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      userCred = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
      console.log('  Signed in existing test user:', TEST_EMAIL);
    } else {
      throw err;
    }
  }

  const uid = userCred.user.uid;

  // 2. Create user doc in Firestore
  await setDoc(doc(db, 'users', uid), {
    email: TEST_EMAIL,
    displayName: TEST_NAME,
    isAdmin: false,
    feeAcknowledged: true,
    createdAt: Timestamp.now(),
  }, { merge: true });
  console.log('  User doc created/updated');

  // 3. Find the active tournament
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournament = tournamentsSnap.docs[0];
  if (!tournament) { console.error('No tournament found!'); process.exit(1); }
  console.log(`  Tournament: ${tournament.data().name}`);

  // 4. Load tiers
  const tiersSnap = await getDocs(collection(db, 'tournaments', tournament.id, 'tiers'));
  const tiers = tiersSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.tierNumber - b.tierNumber);

  // 5. Pick one golfer from each tier (first golfer = the favorite in each tier)
  const picks = {};
  console.log('\n  Picks:');
  for (const tier of tiers) {
    const golfer = tier.golfers[0]; // Pick the top-ranked golfer in each tier
    picks[`tier${tier.tierNumber}`] = golfer.id;
    console.log(`    Tier ${tier.tierNumber}: ${golfer.name}`);
  }

  // 6. Submit entry
  const entry = {
    userId: uid,
    participantName: TEST_NAME,
    entryNumber: 1,
    entryLabel: `${TEST_NAME} #1`,
    picks,
    totalScore: 0,
    paid: false,
    submittedAt: Timestamp.now(),
  };

  const entryRef = await addDoc(collection(db, 'tournaments', tournament.id, 'entries'), entry);
  console.log(`\n  Entry submitted! ID: ${entryRef.id}`);
  console.log('\nDone! You can sign in with:');
  console.log(`  Email: ${TEST_EMAIL}`);
  console.log(`  Password: ${TEST_PASSWORD}`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
