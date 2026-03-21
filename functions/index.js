/**
 * Firebase Cloud Function — Scheduled Score Scraper
 *
 * Runs every 5 minutes during the tournament, fetches live scores
 * from ESPN, and writes them to Firestore.
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

const ESPN_API = "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard";

// --- Helpers ---

function calculatePoints(position, status, cutPlayerCount, currentRound) {
  if (status === "cut") return (cutPlayerCount ?? 50) + 1;
  if (status === "withdrawn") {
    if (currentRound && currentRound >= 3) return cutPlayerCount ?? 50;
    return (cutPlayerCount ?? 50) + 1;
  }
  return position ?? 999;
}

function normalizeName(name) {
  return name
    .replace(/ø/g, "o").replace(/Ø/g, "o")
    .replace(/æ/g, "ae").replace(/Æ/g, "ae")
    .replace(/ñ/g, "n").replace(/Ñ/g, "n")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findBestMatch(espnName, tierGolfers) {
  const normalized = normalizeName(espnName);
  for (const g of tierGolfers) {
    if (normalizeName(g.name) === normalized) return g;
  }
  const espnLast = normalized.split(" ").pop();
  const espnFirst = normalized.split(" ")[0];
  for (const g of tierGolfers) {
    const parts = normalizeName(g.name).split(" ");
    const gLast = parts.pop();
    const gFirst = parts[0];
    if (gLast === espnLast && gFirst === espnFirst) return g;
  }
  const lastNameMatches = tierGolfers.filter((g) => {
    const gLast = normalizeName(g.name).split(" ").pop();
    return gLast === espnLast;
  });
  if (lastNameMatches.length === 1) return lastNameMatches[0];
  return null;
}

// --- Main scraper logic ---

async function scrapeAndUpdate() {
  const now = new Date();
  logger.info("Fetching ESPN scores...", { time: now.toISOString() });

  const tournamentsSnap = await db.collection("tournaments").get();
  const tournaments = tournamentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find((t) => t.status !== "complete") || tournaments[0];

  if (!tournament) {
    logger.info("No tournament found in Firestore.");
    return;
  }
  logger.info(`Tournament: ${tournament.name} (${tournament.id})`);

  // Skip if tournament is complete
  if (tournament.status === "complete") {
    logger.info("Tournament is complete — nothing to update.");
    return;
  }

  // Auto-lock picks
  const firstTeeTime = tournament.firstTeeTime?.toDate?.() || new Date(tournament.firstTeeTime);
  if (now >= firstTeeTime && !tournament.picksLocked) {
    logger.info("First tee time has passed — locking picks!");
    await db.collection("tournaments").doc(tournament.id).update({
      picksLocked: true,
      status: "in_progress",
    });
  }

  // Load roster
  const tiersSnap = await db
    .collection("tournaments").doc(tournament.id).collection("tiers")
    .orderBy("tierNumber").get();
  const allGolfers = [];
  const golferToTier = new Map();
  tiersSnap.docs.forEach((d) => {
    const tier = d.data();
    tier.golfers.forEach((g) => {
      allGolfers.push(g);
      golferToTier.set(g.id, tier.tierNumber);
    });
  });
  logger.info(`Roster: ${allGolfers.length} golfers across ${tiersSnap.docs.length} tiers`);

  // Load existing scores
  const existingScoresSnap = await db
    .collection("tournaments").doc(tournament.id).collection("golferScores").get();
  const existingScores = new Map();
  existingScoresSnap.docs.forEach((d) => existingScores.set(d.id, d.data()));

  // Load entries
  const entriesSnap = await db
    .collection("tournaments").doc(tournament.id).collection("entries").get();
  const allEntries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Load existing withdrawal alerts
  const alertsSnap = await db
    .collection("tournaments").doc(tournament.id).collection("withdrawalAlerts").get();
  const existingAlertGolferIds = new Set(alertsSnap.docs.map((d) => d.data().golferId));

  // Fetch ESPN
  let espnData;
  try {
    const resp = await fetch(ESPN_API);
    if (!resp.ok) throw new Error(`ESPN API returned ${resp.status}`);
    espnData = await resp.json();
  } catch (err) {
    logger.error("Failed to fetch ESPN:", err.message);
    return;
  }

  const events = espnData.events || [];
  let event = events.find((e) =>
    e.name?.toLowerCase().includes("valspar") ||
    e.shortName?.toLowerCase().includes("valspar")
  );
  if (!event && events.length > 0) {
    event = events[0];
    logger.info(`Using event: ${event.name || event.shortName}`);
  }
  if (!event) {
    logger.info("No matching event found on ESPN.");
    return;
  }

  const competitions = event.competitions || [];
  if (competitions.length === 0) {
    logger.info("No competition data available yet.");
    return;
  }

  const competition = competitions[0];
  const competitors = competition.competitors || [];
  logger.info(`ESPN has ${competitors.length} competitors`);

  const eventStatus = event.status || {};
  const eventState = eventStatus.type?.state || "pre";
  logger.info(`Event state: ${eventState}`);

  if (eventState === "pre") {
    // Pre-tournament: check for missing golfers (pre-WDs)
    let matchCount = 0;
    for (const competitor of competitors) {
      const name = competitor.athlete?.displayName || competitor.athlete?.fullName || "";
      if (name && findBestMatch(name, allGolfers)) matchCount++;
    }
    logger.info(`Pre-check: ${matchCount}/${allGolfers.length} golfers found in ESPN field`);

    const missingGolfers = allGolfers.filter((g) => {
      return !competitors.some((c) => {
        const name = c.athlete?.displayName || c.athlete?.fullName || "";
        return findBestMatch(name, [g]);
      });
    });

    for (const g of missingGolfers) {
      if (existingAlertGolferIds.has(g.id)) continue;
      const tierNumber = golferToTier.get(g.id);
      const tierKey = `tier${tierNumber}`;
      const affected = allEntries.filter((e) => e.picks?.[tierKey] === g.id).map((e) => e.id);
      if (affected.length > 0) {
        const deadline = firstTeeTime;
        await db.collection("tournaments").doc(tournament.id).collection("withdrawalAlerts").add({
          golferId: g.id,
          golferName: g.name,
          tierNumber,
          affectedEntryIds: affected,
          swapDeadline: Timestamp.fromDate(deadline),
          status: "active",
          createdAt: Timestamp.now(),
        });
        await db.collection("tournaments").doc(tournament.id).collection("golferScores").doc(g.id).set({
          name: g.name, position: null, score: "--", today: "--", thru: "--",
          status: "withdrawn", points: 999,
          roundScores: { r1: null, r2: null, r3: null, r4: null },
          teeTime: null, lastUpdated: Timestamp.now(), source: "scrape",
        });
        logger.info(`PRE-TOURNAMENT WD: ${g.name} — ${affected.length} entries affected`);
      }
    }
    return;
  }

  // --- Active tournament scoring ---

  let espnRound = eventStatus.period;
  if (!espnRound) {
    let maxRoundSeen = 0;
    let maxCompletedRound = 0;
    for (const c of competitors) {
      for (const ls of c.linescores || []) {
        if (ls.period && ls.period > maxRoundSeen) maxRoundSeen = ls.period;
        if (ls.period && ls.value !== undefined && ls.period > maxCompletedRound) {
          maxCompletedRound = ls.period;
        }
      }
    }
    espnRound = maxRoundSeen || maxCompletedRound || tournament.currentRound || 1;
  }
  logger.info(`Current round: ${espnRound}`);

  let cutPlayerCount = tournament.cutPlayerCount;
  const activeCompetitors = competitors.filter((c) => {
    const s = (c.status?.displayValue || "").toUpperCase();
    return !s || (s !== "CUT" && s !== "MC" && s !== "WD" && s !== "DQ");
  });

  // Tee times
  const espnTeeTimeMap = new Map();
  for (const competitor of competitors) {
    const name = competitor.athlete?.displayName || competitor.athlete?.fullName || "";
    const teeTimeStr = competitor.status?.teeTime || competitor.teeTime;
    if (teeTimeStr) espnTeeTimeMap.set(name, new Date(teeTimeStr));
  }

  // Build position map: group competitors by score, assign tied position = min order in group
  const scoreToMinOrder = new Map();
  for (const c of competitors) {
    const s = (c.status?.displayValue || "").toUpperCase();
    if (s === "CUT" || s === "MC" || s === "WD" || s === "DQ") continue;
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
  const updatedScoreMap = new Map();

  for (const competitor of competitors) {
    const athlete = competitor.athlete || {};
    const espnName = athlete.displayName || athlete.fullName || "";
    if (!espnName) continue;

    const golfer = findBestMatch(espnName, allGolfers);
    if (!golfer) continue;

    let position, status;
    const statusDisplay = (competitor.status?.displayValue || "").toUpperCase().trim();
    if (statusDisplay === "CUT" || statusDisplay === "MC") {
      position = null; status = "cut";
    } else if (statusDisplay === "WD" || statusDisplay === "W/D") {
      position = null; status = "withdrawn";
    } else if (statusDisplay === "DQ") {
      position = null; status = "cut";
    } else {
      const posInfo = positionMap.get(competitor.id);
      position = posInfo?.position ?? competitor.order ?? null;
      status = "active";
    }

    const prevScore = existingScores.get(golfer.id);
    if (status === "withdrawn" && prevScore?.status !== "withdrawn") {
      newWithdrawals.push(golfer);
    }

    // Score to par
    let scoreToPar;
    if (typeof competitor.score === "number") {
      scoreToPar = competitor.score === 0 ? "E" : (competitor.score > 0 ? "+" + competitor.score : "" + competitor.score);
    } else if (typeof competitor.score === "string") {
      scoreToPar = competitor.score;
    } else {
      scoreToPar = competitor.score?.displayValue || "E";
    }

    // Today / Thru
    let today = "--";
    let thru = "--";
    const linescores = competitor.linescores || [];
    const currentRoundLS = linescores.find((ls) => ls.period === espnRound);
    const hasCurrentRoundScore = currentRoundLS && currentRoundLS.value !== undefined;

    if (statusDisplay === "CUT" || statusDisplay === "MC" || statusDisplay === "WD" || statusDisplay === "DQ") {
      thru = "F";
      if (hasCurrentRoundScore) {
        today = currentRoundLS.displayValue || currentRoundLS.value.toString();
      } else {
        const lastCompleted = linescores.filter((ls) => ls.value !== undefined).sort((a, b) => b.period - a.period)[0];
        today = lastCompleted?.displayValue || lastCompleted?.value?.toString() || "--";
      }
    } else if (competitor.status?.thru !== undefined && competitor.status?.thru !== null) {
      thru = competitor.status.thru.toString();
      if (thru === "18") thru = "F";
      today = competitor.status.displayValue || "--";
    } else if (statusDisplay === "F") {
      thru = "F";
      if (hasCurrentRoundScore) {
        today = currentRoundLS.displayValue || currentRoundLS.value.toString();
      }
    } else if (hasCurrentRoundScore) {
      today = currentRoundLS.displayValue || currentRoundLS.value.toString();
      thru = "F";
    } else {
      today = "--";
      thru = "--";
    }

    // Round scores
    const roundScores = { r1: null, r2: null, r3: null, r4: null };
    for (const ls of competitor.linescores || []) {
      if (ls.period >= 1 && ls.period <= 4 && ls.value !== undefined) {
        roundScores["r" + ls.period] = ls.value;
      }
    }

    const teeTimeDate = espnTeeTimeMap.get(espnName);
    const teeTime = teeTimeDate ? Timestamp.fromDate(teeTimeDate) : (prevScore?.teeTime || null);

    const effectiveCutCount = cutPlayerCount || activeCompetitors.length || 65;
    const points = calculatePoints(position, status, effectiveCutCount, espnRound);

    await db.collection("tournaments").doc(tournament.id).collection("golferScores").doc(golfer.id).set({
      name: golfer.name, position, score: scoreToPar, today, thru, status, points,
      roundScores, teeTime, lastUpdated: Timestamp.now(), source: "scrape",
    });
    updatedScoreMap.set(golfer.id, { points });
    matched++;
  }

  // Handle mid-tournament withdrawals (alerts)
  for (const golfer of newWithdrawals) {
    if (espnRound >= 1 && eventState === "in") {
      logger.info(`${golfer.name} withdrew mid-tournament in R${espnRound} — no swap allowed.`);
      continue;
    }
    if (existingAlertGolferIds.has(golfer.id)) continue;
    const tierNumber = golferToTier.get(golfer.id);
    if (!tierNumber) continue;
    const tierKey = "tier" + tierNumber;
    const affectedEntryIds = allEntries.filter((e) => e.picks?.[tierKey] === golfer.id).map((e) => e.id);
    if (affectedEntryIds.length === 0) continue;

    await db.collection("tournaments").doc(tournament.id).collection("withdrawalAlerts").add({
      golferId: golfer.id, golferName: golfer.name, tierNumber, affectedEntryIds,
      swapDeadline: Timestamp.fromDate(new Date(Date.now() + 2 * 60 * 60 * 1000)),
      status: "active", createdAt: Timestamp.now(),
    });
    logger.info(`WITHDRAWAL ALERT: ${golfer.name} (Tier ${tierNumber}) — ${affectedEntryIds.length} entries affected`);
  }

  // Handle roster golfers not found in ESPN field
  const allScoredIds = new Set([...existingScores.keys(), ...updatedScoreMap.keys()]);
  let missingCount = 0;
  for (const golfer of allGolfers) {
    if (!allScoredIds.has(golfer.id) && !updatedScoreMap.has(golfer.id)) {
      const effectiveCutCount = cutPlayerCount || activeCompetitors.length || 65;
      const points = calculatePoints(null, "withdrawn", effectiveCutCount, espnRound);
      await db.collection("tournaments").doc(tournament.id).collection("golferScores").doc(golfer.id).set({
        name: golfer.name, position: null, score: "--", today: "--", thru: "--",
        status: "withdrawn", points,
        roundScores: { r1: null, r2: null, r3: null, r4: null },
        teeTime: null, lastUpdated: Timestamp.now(), source: "scrape",
      });
      updatedScoreMap.set(golfer.id, { points });
      missingCount++;
    }
  }

  // Update tournament metadata
  if (espnRound && espnRound !== tournament.currentRound) {
    await db.collection("tournaments").doc(tournament.id).update({ currentRound: espnRound });
  }
  if (activeCompetitors.length > 0 && espnRound >= 3 && !tournament.cutPlayerCount) {
    await db.collection("tournaments").doc(tournament.id).update({ cutPlayerCount: activeCompetitors.length });
  }
  if (eventState === "post" && tournament.status !== "complete") {
    await db.collection("tournaments").doc(tournament.id).update({ status: "complete" });
  }

  // Recalculate entry totals
  // Merge existing + newly updated scores
  const fullScoreMap = new Map(existingScores);
  for (const [id, data] of updatedScoreMap) {
    fullScoreMap.set(id, { ...fullScoreMap.get(id), ...data });
  }

  let entryUpdates = 0;
  for (const entry of allEntries) {
    const picks = [entry.picks?.tier1, entry.picks?.tier2, entry.picks?.tier3,
                   entry.picks?.tier4, entry.picks?.tier5, entry.picks?.tier6];
    const total = picks.reduce((sum, id) => sum + (fullScoreMap.get(id)?.points ?? 0), 0);
    if (total !== entry.totalScore) {
      await db.collection("tournaments").doc(tournament.id).collection("entries").doc(entry.id).update({
        totalScore: total,
      });
      entryUpdates++;
    }
  }

  logger.info(`Updated ${matched} golfer scores. ${missingCount} marked withdrawn. ${entryUpdates} entry totals updated.`);
}

// --- Scheduled function: runs every 5 minutes ---
exports.scrapeScores = onSchedule(
  {
    schedule: "every 5 minutes",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-east1",
  },
  async () => {
    await scrapeAndUpdate();
  }
);
