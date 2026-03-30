/**
 * Automatic Score Scraper — Valero Texas Open 2026
 *
 * Fetches live scores from ESPN's Golf API and writes to Firestore.
 * Also auto-locks picks when firstTeeTime has passed.
 *
 * Usage:
 *   node scripts/scrape-scores.js              # Loop every 5 minutes (default)
 *   node scripts/scrape-scores.js --loop 1     # Loop every 1 minute (during active play)
 *   node scripts/scrape-scores.js --once        # Run once and exit
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, setDoc, getDocs, getDoc, updateDoc, addDoc, deleteDoc,
  query, orderBy, Timestamp
} from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// --- Load .env (local file) or use environment variables (CI) ---
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
  // No .env file — fall back to process.env (GitHub Actions, etc.)
}
// Environment variables take precedence over .env file
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

// --- ESPN API ---
const ESPN_API = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

// --- Helpers ---

function parsePosition(displayValue) {
  if (!displayValue) return { position: null, status: 'active' };
  const val = displayValue.toString().toUpperCase().trim();
  if (val === 'CUT' || val === 'MC') return { position: null, status: 'cut' };
  if (val === 'WD' || val === 'W/D') return { position: null, status: 'withdrawn' };
  if (val === 'DQ') return { position: null, status: 'cut' };
  const num = parseInt(val.replace(/^T/, ''));
  return { position: isNaN(num) ? null : num, status: 'active' };
}

function calculatePoints(position, status, cutPlayerCount, currentRound) {
  const missedCutScore = (cutPlayerCount ?? 50) + 1;
  if (status === 'cut') return missedCutScore;
  if (status === 'withdrawn') {
    if (currentRound && currentRound >= 3) return cutPlayerCount ?? 50;
    return missedCutScore;
  }
  const rawPoints = position ?? 999;
  // Safety cap: no golfer's score can exceed the missed-cut score once the cut is known
  if (cutPlayerCount && cutPlayerCount > 0 && rawPoints > missedCutScore) {
    return missedCutScore;
  }
  return rawPoints;
}

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

// --- Main Scraper ---

async function scrapeAndUpdate() {
  const now = new Date();
  console.log(`\n[${now.toLocaleTimeString()}] Fetching ESPN scores...`);

  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournaments = tournamentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find(t => t.status !== 'complete') || tournaments[0];

  if (!tournament) {
    console.log('No tournament found in Firestore.');
    return;
  }
  console.log(`Tournament: ${tournament.name} (${tournament.id})`);

  const firstTeeTime = tournament.firstTeeTime?.toDate?.() || new Date(tournament.firstTeeTime);
  if (now >= firstTeeTime && !tournament.picksLocked) {
    console.log('First tee time has passed — locking picks!');
    await updateDoc(doc(db, 'tournaments', tournament.id), {
      picksLocked: true,
      status: 'in_progress',
    });
    console.log('Picks locked. Status set to in_progress.');
  }

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
  console.log(`Roster: ${allGolfers.length} golfers across ${tiersSnap.docs.length} tiers`);

  const existingScoresSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'golferScores')
  );
  const existingScores = new Map();
  existingScoresSnap.docs.forEach(d => existingScores.set(d.id, d.data()));

  const entriesSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'entries')
  );
  const allEntries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const alertsSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'withdrawalAlerts')
  );
  const existingAlertGolferIds = new Set(
    alertsSnap.docs.map(d => d.data().golferId)
  );

  let espnData;
  try {
    const resp = await fetch(ESPN_API);
    if (!resp.ok) throw new Error(`ESPN API returned ${resp.status}`);
    espnData = await resp.json();
  } catch {
    try {
      const raw = execSync(`curl -s "${ESPN_API}"`, { timeout: 15000 }).toString();
      espnData = JSON.parse(raw);
    } catch (err2) {
      console.error('Failed to fetch ESPN via both fetch and curl:', err2.message);
      return;
    }
  }

  const events = espnData.events || [];
  let event = events.find(e =>
    e.name?.toLowerCase().includes('valero') ||
    e.shortName?.toLowerCase().includes('valero') ||
    e.name?.toLowerCase().includes('texas open') ||
    e.shortName?.toLowerCase().includes('texas open')
  );
  if (!event && events.length > 0) {
    event = events[0];
    console.log(`Using event: ${event.name || event.shortName}`);
  }
  if (!event) {
    console.log('No matching event found on ESPN. Tournament may not have started yet.');
    return;
  }

  const competitions = event.competitions || [];
  if (competitions.length === 0) {
    console.log('No competition data available yet.');
    return;
  }

  const competition = competitions[0];
  const competitors = competition.competitors || [];
  console.log(`ESPN has ${competitors.length} competitors`);

  const eventStatus = event.status || {};
  const eventState = eventStatus.type?.state || 'pre';
  console.log(`Event state: ${eventState} (${eventStatus.type?.description || '?'})`);

  if (eventState === 'pre') {
    console.log('Tournament hasn\'t started yet. Scores will populate once play begins.');
    let matchCount = 0;
    for (const competitor of competitors) {
      const name = competitor.athlete?.displayName || competitor.athlete?.fullName || '';
      if (name && findBestMatch(name, allGolfers)) matchCount++;
    }
    console.log(`Pre-check: ${matchCount}/${allGolfers.length} of our golfers found in ESPN field`);

    const missingGolfers = allGolfers.filter(g => {
      return !competitors.some(c => {
        const name = c.athlete?.displayName || c.athlete?.fullName || '';
        return findBestMatch(name, [g]);
      });
    });
    if (missingGolfers.length > 0) {
      console.log('Missing from ESPN field (possible pre-tournament WD):');
      for (const g of missingGolfers) {
        console.log(`  - ${g.name}`);
        if (!existingAlertGolferIds.has(g.id)) {
          const tierNumber = golferToTier.get(g.id);
          const tierKey = `tier${tierNumber}`;
          const affected = allEntries.filter(e => e.picks?.[tierKey] === g.id).map(e => e.id);
          if (affected.length > 0) {
            const deadline = tournament.firstTeeTime?.toDate?.()
              ? tournament.firstTeeTime.toDate()
              : new Date(tournament.firstTeeTime);
            await addDoc(
              collection(db, 'tournaments', tournament.id, 'withdrawalAlerts'),
              {
                golferId: g.id,
                golferName: g.name,
                tierNumber,
                affectedEntryIds: affected,
                swapDeadline: Timestamp.fromDate(deadline),
                status: 'active',
                createdAt: Timestamp.now(),
              }
            );
            await setDoc(doc(db, 'tournaments', tournament.id, 'golferScores', g.id), {
              name: g.name,
              position: null,
              score: '--',
              today: '--',
              thru: '--',
              status: 'withdrawn',
              points: 999,
              roundScores: { r1: null, r2: null, r3: null, r4: null },
              teeTime: null,
              lastUpdated: Timestamp.now(),
              source: 'scrape',
            });
            const names = allEntries.filter(e => affected.includes(e.id)).map(e => e.participantName);
            console.log(`    PRE-TOURNAMENT WD ALERT: ${affected.length} entries affected (${names.join(', ')})`);
          }
        }
      }
    }
    return;
  }

  // Determine current round from ESPN
  // eventStatus.period is often undefined between rounds, so derive from linescores
  let espnRound = eventStatus.period;
  if (!espnRound) {
    let maxCompletedRound = 0;
    let playersWithThru = 0;
    for (const c of competitors) {
      if (c.status?.thru !== undefined && c.status?.thru !== null) playersWithThru++;
      for (const ls of (c.linescores || [])) {
        // ESPN uses displayValue "-" as a placeholder for rounds not yet played
        const isPlaceholder = ls.displayValue === '-' || ls.displayValue === '--';
        if (ls.period && ls.value !== undefined && !isPlaceholder && ls.period > maxCompletedRound) {
          maxCompletedRound = ls.period;
        }
      }
    }
    espnRound = maxCompletedRound || tournament.currentRound || 1;
    // If players are on the course for a new round, advance
    if (playersWithThru > 0 && maxCompletedRound > 0) {
      // Check if any player has thru data for a round beyond maxCompletedRound
      for (const c of competitors) {
        if (c.status?.thru !== undefined && c.status?.thru !== null) {
          const maxPeriod = Math.max(...(c.linescores || []).filter(ls => ls.value !== undefined && ls.displayValue !== '-').map(ls => ls.period || 0));
          if (maxPeriod > espnRound) espnRound = maxPeriod;
        }
      }
    }
  }
  console.log(`Current round: ${espnRound}`);

  // Count active competitors from ESPN for initial cut detection.
  // Use both status flag AND linescore count — ESPN doesn't always flag cut players.
  const activeCompetitors = competitors.filter(c => {
    const s = (c.status?.displayValue || '').toUpperCase();
    if (s === 'CUT' || s === 'MC' || s === 'WD' || s === 'DQ') return false;
    // If R3+, players with < 3 linescores missed the cut
    if (espnRound >= 3 && (c.linescores || []).length < 3) return false;
    return true;
  });

  // Lock cutPlayerCount: once set in Firestore, never recalculate.
  let cutPlayerCount = tournament.cutPlayerCount;
  if (!cutPlayerCount && espnRound >= 3 && activeCompetitors.length > 0) {
    cutPlayerCount = activeCompetitors.length;
    await updateDoc(doc(db, 'tournaments', tournament.id), { cutPlayerCount });
    console.log('Locked cutPlayerCount = ' + cutPlayerCount);
  }

  // Build set of golfer IDs already flagged as cut/withdrawn in Firestore.
  // Once a player is marked cut, that status is permanent for the tournament.
  const lockedCutGolferIds = new Set();
  for (const [id, data] of existingScores) {
    if (data.status === 'cut' || data.status === 'withdrawn') {
      lockedCutGolferIds.add(id);
    }
  }

  const espnTeeTimeMap = new Map();
  for (const competitor of competitors) {
    const name = competitor.athlete?.displayName || competitor.athlete?.fullName || '';
    const teeTimeStr = competitor.status?.teeTime || competitor.teeTime;
    if (teeTimeStr) {
      espnTeeTimeMap.set(name, new Date(teeTimeStr));
    }
  }

  // Build position map: group competitors by score, assign tied position = min order in group
  const scoreToMinOrder = new Map();
  for (const c of competitors) {
    const s = (c.status?.displayValue || '').toUpperCase();
    if (s === 'CUT' || s === 'MC' || s === 'WD' || s === 'DQ') continue;
    const scoreKey = String(c.score);
    const order = c.order ?? 999;
    if (!scoreToMinOrder.has(scoreKey) || order < scoreToMinOrder.get(scoreKey)) {
      scoreToMinOrder.set(scoreKey, order);
    }
  }
  const positionMap = new Map();
  for (const c of competitors) {
    const scoreKey = String(c.score);
    const tiedPos = scoreToMinOrder.get(scoreKey);
    if (tiedPos != null) {
      positionMap.set(c.id, { position: tiedPos });
    }
  }

  let matched = 0;
  const newWithdrawals = [];

  for (const competitor of competitors) {
    const athlete = competitor.athlete || {};
    const espnName = athlete.displayName || athlete.fullName || '';
    if (!espnName) continue;

    const golfer = findBestMatch(espnName, allGolfers);
    if (!golfer) continue;

    let position, status;
    const statusDisplay = (competitor.status?.displayValue || '').toUpperCase().trim();
    if (statusDisplay === 'CUT' || statusDisplay === 'MC') {
      position = null;
      status = 'cut';
    } else if (statusDisplay === 'WD' || statusDisplay === 'W/D') {
      position = null;
      status = 'withdrawn';
    } else if (statusDisplay === 'DQ') {
      position = null;
      status = 'cut';
    } else {
      const posInfo = positionMap.get(competitor.id);
      position = posInfo?.position ?? competitor.order ?? null;
      status = 'active';
    }

    // Linescore-based cut detection: ESPN doesn't always flag cut players explicitly.
    // If we're in R3+ and the player has fewer linescores than the current round, they missed the cut.
    if (status === 'active' && espnRound >= 3) {
      const linescoreCount = (competitor.linescores || []).length;
      if (linescoreCount < 3) {
        status = 'cut';
        position = null;
      }
    }

    // Permanent lock: if this golfer was already marked cut/withdrawn in Firestore,
    // never revert them back to active. ESPN data can be inconsistent across refreshes.
    if (lockedCutGolferIds.has(golfer.id) && status === 'active') {
      const prev = existingScores.get(golfer.id);
      status = prev?.status || 'cut';
      position = null;
    }

    const prevScore = existingScores.get(golfer.id);
    if (status === 'withdrawn' && prevScore?.status !== 'withdrawn') {
      newWithdrawals.push(golfer);
    }

    // Score to par (main tournament score)
    // ESPN returns score as a number (-9), string ("-9"), or object
    let scoreToPar;
    if (typeof competitor.score === 'number') {
      scoreToPar = competitor.score === 0 ? 'E' : (competitor.score > 0 ? '+' + competitor.score : '' + competitor.score);
    } else if (typeof competitor.score === 'string') {
      scoreToPar = competitor.score;
    } else {
      scoreToPar = competitor.score?.displayValue || 'E';
    }

    // Today / Thru parsing
    let today = '--';
    let thru = '--';
    const linescores = competitor.linescores || [];
    const currentRoundLS = linescores.find(ls => ls.period === espnRound);
    const isPlaceholderScore = currentRoundLS?.displayValue === '-' || currentRoundLS?.displayValue === '--';
    const hasCurrentRoundScore = currentRoundLS && currentRoundLS.value !== undefined && !isPlaceholderScore;

    if (statusDisplay === 'CUT' || statusDisplay === 'MC' || statusDisplay === 'WD' || statusDisplay === 'DQ') {
      // Eliminated players — show their last completed round
      thru = 'F';
      if (hasCurrentRoundScore) {
        today = currentRoundLS.displayValue || currentRoundLS.value.toString();
      } else {
        const lastCompleted = linescores.filter(ls => ls.value !== undefined).sort((a, b) => b.period - a.period)[0];
        today = lastCompleted?.displayValue || lastCompleted?.value?.toString() || '--';
      }
    } else if (competitor.status?.thru !== undefined && competitor.status?.thru !== null) {
      // Player is on the course or finished their round today
      thru = competitor.status.thru.toString();
      if (thru === '18') thru = 'F';
      today = competitor.status.displayValue || '--';
    } else if (statusDisplay === 'F') {
      // Finished current round
      thru = 'F';
      if (hasCurrentRoundScore) {
        today = currentRoundLS.displayValue || currentRoundLS.value.toString();
      }
    } else if (hasCurrentRoundScore) {
      // Has a score for this round but no thru — round is complete
      today = currentRoundLS.displayValue || currentRoundLS.value.toString();
      thru = 'F';
    } else {
      // Between rounds — show last completed round's score
      const lastCompleted = linescores
        .filter(ls => ls.value !== undefined && ls.displayValue !== '-' && ls.displayValue !== '--')
        .sort((a, b) => b.period - a.period)[0];
      if (lastCompleted) {
        today = lastCompleted.displayValue || lastCompleted.value.toString();
        thru = 'F';
      }
    }

    const roundScores = { r1: null, r2: null, r3: null, r4: null };
    for (const ls of linescores) {
      const period = ls.period;
      if (period >= 1 && period <= 4 && ls.value !== undefined) {
        roundScores['r' + period] = ls.value;
      }
    }

    const teeTimeDate = espnTeeTimeMap.get(espnName);
    const teeTime = teeTimeDate ? Timestamp.fromDate(teeTimeDate) : (prevScore?.teeTime || null);

    const effectiveCutCount = cutPlayerCount || activeCompetitors.length || 65;
    const points = calculatePoints(position, status, effectiveCutCount, espnRound);

    await setDoc(doc(db, 'tournaments', tournament.id, 'golferScores', golfer.id), {
      name: golfer.name,
      position,
      score: scoreToPar,
      today,
      thru,
      status,
      points,
      roundScores,
      teeTime,
      lastUpdated: Timestamp.now(),
      source: 'scrape',
    });
    matched++;
  }

  for (const golfer of newWithdrawals) {
    if (espnRound >= 1 && eventState === 'in') {
      const roundLabel = espnRound <= 2 ? 'before the cut' : 'after the cut';
      console.log('  ' + golfer.name + ' withdrew mid-tournament in R' + espnRound + ' (' + roundLabel + ') — no swap allowed.');
      continue;
    }
    if (existingAlertGolferIds.has(golfer.id)) {
      console.log('  Withdrawal alert already exists for ' + golfer.name + ', skipping.');
      continue;
    }

    const tierNumber = golferToTier.get(golfer.id);
    if (!tierNumber) continue;

    const tierKey = 'tier' + tierNumber;
    const affectedEntryIds = allEntries
      .filter(e => e.picks?.[tierKey] === golfer.id)
      .map(e => e.id);

    if (affectedEntryIds.length === 0) {
      console.log('  ' + golfer.name + ' withdrew but nobody picked them. No alert needed.');
      continue;
    }

    const tier = tiersSnap.docs.find(d => d.data().tierNumber === tierNumber)?.data();
    let latestTeeTime = null;
    if (tier) {
      for (const tg of tier.golfers) {
        const score = existingScores.get(tg.id);
        if (score?.teeTime) {
          const tt = score.teeTime.toDate ? score.teeTime.toDate() : new Date(score.teeTime);
          if (!latestTeeTime || tt > latestTeeTime) latestTeeTime = tt;
        }
      }
    }
    if (!latestTeeTime) {
      latestTeeTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
    }

    const alertData = {
      golferId: golfer.id,
      golferName: golfer.name,
      tierNumber,
      affectedEntryIds,
      swapDeadline: Timestamp.fromDate(latestTeeTime),
      status: 'active',
      createdAt: Timestamp.now(),
    };

    await addDoc(
      collection(db, 'tournaments', tournament.id, 'withdrawalAlerts'),
      alertData
    );

    console.log('  WITHDRAWAL ALERT: ' + golfer.name + ' (Tier ' + tierNumber + ')');
    console.log('    ' + affectedEntryIds.length + ' entries affected');
    console.log('    Swap deadline: ' + latestTeeTime.toLocaleTimeString());

    const affectedNames = allEntries
      .filter(e => affectedEntryIds.includes(e.id))
      .map(e => e.participantName || e.entryLabel);
    console.log('    Affected: ' + affectedNames.join(', '));
  }

  if (espnRound && espnRound !== tournament.currentRound) {
    await updateDoc(doc(db, 'tournaments', tournament.id), {
      currentRound: espnRound,
    });
    console.log('Updated current round to ' + espnRound);
  }

  // cutPlayerCount is locked earlier in the function — no need to re-set here

  if (eventState === 'post' && tournament.status !== 'complete') {
    await updateDoc(doc(db, 'tournaments', tournament.id), {
      status: 'complete',
    });
    console.log('Tournament complete!');
  }

  // --- Handle roster golfers not found in ESPN field (pre-tournament WDs, etc.) ---
  const updatedScoresSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'golferScores')
  );
  const updatedScoreIds = new Set(updatedScoresSnap.docs.map(d => d.id));
  const updatedScoreMap = new Map();
  updatedScoresSnap.docs.forEach(d => updatedScoreMap.set(d.id, d.data()));

  let missingCount = 0;
  for (const golfer of allGolfers) {
    if (!updatedScoreIds.has(golfer.id)) {
      const effectiveCutCount = cutPlayerCount || activeCompetitors.length || 65;
      const points = calculatePoints(null, 'withdrawn', effectiveCutCount, espnRound);
      await setDoc(doc(db, 'tournaments', tournament.id, 'golferScores', golfer.id), {
        name: golfer.name,
        position: null,
        score: '--',
        today: '--',
        thru: '--',
        status: 'withdrawn',
        points,
        roundScores: { r1: null, r2: null, r3: null, r4: null },
        teeTime: null,
        lastUpdated: Timestamp.now(),
        source: 'scrape',
      });
      console.log('  ' + golfer.name + ' not in ESPN field — marked withdrawn (' + points + ' pts)');
      updatedScoreMap.set(golfer.id, { points });
      missingCount++;
    }
  }

  // --- Recalculate and update entry totals ---
  let entryUpdates = 0;
  for (const entry of allEntries) {
    const picks = [entry.picks?.tier1, entry.picks?.tier2, entry.picks?.tier3, entry.picks?.tier4, entry.picks?.tier5, entry.picks?.tier6];
    const total = picks.reduce((sum, id) => {
      const score = updatedScoreMap.get(id);
      return sum + (score?.points ?? 0);
    }, 0);
    if (total !== entry.totalScore) {
      await updateDoc(doc(db, 'tournaments', tournament.id, 'entries', entry.id), {
        totalScore: total,
      });
      entryUpdates++;
    }
  }

  console.log('Updated ' + matched + ' golfer scores (' + (competitors.length - matched) + ' ESPN golfers not in our pool)');
  if (missingCount > 0) console.log('Marked ' + missingCount + ' roster golfers as withdrawn (not in ESPN field)');
  if (entryUpdates > 0) console.log('Updated ' + entryUpdates + ' entry totals');

  // --- Daily Leaderboard Snapshots ---
  // Check if any completed rounds need a snapshot saved.
  // A round N is complete if espnRound > N, or if N == espnRound and eventState == 'post'.
  for (let round = 1; round <= 4; round++) {
    const roundComplete =
      (round < espnRound) ||
      (round === espnRound && eventState === 'post');
    if (!roundComplete) continue;

    const snapshotRef = doc(db, 'tournaments', tournament.id, 'dailyLeaderboards', 'round' + round);
    const existing = await getDoc(snapshotRef);
    if (existing.exists()) continue; // Already saved — don't overwrite

    // Build entry standings using current scores
    const entryStandings = allEntries.map(entry => {
      const pickIds = [entry.picks?.tier1, entry.picks?.tier2, entry.picks?.tier3,
                       entry.picks?.tier4, entry.picks?.tier5, entry.picks?.tier6];
      const golfers = pickIds.map(id => {
        const score = updatedScoreMap.get(id);
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

    // Sort by total (lowest wins) and take top 10
    entryStandings.sort((a, b) => a.totalScore - b.totalScore);
    const top10 = entryStandings.slice(0, 10);

    await setDoc(snapshotRef, {
      round,
      standings: top10,
      snapshotAt: Timestamp.now(),
    });
    console.log('Saved Daily Leaderboard snapshot for Round ' + round + ' (top ' + top10.length + ' entries)');
  }

  console.log('Done!');
}

// --- Run Mode ---
const args = process.argv.slice(2);
const once = args.includes('--once');
const loopIdx = args.indexOf('--loop');
const minutes = loopIdx !== -1 ? (parseInt(args[loopIdx + 1]) || 5) : 5;

if (once) {
  scrapeAndUpdate()
    .then(() => process.exit(0))
    .catch(err => { console.error('Fatal:', err); process.exit(1); });
} else {
  console.log('Scraper started — running every ' + minutes + ' minute(s). Press Ctrl+C to stop.');
  console.log('Use --once for a single run, or --loop N to change interval.');

  const run = async () => {
    try {
      await scrapeAndUpdate();
    } catch (err) {
      console.error('Error (will retry next cycle):', err.message);
    }
  };

  run();
  setInterval(run, minutes * 60 * 1000);
}
