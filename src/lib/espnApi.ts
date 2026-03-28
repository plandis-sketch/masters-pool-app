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

export async function fetchLeaderboard(): Promise<EspnTournamentData | null> {
  try {
    const res = await fetch(ESPN_SCOREBOARD_URL);
    if (!res.ok) return null;
    const data = await res.json();

    // Find the current/in-progress event
    const events = data.events || [];
    const event =
      events.find((e: any) => e.status?.type?.state === 'in') ||
      events.find((e: any) => e.status?.type?.state === 'post') ||
      events[0];
    if (!event) return null;

    const comp = event.competitions?.[0];
    const competitors: any[] = comp?.competitors || [];
    if (competitors.length === 0) return null;

    // Determine current round from the max linescores among active players
    const maxRounds = Math.max(...competitors.map((c: any) => c.linescores?.length || 0));

    // Detect if a cut has been made:
    // After round 2+, players with fewer rounds than the leaders missed the cut.
    // Cut players have exactly 2 rounds while leaders have 3 or 4.
    const hasCut = maxRounds >= 3;
    const madeCutPlayers = hasCut
      ? competitors.filter((c: any) => (c.linescores?.length || 0) >= 3)
      : competitors;
    const cutPlayerCount = hasCut ? madeCutPlayers.length : 0;

    const golfers: EspnGolfer[] = competitors.map((c: any) => {
      const athlete = c.athlete || {};
      const roundsPlayed = c.linescores?.length || 0;

      // Determine status from round count
      let status: EspnGolfer['status'] = 'active';
      if (hasCut && roundsPlayed < 3) {
        status = 'cut';
      }

      // Position: use `order` field from ESPN (1-based ranking)
      const order: number = c.order || 999;

      // Build position display string with tie handling
      // ESPN `order` is the sorted rank; for ties, multiple players share the same score
      const posDisplay = status === 'cut' ? 'CUT' : String(order);

      // Round scores (displayValue is score-to-par per round, e.g. "-6", "+2")
      const rounds: string[] = (c.linescores || []).map(
        (ls: any) => ls.displayValue || '--'
      );

      // "Today" = latest round score-to-par
      const today = rounds.length > 0 ? rounds[rounds.length - 1] : '--';

      // "Thru" — scoreboard doesn't provide mid-round progress, so show F if round complete
      const thru = status === 'cut' ? '--' : 'F';

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

    // Sort: active by order, then cut players by order
    golfers.sort((a, b) => {
      if (a.status !== b.status) {
        const statusOrder = { active: 0, cut: 1, withdrawn: 2 };
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return a.positionNum - b.positionNum;
    });

    return {
      id: event.id,
      name: event.name || event.shortName || 'PGA Tournament',
      golfers,
      cutPlayerCount,
      round: maxRounds,
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
