/**
 * Recovery script: Fix golfers incorrectly locked as "cut" in Firestore.
 *
 * The linescore-count cut detection in the scraper fires at the START of R3
 * before players have teed off — if a player has only R1+R2 linescores at that
 * moment, they get marked "cut" and the permanent lock prevents correction.
 *
 * This script uses ESPN as the authoritative source for cut status:
 *   - ESPN says CUT/MC/DQ  → missed cut → status "cut", points = cutPlayerCount+1
 *   - ESPN says WD         → withdrawn
 *     → if they have R3+ linescores (made cut before WD) → points = cutPlayerCount
 *     → otherwise → points = cutPlayerCount+1 (never played R3)
 *   - ESPN says active     → made the cut → status "active", points = ESPN position
 *
 * The permanent lock is bypassed here intentionally — we trust ESPN's explicit
 * CUT/MC flag over the Firestore lock for this correction.
 *
 * Usage:
 *   node scripts/fix-cut-status.js              # dry run (preview changes)
 *   node scripts/fix-cut-status.js --write      # apply to Firestore
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, setDoc, getDocs, getDoc,
  updateDoc, query, orderBy, Timestamp,
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
} catch { /* CI — use process.env */ }
const getEnv = key => process.env[key] || env[key];

const app = initializeApp({
  apiKey: getEnv('VITE_FIREBASE_API_KEY'),
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getEnv('VITE_FIREBASE_APP_ID'),
});
const db = getFirestore(app);

const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

const WRITE = process.argv.includes('--write');

function normalizeName(name) {
  return (name || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ø/gi, 'o')
    .trim();
}

function findBestMatch(espnName, allGolfers) {
  const norm = normalizeName(espnName);
  for (const g of allGolfers) {
    if (normalizeName(g.name) === norm) return g;
  }
  const espnLast = norm.split(' ').pop();
  const espnFirst = norm.split(' ')[0];
  for (const g of allGolfers) {
    const parts = normalizeName(g.name).split(' ');
    if (parts.pop() === espnLast && parts[0] === espnFirst) return g;
  }
  const lastMatches = allGolfers.filter(g => normalizeName(g.name).split(' ').pop() === espnLast);
  if (lastMatches.length === 1) return lastMatches[0];
  return null;
}

async function fetchEspn() {
  const res = await fetch(ESPN_URL);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const data = await res.json();

  const events = data.events || [];
  const event =
    events.find(e => e.status?.type?.state === 'in') ||
    events.find(e => e.status?.type?.state === 'post') ||
    events.find(e => e.name?.toLowerCase().includes('masters'));
  if (!event) throw new Error('No Masters event found in ESPN response');

  const comp = event.competitions?.[0];
  const competitors = comp?.competitors || [];
  const period = event.status?.period || comp?.status?.period || 1;
  const eventState = event.status?.type?.state || 'in';

  console.log(`ESPN: "${event.name}", state=${eventState}, period=${period}, ${competitors.length} competitors`);

  // Build tie-corrected position map for active players
  const getScoreKey = c => {
    if (c.score === null || c.score === undefined) return 'unknown';
    if (typeof c.score === 'object') return String(c.score.value ?? c.score.displayValue ?? 999);
    return String(c.score);
  };
  const scoreToMinOrder = new Map();
  for (const c of competitors) {
    const s = (c.status?.displayValue || '').toUpperCase();
    if (s === 'CUT' || s === 'MC' || s === 'WD' || s === 'DQ') continue;
    const key = getScoreKey(c);
    const order = c.order ?? 999;
    if (!scoreToMinOrder.has(key) || order < scoreToMinOrder.get(key)) scoreToMinOrder.set(key, order);
  }

  // Build per-competitor result map
  const byEspnId = new Map();
  for (const c of competitors) {
    const statusDisplay = (c.status?.displayValue || '').toUpperCase().trim();
    let status = 'active';
    if (statusDisplay === 'CUT' || statusDisplay === 'MC' || statusDisplay === 'DQ') status = 'cut';
    else if (statusDisplay === 'WD' || statusDisplay === 'W/D') status = 'withdrawn';

    let position = null;
    if (status === 'active') {
      const tiedPos = scoreToMinOrder.get(getScoreKey(c));
      position = tiedPos ?? c.order ?? null;
    }

    // Check if this player has any completed R3+ linescores (made the cut)
    const completedRounds = (c.linescores || []).filter(
      ls => ls.period >= 3 && ls.value !== undefined && ls.displayValue !== '-' && ls.displayValue !== '--'
    ).length;
    const hasMadeCut = completedRounds > 0 || status === 'active'; // active → already past cut

    // Score to par display
    let score = 'E';
    if (typeof c.score === 'number') score = c.score === 0 ? 'E' : (c.score > 0 ? '+' + c.score : '' + c.score);
    else if (typeof c.score === 'string') score = c.score;
    else if (c.score?.displayValue) score = c.score.displayValue;

    const name = c.athlete?.displayName || c.athlete?.fullName || '';
    byEspnId.set(name, { status, position, hasMadeCut, score });
  }

  return { byEspnId, period, eventState };
}

async function main() {
  console.log(WRITE ? '[WRITE MODE — changes will be applied]' : '[DRY RUN — pass --write to apply]');
  console.log('');

  const { byEspnId, period, eventState } = await fetchEspn();

  // Load tournament
  const tourSnap = await getDocs(collection(db, 'tournaments'));
  const tournaments = tourSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find(t => t.status !== 'complete') || tournaments[0];
  if (!tournament) { console.log('No tournament found.'); return; }
  console.log(`Tournament: ${tournament.name}`);

  const cutPlayerCount = tournament.cutPlayerCount;
  const missedCutPoints = cutPlayerCount ? cutPlayerCount + 1 : 51;
  console.log(`cutPlayerCount=${cutPlayerCount}, missed-cut points=${missedCutPoints}\n`);

  // Load roster
  const tiersSnap = await getDocs(
    query(collection(db, 'tournaments', tournament.id, 'tiers'), orderBy('tierNumber'))
  );
  const allGolfers = [];
  tiersSnap.docs.forEach(d => d.data().golfers.forEach(g => allGolfers.push(g)));

  // Load current Firestore scores
  const scoresSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'golferScores')
  );
  const firestoreScores = new Map();
  scoresSnap.docs.forEach(d => firestoreScores.set(d.id, { id: d.id, ...d.data() }));

  // Load entries
  const entriesSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'entries')
  );
  const allEntries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // --- Evaluate each pool golfer ---
  const corrections = []; // { golfer, oldStatus, newStatus, oldPoints, newPoints }
  const updatedPoints = new Map(); // golferId → new points (for entry recalc)

  for (const golfer of allGolfers) {
    const fsScore = firestoreScores.get(golfer.id);
    const espnName = fsScore?.name || golfer.name;

    // Find this golfer in ESPN by name
    let espnEntry = byEspnId.get(espnName);
    if (!espnEntry) {
      // Try normalized match
      const normTarget = normalizeName(espnName);
      for (const [name, entry] of byEspnId) {
        if (normalizeName(name) === normTarget) { espnEntry = entry; break; }
      }
    }
    if (!espnEntry) {
      // Try last-name-only match among pool golfers' names
      const matched = findBestMatch(espnName, Array.from(byEspnId.keys()).map(n => ({ name: n, id: n })));
      if (matched) espnEntry = byEspnId.get(matched.id);
    }

    const oldStatus = fsScore?.status || 'active';
    const oldPoints = fsScore?.points ?? 0;

    let newStatus, newPoints;

    if (!espnEntry) {
      // Not in ESPN at all — keep current Firestore data unchanged
      updatedPoints.set(golfer.id, oldPoints);
      continue;
    }

    if (espnEntry.status === 'cut') {
      // ESPN explicitly confirms missed cut
      newStatus = 'cut';
      newPoints = missedCutPoints;
    } else if (espnEntry.status === 'withdrawn') {
      // Withdrew — check if they made the cut first (have R3 data)
      newStatus = 'withdrawn';
      newPoints = espnEntry.hasMadeCut ? (cutPlayerCount ?? 50) : missedCutPoints;
    } else {
      // ESPN says active (has a position) — they MADE the cut
      newStatus = 'active';
      const rawPos = espnEntry.position ?? 999;
      // Safety cap: position can't legitimately exceed cutPlayerCount for an active player
      // (cutPlayerCount = number who made the cut; rank 55+ would be an ESPN data error)
      newPoints = (cutPlayerCount && rawPos > cutPlayerCount) ? cutPlayerCount : rawPos;
    }

    updatedPoints.set(golfer.id, newPoints);

    const statusChanged = newStatus !== oldStatus;
    const pointsChanged = newPoints !== oldPoints;

    if (statusChanged || pointsChanged) {
      corrections.push({
        golfer,
        espnName,
        oldStatus,
        newStatus,
        oldPoints,
        newPoints,
        position: espnEntry.position,
      });
    }
  }

  if (corrections.length === 0) {
    console.log('No corrections needed — all golfer statuses are already consistent with ESPN.');
    return;
  }

  console.log(`${corrections.length} golfer(s) need correction:\n`);
  for (const c of corrections) {
    const statusNote = c.oldStatus !== c.newStatus ? ` status: ${c.oldStatus}→${c.newStatus}` : '';
    const pointsNote = c.oldPoints !== c.newPoints ? ` points: ${c.oldPoints}→${c.newPoints}` : '';
    const posNote = c.newStatus === 'active' ? ` (ESPN pos ${c.position})` : '';
    console.log(`  ${c.espnName}:${statusNote}${pointsNote}${posNote}`);
  }

  if (!WRITE) {
    console.log('\nDry run — pass --write to apply these corrections.');
    return;
  }

  // Apply corrections to golferScores
  console.log('\nApplying corrections...');
  for (const c of corrections) {
    const ref = doc(db, 'tournaments', tournament.id, 'golferScores', c.golfer.id);
    const fsScore = firestoreScores.get(c.golfer.id);
    await setDoc(ref, {
      ...(fsScore || {}),
      status: c.newStatus,
      points: c.newPoints,
      position: c.newStatus === 'active' ? c.position : null,
      lastUpdated: Timestamp.now(),
    }, { merge: true });
  }

  // Recalculate entry totals
  let entryUpdates = 0;
  for (const entry of allEntries) {
    const picks = [
      entry.picks?.tier1, entry.picks?.tier2, entry.picks?.tier3,
      entry.picks?.tier4, entry.picks?.tier5, entry.picks?.tier6,
    ];
    const total = picks.reduce((sum, id) => sum + (updatedPoints.get(id) ?? firestoreScores.get(id)?.points ?? 0), 0);
    if (total !== entry.totalScore) {
      await updateDoc(doc(db, 'tournaments', tournament.id, 'entries', entry.id), { totalScore: total });
      entryUpdates++;
    }
  }

  console.log(`\nDone. ${corrections.length} golfer scores corrected, ${entryUpdates} entry totals updated.`);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('Fatal:', err); process.exit(1); });
