import { useState, useEffect } from 'react';

export interface EspnGolfer {
  id: string;
  name: string;
  position: string;
  positionNum: number | null;
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

const ESPN_GOLF_URL =
  'https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard';

export async function fetchLeaderboard(): Promise<EspnTournamentData | null> {
  try {
    const res = await fetch(ESPN_GOLF_URL);
    if (!res.ok) return null;
    const data = await res.json();

    const event = data.events?.[0];
    if (!event) return null;

    const competition = event.competitions?.[0];
    const competitors = competition?.competitors || [];
    const currentRound = competition?.status?.period || 1;

    const golfers: EspnGolfer[] = competitors.map((c: any) => {
      const athlete = c.athlete || {};
      const statusType = (c.status?.type?.name || '') as string;

      let status: EspnGolfer['status'] = 'active';
      if (statusType.includes('CUT')) status = 'cut';
      else if (statusType.includes('WITHDRAW') || statusType.includes('DISQUALIF'))
        status = 'withdrawn';

      const posDisplay = c.status?.position?.displayName || '--';
      const posNum = parseInt(String(posDisplay).replace(/^T/, '')) || null;

      const rounds: string[] = (c.linescores || []).map(
        (ls: any) => ls.displayValue || '--'
      );

      // Try "today" from statistics, then fall back to latest round
      let today = '--';
      const stats: any[] = c.statistics || [];
      for (const stat of stats) {
        if (
          stat.name === 'currentRound' ||
          stat.name === 'today' ||
          stat.name === 'todayScore'
        ) {
          today = stat.displayValue || '--';
          break;
        }
      }

      // Thru
      let thru = '--';
      if (c.status?.thru !== undefined && c.status?.thru !== null) {
        thru = c.status.thru >= 18 ? 'F' : String(c.status.thru);
      } else if (c.status?.displayValue) {
        thru = c.status.displayValue;
      }

      return {
        id: athlete.id || c.id || '',
        name: athlete.displayName || 'Unknown',
        position: posDisplay,
        positionNum: posNum,
        score: c.score?.displayValue || '--',
        today,
        thru: status !== 'active' ? '--' : thru,
        status,
        rounds,
      };
    });

    // Sort: active by position, then cut, then withdrawn
    golfers.sort((a, b) => {
      if (a.status !== b.status) {
        const order = { active: 0, cut: 1, withdrawn: 2 };
        return order[a.status] - order[b.status];
      }
      return (a.positionNum ?? 999) - (b.positionNum ?? 999);
    });

    const hasCut = golfers.some((g) => g.status === 'cut');
    const activeCount = golfers.filter((g) => g.status === 'active').length;

    return {
      id: event.id,
      name: event.name || 'PGA Tournament',
      golfers,
      cutPlayerCount: hasCut ? activeCount : 0,
      round: currentRound,
    };
  } catch (err) {
    console.error('ESPN API error:', err);
    return null;
  }
}

/** Hook — auto-refreshes every 2 minutes */
export function useEspnLeaderboard() {
  const [data, setData] = useState<EspnTournamentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const result = await fetchLeaderboard();
      if (mounted) {
        setData(result);
        setLoading(false);
      }
    };

    load();
    const interval = setInterval(load, 2 * 60 * 1000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return { data, loading };
}
