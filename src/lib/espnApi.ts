import { useState, useEffect } from 'react';

export interface EspnGolfer {
  id: string;
  name: string;
  position: string;
  positionNum: number;
  score: string;
  today: string;
  thru: string;
  status: 'active' | 'cut' | 'withdrawn';
  rounds: string[];
}

export interface EspnTournamentData {
  id: string;
  name: string;
  golfers: EspnGolfer[];
  cutPlayerCount: number;
  round: number;
}

const ESPN_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

/** Parse tee time string like "Sat Mar 28 12:55:00 PDT 2026" → "12:55 PM" */
function formatTeeTime(raw: string): string {
  try {
    const match = raw.match(/(\d{1,2}):(\d{2}):\d{2}\s*(AM|PM|[A-Z]{2,4})/i);
    if (!match) return raw;
    let hour = parseInt(match[1], 10);
    const min = match[2];
    // If timezone abbreviation instead of AM/PM, assume 24h and convert
    const ampm = /^(AM|PM)$/i.test(match[3])
      ? match[3].toUpperCase()
      : hour >= 12
        ? 'PM'
        : 'AM';
    if (ampm === 'PM' && hour < 12) hour += 0; // already correct for display
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${min} ${ampm}`;
  } catch {
    return raw;
  }
}

export async function fetchLeaderboard(): Promise<EspnTournamentData | null> {
  try {
    const res = await fetch(ESPN_SCOREBOARD_URL);
    if (!res.ok) return null;
    const data = await res.json();

    // Find the current live or upcoming event.
    // Prefer 'in' (live) → 'pre' (upcoming) — never use a 'post' (completed) event
    // from a prior tournament, which would show stale/wrong scores.
    const events = data.events || [];
    const event =
      events.find((e: any) => e.status?.type?.state === 'in') ||
      events.find((e: any) => e.status?.type?.state === 'pre');

    if (!event) return null;

    const comp = event.competitions?.[0];
    const competitors: any[] = comp?.competitors || [];
    if (competitors.length === 0) return null;

    // Current round from competition status
    const currentRound: number = comp.status?.period || 1;

    // Detect cut: players flagged by ESPN as CUT/MC, or missing current-round linescore
    const hasCut = currentRound >= 3;
    let cutPlayerCount = 0;

    // First pass: count active players to establish the cut score
    if (hasCut) {
      for (const c of competitors) {
        const statusVal = (c.status?.displayValue || '').toUpperCase().trim();
        const allLs: any[] = c.linescores || [];
        const currentRoundLs = allLs.find((ls: any) => ls.period === currentRound);
        const isCutByStatus = statusVal === 'CUT' || statusVal === 'MC' || statusVal === 'DQ';
        const isCutByRound = !currentRoundLs && !isCutByStatus && statusVal !== 'WD' && statusVal !== 'W/D';
        if (!isCutByStatus && !isCutByRound && statusVal !== 'WD' && statusVal !== 'W/D') {
          cutPlayerCount++;
        }
      }
    }

    const golfers: EspnGolfer[] = competitors.map((c: any) => {
      const athlete = c.athlete || {};
      const allLinescores: any[] = c.linescores || [];

      // Find the current round's linescore by period
      const currentRoundLs = allLinescores.find((ls: any) => ls.period === currentRound);

      // Determine status from ESPN's explicit flag first, then fallback to linescore detection
      const statusVal = (c.status?.displayValue || '').toUpperCase().trim();
      let status: EspnGolfer['status'] = 'active';
      if (statusVal === 'CUT' || statusVal === 'MC' || statusVal === 'DQ') {
        status = 'cut';
      } else if (statusVal === 'WD' || statusVal === 'W/D') {
        status = 'withdrawn';
      } else if (hasCut && !currentRoundLs) {
        status = 'cut';
      }

      // Position
      const order: number = c.order || 999;
      const posDisplay = status === 'cut' ? 'CUT' : status === 'withdrawn' ? 'WD' : String(order);

      // Completed round scores (exclude placeholder/empty rounds)
      const rounds: string[] = allLinescores
        .filter((ls: any) => {
          const holes = ls.linescores || [];
          return holes.length === 18; // fully completed round
        })
        .map((ls: any) => ls.displayValue || '--');

      // Today & Thru for the current round
      let today = '--';
      let thru = '--';

      if (status === 'cut' || status === 'withdrawn') {
        // Cut/withdrawn players: no today/thru
        today = '--';
        thru = '--';
      } else if (currentRoundLs) {
        const holes: any[] = currentRoundLs.linescores || [];
        const dv = currentRoundLs.displayValue || '';
        const val = currentRoundLs.value || 0;

        if (holes.length === 18) {
          // Finished today's round
          today = dv || '--';
          thru = 'F';
        } else if (holes.length > 0) {
          // ESPN has partial hole data. If the round-level value looks like a full-round
          // stroke total (>= 60), ESPN has the correct aggregate but incomplete hole detail
          // (known ESPN data bug). Treat as finished rather than stuck mid-round.
          if (val >= 60) {
            today = dv || '--';
            thru = 'F';
          } else {
            // Genuinely on the course
            today = dv || 'E';
            thru = String(holes.length);
          }
        } else if (dv === '-' || val === 0) {
          // Current round not yet started for this player.
          // Check for an embedded tee time FIRST — this handles both Round 1 pre-play
          // and Round 2+ where the player hasn't teed off yet. If a tee time exists,
          // show it rather than falling through to the "between rounds" F logic, which
          // would incorrectly display yesterday's 'F' while Round 2 is actively in progress.
          const stats = currentRoundLs.statistics?.categories?.[0]?.stats || [];
          const teeTimeEntry = stats.length > 0 ? stats[stats.length - 1] : null;
          const hasTeeTime =
            teeTimeEntry?.displayValue && /\d{1,2}:\d{2}/.test(teeTimeEntry.displayValue);
          if (hasTeeTime) {
            today = '--';
            thru = formatTeeTime(teeTimeEntry.displayValue);
          } else {
            // No tee time published yet — could be between rounds before ESPN adds next-round data.
            const prevRoundLs = allLinescores.find((ls: any) => ls.period === currentRound - 1);
            const prevRoundHoles: any[] = prevRoundLs?.linescores || [];
            if (currentRound > 1 && prevRoundHoles.length === 18) {
              // Between rounds with no tee time: show previous round finished state.
              today = '--';
              thru = 'F';
            }
            // else: Round 1, no tee time in ESPN data — Leaderboard.tsx hardcoded fallback handles it.
          }
        }
      }

      // Fallback: no current-round linescore at all, but a previous round is complete.
      // This happens between rounds before ESPN populates the next round's placeholder entry.
      // today stays '--' — this player hasn't played today's round yet.
      if (today === '--' && thru === '--' && status === 'active' && currentRound > 1) {
        const prevRoundLs = allLinescores.find((ls: any) => ls.period === currentRound - 1);
        const prevRoundHoles: any[] = prevRoundLs?.linescores || [];
        if (prevRoundHoles.length === 18) {
          thru = 'F';
        }
      }

      return {
        id: athlete.id || c.id || String(order),
        name: athlete.displayName || athlete.fullName || 'Unknown',
        position: posDisplay,
        positionNum: order,
        score: typeof c.score === 'string' ? c.score : c.score?.displayValue || '--',
        today,
        thru,
        status,
        rounds,
      };
    });

    // If no cut detected via round presence, reset count
    if (!hasCut) cutPlayerCount = 0;

    // Sort: active by order, then cut players by order
    golfers.sort((a, b) => {
      if (a.status !== b.status) {
        const statusOrder = { active: 0, cut: 1, withdrawn: 2 };
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return a.positionNum - b.positionNum;
    });

    // Compute true tied positions: ESPN's `order` is sequential (1,2,3,4…) and ignores ties.
    // Group active golfers by score-to-par and assign each group the lowest order in that group.
    const scoreToMinPos = new Map<string, number>();
    for (const g of golfers) {
      if (g.status === 'active' && g.score !== '--') {
        const existing = scoreToMinPos.get(g.score);
        if (existing === undefined || g.positionNum < existing) {
          scoreToMinPos.set(g.score, g.positionNum);
        }
      }
    }
    for (const g of golfers) {
      if (g.status === 'active') {
        const truePos = scoreToMinPos.get(g.score) ?? g.positionNum;
        g.positionNum = truePos;
        g.position = String(truePos);
      }
    }

    return {
      id: event.id,
      name: event.name || event.shortName || 'PGA Tournament',
      golfers,
      cutPlayerCount: hasCut ? cutPlayerCount : 0,
      round: currentRound,
    };
  } catch (err) {
    console.error('ESPN API error:', err);
    return null;
  }
}

/** Is today a tournament day? (Thu=4, Fri=5, Sat=6, Sun=0) */
function isTournamentDay(): boolean {
  const day = new Date().getDay();
  return day === 0 || day === 4 || day === 5 || day === 6;
}

/** Hook — auto-refreshes every 5 minutes on tournament days */
export function useEspnLeaderboard() {
  const [data, setData] = useState<EspnTournamentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      const result = await fetchLeaderboard();
      if (mounted) {
        if (result) {
          setData(result);
          setLastUpdated(new Date());
        }
        setLoading(false);
      }
    };

    // Always fetch once immediately
    load();

    const startPolling = () => {
      if (interval) clearInterval(interval);
      if (isTournamentDay()) {
        interval = setInterval(load, 5 * 60 * 1000);
      }
    };

    startPolling();

    // Re-check tournament day at midnight to start/stop polling
    const midnightCheck = setInterval(() => {
      startPolling();
    }, 60 * 60 * 1000);

    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
      clearInterval(midnightCheck);
    };
  }, []);

  return { data, loading, lastUpdated };
}
