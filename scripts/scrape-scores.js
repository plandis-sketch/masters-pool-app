/**
 * Automatic Score Scraper — Valspar Championship 2026
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
  getFirestore, collection, doc, setDoc, getDocs, getDoc, updateDoc, addDoc,
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
  if (status === 'cut') {
    return (cutPlayerCount ?? 50) + 1;
  }
  if (status === 'withdrawn') {
    if (currentRound && currentRound >= 3) {
      return cutPlayerCount ?? 50;
    }
    return (cutPlayerCount ?? 50) + 1;
  }
  return position ?? 999;
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
    e.name?.toLowerCase().includes('valspar') ||
    e.shortName?.toLowerCase().includes('valspar')
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
    for (const c of competitors) {
      for (const ls of (c.linescores || [])) {
        if (ls.period && ls.value !== undefined && ls.period > maxCompletedRound) {
          maxCompletedRound = ls.period;
        }
      }
    }
    espnRound = maxCompletedRound || tournament.currentRound || 1;
  }
  console.log(`Current round: ${espnRound}`);

  let cutPlayerCount = tournament.cutPlayerCount;
  const activeCompetitors = competitors.filter(c => {
    const s = (c.status?.displayValue || '').toUpperCase();
    return !s || (s !== 'CUT' && s !== 'MC' && s !== 'WD' && s !== 'DQ');
  });

  const espnTeeTimeMap = new Map();
  for (const competitor of competitors) {
    const name = competitor.athlete?.displayName || competitor.athlete?.fullName || '';
    const teeTimeStr = competitor.status?.teeTime || competitor.teeTime;
    if (teeTimeStr) {
      espnTeeTimeMap.set(name, new Date(teeTimeStr));
    }
  }

  const sortedCompetitors = [...competitors].sort((a, b) => (a.order || 999) - (b.order || 999));
  const positionMap = new Map();
  let rank = 1;
  let i = 0;
  while (i < sortedCompetitors.length) {
    const score = sortedCompetitors[i].score;
    let j = i;
    while (j < sortedCompetitors.length && sortedCompetitors[j].score === score) j++;
    const tied = (j - i) > 1;
    for (let k = i; k < j; k++) {
      positionMap.set(sortedCompetitors[k].id, { position: rank, tied });
    }
    rank += (j - i);
    i = j;
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

    if (competitor.status?.thru !== undefined && competitor.status?.thru !== null) {
      thru = competitor.status.thru.toString();
      if (thru === '18' || (thru === '0' && status !== 'active')) thru = 'F';
    }

    if (statusDisplay === 'F' || statusDisplay === 'CUT' || statusDisplay === 'WD' ||
        statusDisplay === 'MC' || statusDisplay === 'DQ') {
      thru = 'F';
      const currentRoundLS = (competitor.linescores || []).find(ls => ls.period === espnRound);
      today = currentRoundLS?.displayValue || currentRoundLS?.value?.toString() || '--';
    } else if (competitor.status?.displayValue) {
      today = competitor.status.displayValue;
    } else {
      // No status field (between rounds) — use the last completed round's score
      const linescores = competitor.linescores || [];
      const currentRoundLS = linescores.find(ls => ls.period === espnRound);
      if (currentRoundLS && currentRoundLS.value !== undefined) {
        today = currentRoundLS.displayValue || currentRoundLS.value.toString();
        thru = 'F';
      } else {
        const lastRoundLS = linescores
          .filter(ls => ls.value !== undefined)
          .sort((a, b) => b.period - a.period)[0];
        if (lastRoundLS) {
          today = lastRoundLS.displayValue || lastRoundLS.value.toString();
          thru = 'F';
        }
      }
    }

    const roundScores = { r1: null, r2: null, r3: null, r4: null };
    const linescores = competitor.linescores || [];
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

  if (activeCompetitors.length > 0 && espnRound >= 3 && !tournament.cutPlayerCount) {
    await updateDoc(doc(db, 'tournaments', tournament.id), {
      cutPlayerCount: activeCompetitors.length,
    });
    console.log('Set cut player count to ' + activeCompetitors.length);
  }

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
