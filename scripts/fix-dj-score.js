/**
 * One-off fix: correct Dustin Johnson's score and recalculate all entry totals.
 *
 * DJ made the cut at the 2026 Masters and played all 4 rounds. The safety-cap
 * bug in calculatePoints was capping his position (which ESPN reported as > 54)
 * to 55 (missed-cut score). This script fetches ESPN's final scores, recalculates
 * using the corrected position logic, and updates all affected entries.
 *
 * Usage: node scripts/fix-dj-score.js
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, setDoc, getDocs, getDoc, updateDoc,
  query, orderBy, Timestamp
} from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
const env = {};
try {
  const envFile = readFileSync(envPath, 'utf-8');
  envFile.split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) env[key.trim()] = vals.join('=').trim();
  });
} catch { /* fall back to process.env */ }
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

const ESPN_API = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

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

function findBestMatch(espnName, tierGolfers) {
  const normalized = normalizeName(espnName);
  for (const g of tierGolfers) {
    if (normalizeName(g.name) === normalized) return g;
  }
  const espnLast = normalized.split(' ').pop();
  const espnFirst = normalized.split(' ')[0];
  for (const g of tierGolfers) {
    const parts = normalizeName(g.name).split(' ');
    const gLast = parts.pop();
    const gFirst = parts[0];
    if (gLast === espnLast && gFirst === espnFirst) return g;
  }
  const lastNameMatches = tierGolfers.filter(g => {
    const gLast = normalizeName(g.name).split(' ').pop();
    return gLast === espnLast;
  });
  if (lastNameMatches.length === 1) return lastNameMatches[0];
  return null;
}

function getScoreKey(score) {
  if (score === null || score === undefined) return 'unknown';
  if (typeof score === 'object') return String(score.value ?? score.displayValue ?? 999);
  return String(score);
}

function parseScoreValue(key) {
  if (key === 'unknown') return 999;
  if (key === 'E' || key === 'e') return 0;
  const v = parseInt(key);
  return isNaN(v) ? 999 : v;
}

// Correct calculatePoints — active players get their position, never capped at missedCutScore
function calculatePoints(position, status, cutPlayerCount, currentRound) {
  const missedCutScore = (cutPlayerCount ?? 50) + 1;
  if (status === 'cut') return missedCutScore;
  if (status === 'withdrawn') {
    if (currentRound && currentRound >= 3) return cutPlayerCount ?? 50;
    return missedCutScore;
  }
  return position ?? 999;
}

async function main() {
  console.log('Fetching tournament from Firestore...');
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournaments = tournamentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find(t => t.name?.toLowerCase().includes('masters')) || tournaments[0];
  if (!tournament) { console.error('No tournament found'); process.exit(1); }
  console.log(`Tournament: ${tournament.name} (${tournament.id})`);
  console.log(`cutPlayerCount: ${tournament.cutPlayerCount}`);

  // Load all golfers
  const tiersSnap = await getDocs(
    query(collection(db, 'tournaments', tournament.id, 'tiers'), orderBy('tierNumber'))
  );
  const allGolfers = [];
  tiersSnap.docs.forEach(d => d.data().golfers.forEach(g => allGolfers.push(g)));
  console.log(`Roster: ${allGolfers.length} golfers`);

  // Fetch ESPN data
  console.log('Fetching ESPN scores...');
  let espnData;
  try {
    const resp = await fetch(ESPN_API);
    if (!resp.ok) throw new Error(`ESPN ${resp.status}`);
    espnData = await resp.json();
  } catch {
    try {
      const raw = execSync(`curl -s "${ESPN_API}"`, { timeout: 15000 }).toString();
      espnData = JSON.parse(raw);
    } catch (err) {
      console.error('Failed to fetch ESPN:', err.message);
      process.exit(1);
    }
  }

  const events = espnData.events || [];
  let event = events.find(e => (e.name || '').toLowerCase().includes('masters')) ||
              events.find(e => e.status?.type?.state === 'in') ||
              events[0];
  if (!event) { console.error('No ESPN event found'); process.exit(1); }
  console.log(`ESPN event: ${event.name}`);

  const competitors = event.competitions?.[0]?.competitors || [];
  console.log(`${competitors.length} competitors in ESPN data`);

  // Determine current round
  const espnRound = event.status?.period || 4;
  const cutPlayerCount = tournament.cutPlayerCount;
  console.log(`Round: ${espnRound}, cutPlayerCount: ${cutPlayerCount}`);

  // Build correct position map (by score rank, not c.order).
  // Only include players who made the cut — identified by having a completed R3 linescore.
  // ESPN doesn't flag cut players with CUT/MC status after the tournament ends, so we
  // rely on the presence of R3 data as proof of having made the cut.
  const activeForRanking = competitors.filter(c => {
    const s = (c.status?.displayValue || '').toUpperCase();
    if (s === 'CUT' || s === 'MC' || s === 'WD' || s === 'DQ') return false;
    const hasR3 = (c.linescores || []).some(
      ls => ls.period === 3 && ls.value !== undefined && ls.displayValue !== '-' && ls.displayValue !== '--'
    );
    return hasR3;
  });
  console.log(`Active competitors (non-cut): ${activeForRanking.length}`);

  const scorePlayerCount = new Map();
  for (const c of activeForRanking) {
    const key = getScoreKey(c.score);
    scorePlayerCount.set(key, (scorePlayerCount.get(key) || 0) + 1);
  }
  const sortedScoreKeys = [...scorePlayerCount.keys()].sort(
    (a, b) => parseScoreValue(a) - parseScoreValue(b)
  );
  const scoreToPosition = new Map();
  let cumulativeCount = 0;
  for (const scoreKey of sortedScoreKeys) {
    scoreToPosition.set(scoreKey, cumulativeCount + 1);
    cumulativeCount += scorePlayerCount.get(scoreKey);
  }
  const positionMap = new Map();
  for (const c of activeForRanking) {
    const scoreKey = getScoreKey(c.score);
    const pos = scoreToPosition.get(scoreKey);
    if (pos != null) positionMap.set(c.id, { position: pos });
  }

  // --- Process EVERY golfer, not just DJ ---
  // This ensures all made-cut golfers with previously wrong scores are corrected.
  const existingScoresSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'golferScores')
  );
  const existingScores = new Map();
  existingScoresSnap.docs.forEach(d => existingScores.set(d.id, d.data()));

  let fixedCount = 0;
  const scoreUpdates = new Map();

  for (const competitor of competitors) {
    const espnName = competitor.athlete?.displayName || competitor.athlete?.fullName || '';
    if (!espnName) continue;
    const golfer = findBestMatch(espnName, allGolfers);
    if (!golfer) continue;

    const statusDisplay = (competitor.status?.displayValue || '').toUpperCase().trim();
    let position, status;

    if (statusDisplay === 'CUT' || statusDisplay === 'MC') {
      position = null; status = 'cut';
    } else if (statusDisplay === 'WD' || statusDisplay === 'W/D') {
      position = null; status = 'withdrawn';
    } else if (statusDisplay === 'DQ') {
      position = null; status = 'cut';
    } else {
      // R4 linescore check: if round 4 and no R3 score, missed cut
      let isLinescoredCut = false;
      if (espnRound >= 4) {
        const hasR3 = (competitor.linescores || []).some(
          ls => ls.period === 3 && ls.value !== undefined && ls.displayValue !== '-' && ls.displayValue !== '--'
        );
        if (!hasR3) isLinescoredCut = true;
      }
      if (isLinescoredCut) {
        position = null; status = 'cut';
      } else {
        const posInfo = positionMap.get(competitor.id);
        position = posInfo?.position ?? null;
        status = 'active';
      }
    }

    const effectiveCutCount = cutPlayerCount || activeForRanking.length || 65;
    const newPoints = calculatePoints(position, status, effectiveCutCount, espnRound);
    const prevScore = existingScores.get(golfer.id);
    const oldPoints = prevScore?.points ?? null;

    scoreUpdates.set(golfer.id, { name: golfer.name, position, status, newPoints, oldPoints });

    if (oldPoints !== newPoints) {
      console.log(`  ${golfer.name}: ${status}, position=${position}, points ${oldPoints} → ${newPoints}`);

      // Build round scores
      const roundScores = { r1: null, r2: null, r3: null, r4: null };
      for (const ls of (competitor.linescores || [])) {
        if (ls.period >= 1 && ls.period <= 4 && ls.value !== undefined) {
          roundScores['r' + ls.period] = ls.value;
        }
      }

      let scoreToPar;
      if (typeof competitor.score === 'number') {
        scoreToPar = competitor.score === 0 ? 'E' : (competitor.score > 0 ? '+' + competitor.score : '' + competitor.score);
      } else if (typeof competitor.score === 'string') {
        scoreToPar = competitor.score;
      } else {
        scoreToPar = competitor.score?.displayValue || prevScore?.score || '--';
      }

      await setDoc(doc(db, 'tournaments', tournament.id, 'golferScores', golfer.id), {
        ...prevScore,
        name: golfer.name,
        position,
        score: scoreToPar,
        status,
        points: newPoints,
        roundScores,
        lastUpdated: Timestamp.now(),
        source: 'manual',
      });
      fixedCount++;
    }
  }

  console.log(`\nFixed ${fixedCount} golfer score(s).`);

  if (fixedCount === 0) {
    console.log('No score changes needed — all golfer points were already correct.');
    process.exit(0);
  }

  // Recalculate entry totals
  console.log('\nRecalculating entry totals...');
  const entriesSnap = await getDocs(collection(db, 'tournaments', tournament.id, 'entries'));
  const allEntries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Rebuild full score map
  const finalScoresSnap = await getDocs(collection(db, 'tournaments', tournament.id, 'golferScores'));
  const finalScores = new Map();
  finalScoresSnap.docs.forEach(d => finalScores.set(d.id, d.data()));

  let entryUpdateCount = 0;
  for (const entry of allEntries) {
    const picks = [entry.picks?.tier1, entry.picks?.tier2, entry.picks?.tier3,
                   entry.picks?.tier4, entry.picks?.tier5, entry.picks?.tier6];
    const total = picks.reduce((sum, id) => sum + (finalScores.get(id)?.points ?? 0), 0);
    if (total !== entry.totalScore) {
      console.log(`  ${entry.entryLabel || entry.participantName}: ${entry.totalScore} → ${total}`);
      await updateDoc(doc(db, 'tournaments', tournament.id, 'entries', entry.id), {
        totalScore: total,
      });
      entryUpdateCount++;
    }
  }
  console.log(`Updated ${entryUpdateCount} entry total(s).`);

  // Update final Day 4 leaderboard snapshot only
  console.log('\nUpdating Round 4 (Final) leaderboard snapshot...');
  const r4Ref = doc(db, 'tournaments', tournament.id, 'dailyLeaderboards', 'round4');
  const standings = allEntries.map(entry => {
    const picks = [entry.picks?.tier1, entry.picks?.tier2, entry.picks?.tier3,
                   entry.picks?.tier4, entry.picks?.tier5, entry.picks?.tier6];
    const golfers = picks.map(id => {
      const score = finalScores.get(id);
      return {
        id,
        name: score?.name || allGolfers.find(g => g.id === id)?.name || 'Unknown',
        points: score?.points ?? 0,
        score: score?.score || '--',
        status: score?.status || 'active',
      };
    });
    const totalScore = golfers.reduce((sum, g) => sum + g.points, 0);
    return {
      entryId: entry.id,
      participantName: entry.participantName || '',
      entryLabel: entry.entryLabel || entry.participantName || '',
      totalScore,
      golfers,
    };
  });
  standings.sort((a, b) => a.totalScore - b.totalScore);
  await setDoc(r4Ref, {
    round: 4,
    standings: standings.slice(0, 10),
    snapshotAt: Timestamp.now(),
  });
  console.log('Round 4 leaderboard snapshot updated.');

  console.log('\nDone!');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
