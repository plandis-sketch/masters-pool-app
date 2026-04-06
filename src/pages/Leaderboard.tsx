import { useState, useMemo } from 'react';
import { useTournament, useTiers, useGolferScores, useEntries } from '../hooks/useTournament';
import { useAuth } from '../hooks/useAuth';
import { useEspnLeaderboard } from '../lib/espnApi';
import { calculateGolferPoints, golferHasStarted } from '../constants/scoring';
import TierBadge from '../components/common/TierBadge';

type Tab = 'pool' | 'golfers';

export default function Leaderboard() {
  const [tab, setTab] = useState<Tab>('pool');
  const { user } = useAuth();
  const { tournament } = useTournament();
  const { tiers } = useTiers(tournament?.id);
  const { scores } = useGolferScores(tournament?.id);
  const { entries } = useEntries(tournament?.id);
  const { data: espnData, loading: espnLoading, lastUpdated } = useEspnLeaderboard();

  // Deadline logic
  const firstTeeTime = tournament?.firstTeeTime?.toDate();
  const picksRevealed =
    tournament?.picksLocked || (firstTeeTime ? firstTeeTime.getTime() <= Date.now() : false);

  // cutPlayerCount: null when no cut has happened yet (rounds 1-2 — no cap on points).
  // Priority: ESPN live (authoritative count of who made cut) → Firestore → detect from scores → null.
  // ESPN is checked first because the scraper may have locked a slightly wrong count in Firestore
  // (it counted active competitors at lock time; ESPN's cutPlayerCount reflects the finalized number).
  const cutPlayerCount = useMemo((): number | null => {
    if (espnData && espnData.cutPlayerCount > 0) return espnData.cutPlayerCount;
    if (tournament?.cutPlayerCount && tournament.cutPlayerCount > 0) return tournament.cutPlayerCount;
    const activeInFirestore = scores.filter((s) => s.status === 'active').length;
    if (activeInFirestore > 0 && scores.some((s) => s.status === 'cut'))
      return activeInFirestore;
    return null; // No cut yet — no cap on points during rounds 1-2
  }, [espnData, scores, tournament?.cutPlayerCount]);

  // ESPN live position and thru lookup by name (for active players only).
  // Used to keep Pool Standings in sync with the live Golfer Leaderboard tab.
  const espnByName = useMemo(() => {
    const map = new Map<string, number>();
    if (!espnData) return map;
    espnData.golfers.forEach((g) => {
      if (g.status === 'active') {
        map.set(g.name.toLowerCase().trim(), g.positionNum);
      }
    });
    return map;
  }, [espnData]);

  const espnThruByName = useMemo(() => {
    const map = new Map<string, string>();
    if (!espnData) return map;
    espnData.golfers.forEach((g) => {
      if (g.status === 'active') {
        map.set(g.name.toLowerCase().trim(), g.thru);
      }
    });
    return map;
  }, [espnData]);

  // Build maps from Firestore data, merging live ESPN positions for active players.
  // Firestore status is authoritative (cut/WD locks are permanent).
  // For active players, ESPN positionNum overrides Firestore position (eliminates 5-min lag).
  // "Not started" (no points / '--') only applies in Round 1 before a golfer's first tee time.
  // On Round 2+, all active golfers have a valid tournament position and always receive points.
  const isRound1 = !espnData || espnData.round <= 1;
  const scoreMap = useMemo(() => {
    const map = new Map<
      string,
      { points: number; score: string; position: number | null; status: string; hasStarted: boolean }
    >();
    scores.forEach((s) => {
      const status = s.status as 'active' | 'cut' | 'withdrawn';
      const livePos = status === 'active' ? espnByName.get(s.name.toLowerCase().trim()) : undefined;
      const position = livePos ?? s.position;
      const liveThru = status === 'active' ? espnThruByName.get(s.name.toLowerCase().trim()) : undefined;
      const thru = liveThru ?? s.thru;
      // Cut/withdrawn always count. Active golfers only show '--' on Round 1 before teeing off.
      // On Round 2+, all active golfers have a valid position and always receive points.
      const hasStarted = status !== 'active' || !isRound1 || golferHasStarted(thru);
      const points = hasStarted ? calculateGolferPoints(position, status, cutPlayerCount) : 0;
      map.set(s.id, { points, score: s.score, position, status, hasStarted });
    });
    return map;
  }, [scores, espnByName, espnThruByName, cutPlayerCount, isRound1]);

  const golferNameMap = useMemo(() => {
    const map = new Map<string, string>();
    tiers.forEach((t) => t.golfers.forEach((g) => map.set(g.id, g.name)));
    return map;
  }, [tiers]);

  const golferTierMap = useMemo(() => {
    const map = new Map<string, number>();
    tiers.forEach((t) => t.golfers.forEach((g) => map.set(g.id, t.tierNumber)));
    return map;
  }, [tiers]);

  // Filter entries: admins always see all, regular users blinded before deadline
  const visibleEntries = useMemo(() => {
    if (picksRevealed || user?.isAdmin) return entries;
    return entries.filter((e) => e.userId === user?.uid);
  }, [entries, picksRevealed, user?.isAdmin, user?.uid]);

  // Calculate entry totals with dynamic cutPlayerCount
  const rankedEntries = useMemo(() => {
    return visibleEntries
      .map((entry) => {
        const pickIds = [
          entry.picks.tier1,
          entry.picks.tier2,
          entry.picks.tier3,
          entry.picks.tier4,
          entry.picks.tier5,
          entry.picks.tier6,
        ];
        const golferDetails = pickIds.map((id) => ({
          id,
          name: golferNameMap.get(id) || 'Unknown',
          tier: golferTierMap.get(id) || 0,
          points: scoreMap.get(id)?.points ?? 0,
          hasStarted: scoreMap.get(id)?.hasStarted ?? false,
          score: scoreMap.get(id)?.score ?? '--',
          position: scoreMap.get(id)?.position ?? null,
        }));
        const totalScore = golferDetails.reduce((sum, g) => sum + g.points, 0);
        const notStartedCount = golferDetails.filter((g) => !g.hasStarted).length;
        return { ...entry, golferDetails, totalScore, notStartedCount };
      })
      .sort((a, b) => a.totalScore - b.totalScore);
  }, [visibleEntries, scoreMap, golferNameMap, golferTierMap]);

  // Tie-aware display positions for Pool Standings
  const rankedPositions = useMemo(() => {
    const positions: number[] = [];
    rankedEntries.forEach((entry, idx) => {
      if (idx === 0 || entry.totalScore !== rankedEntries[idx - 1].totalScore) {
        positions.push(idx + 1);
      } else {
        positions.push(positions[idx - 1]);
      }
    });
    return positions;
  }, [rankedEntries]);

  // ESPN golfer data with pool points.
  // Only show null/-- for active golfers on Round 1 who haven't teed off yet.
  // On Round 2+, all active golfers have a valid position and always receive points.
  // Uses the same cutPlayerCount as Pool Standings — single source of truth.
  const espnGolfers = useMemo(() => {
    if (!espnData) return [];
    const espnIsRound1 = espnData.round <= 1;
    return espnData.golfers.map((g) => {
      const hasStarted = g.status !== 'active' || !espnIsRound1 || golferHasStarted(g.thru);
      return {
        ...g,
        poolPoints: hasStarted ? calculateGolferPoints(g.positionNum, g.status, cutPlayerCount) : null,
      };
    });
  }, [espnData, cutPlayerCount]);

  if (!tournament) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No active tournament.</p>
      </div>
    );
  }

  const deadlineStr = firstTeeTime
    ? firstTeeTime.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }) +
      ' at ' +
      firstTeeTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : 'the first tee time on Thursday';

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{tournament.name}</h1>
        <p className="text-gray-500 mt-1">
          {tournament.status === 'in_progress'
            ? `Round ${tournament.currentRound} — Live Leaderboard`
            : tournament.status === 'complete'
              ? 'Final Results'
              : 'Waiting for tournament to start'}
        </p>
      </div>

      {/* Blinded / Revealed banner */}
      {!picksRevealed && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-blue-800 text-sm">
          <p className="font-semibold">Picks are hidden until {deadlineStr}</p>
          <p className="mt-1 text-blue-600">
            Only your entries are shown below. All picks will be revealed once the tournament
            begins.
            {entries.length > 0 && ` (${entries.length} total entries submitted)`}
          </p>
        </div>
      )}

      {picksRevealed && tournament.status !== 'setup' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-6 text-green-800 text-sm font-medium">
          All picks are locked and visible. {entries.length} entries in the pool.
        </div>
      )}

      {/* Tab selector */}
      <div className="flex bg-white rounded-xl shadow-sm p-1 mb-6">
        <button
          onClick={() => setTab('pool')}
          className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition ${
            tab === 'pool'
              ? 'bg-masters-green text-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Pool Standings
        </button>
        <button
          onClick={() => setTab('golfers')}
          className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition ${
            tab === 'golfers'
              ? 'bg-masters-green text-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Golfer Leaderboard
        </button>
      </div>

      {tab === 'pool' ? (
        <div className="space-y-3">
          {rankedEntries.length === 0 ? (
            <p className="text-center text-gray-400 py-8">
              {picksRevealed
                ? 'No entries yet.'
                : "You haven't submitted any entries yet. Head to the Draft page to make your picks!"}
            </p>
          ) : (
            rankedEntries.map((entry, idx) => {
              const pos = rankedPositions[idx];
              const isTop3 = pos <= 3 && picksRevealed;
              return (
                <div
                  key={entry.id}
                  className={`bg-white rounded-xl shadow-sm overflow-hidden ${
                    isTop3 ? 'ring-2 ring-masters-yellow' : ''
                  }`}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                      {picksRevealed && (
                        <span
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                            pos === 1
                              ? 'bg-masters-yellow text-gray-900'
                              : pos === 2
                                ? 'bg-gray-300 text-gray-700'
                                : pos === 3
                                  ? 'bg-orange-300 text-gray-800'
                                  : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {pos}
                        </span>
                      )}
                      <div>
                        <span className="font-semibold text-gray-900">{entry.entryLabel}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xl font-bold text-masters-green">
                        {entry.totalScore || '--'}
                      </span>
                      {entry.notStartedCount > 0 && (
                        <div className="text-xs text-gray-400">
                          {6 - entry.notStartedCount}/6 started
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="px-4 py-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                    {entry.golferDetails.map((g) => (
                      <div key={g.id} className="flex items-center gap-1.5 text-gray-600 min-w-0">
                        <TierBadge tierNumber={g.tier} size="sm" />
                        <span className="truncate min-w-0 flex-1">{g.name}</span>
                        <span className="font-semibold text-gray-900 shrink-0">
                          {g.hasStarted ? (g.points || '--') : '--'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* ── Golfer Leaderboard (ESPN full field) ── */
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {espnLoading ? (
            <div className="text-center py-12">
              <span className="text-3xl animate-pulse">&#9971;</span>
              <p className="text-gray-400 mt-3">Loading tournament leaderboard...</p>
            </div>
          ) : !espnData || espnData.golfers.length === 0 ? (
            /* Pre-tournament: show full pool roster from tiers + full-field extras with blank scoring */
            (() => {
              const tierGolferIds = new Set(tiers.flatMap((t) => t.golfers.map((g) => g.id)));
              const allTierGolfers = tiers
                .flatMap((t) => t.golfers.map((g) => ({ ...g, tierNumber: t.tierNumber })))
                .sort((a, b) => {
                  const aWD = scoreMap.get(a.id)?.status === 'withdrawn' ? 1 : 0;
                  const bWD = scoreMap.get(b.id)?.status === 'withdrawn' ? 1 : 0;
                  return aWD - bWD;
                });
              const nonTierGolfers = scores.filter((s) => !tierGolferIds.has(s.id));
              if (allTierGolfers.length === 0 && nonTierGolfers.length === 0) return null;
              const totalField = allTierGolfers.length + nonTierGolfers.length;
              return (
                <>
                  <div className="px-4 py-2 bg-gray-50 border-b text-xs text-gray-500 flex justify-between items-center">
                    <span>{tournament.name} &mdash; {totalField} golfers ({allTierGolfers.length} in pool)</span>
                    <span className="text-gray-400">Tee times TBA &mdash; scores will appear once Round 1 begins</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-masters-green text-white">
                        <tr>
                          <th className="text-left px-4 py-3">#</th>
                          <th className="text-left px-4 py-3">Golfer</th>
                          <th className="text-center px-4 py-3">Score</th>
                          <th className="text-center px-4 py-3">Today</th>
                          <th className="text-center px-4 py-3">Thru</th>
                          <th className="text-center px-4 py-3">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allTierGolfers.map((g, idx) => {
                          const golferStatus = scoreMap.get(g.id)?.status;
                          const isWD = golferStatus === 'withdrawn';
                          return (
                            <tr
                              key={g.id}
                              className={isWD ? 'bg-gray-50 border-b border-gray-100 text-gray-400' : idx % 2 === 0 ? 'bg-white border-b border-gray-100' : 'bg-gray-50 border-b border-gray-100'}
                            >
                              <td className="px-4 py-2.5 font-semibold text-gray-400">
                                {isWD ? 'WD' : idx + 1}
                              </td>
                              <td className="px-4 py-2.5 font-medium">
                                {isWD ? (
                                  <span className="flex items-center gap-2">
                                    <span className="line-through text-gray-400">{g.name}</span>
                                    <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold">WD</span>
                                  </span>
                                ) : (
                                  <span className="text-gray-900">{g.name}</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-center text-gray-400">--</td>
                              <td className="px-4 py-2.5 text-center text-gray-400">--</td>
                              <td className="px-4 py-2.5 text-center text-gray-400">--</td>
                              <td className="px-4 py-2.5 text-center text-gray-400">--</td>
                            </tr>
                          );
                        })}
                        {nonTierGolfers.length > 0 && (
                          <>
                            <tr className="bg-gray-100 border-b border-gray-200">
                              <td colSpan={6} className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                Additional Field — not in pool tiers
                              </td>
                            </tr>
                            {nonTierGolfers.map((g, idx) => (
                              <tr
                                key={g.id}
                                className={idx % 2 === 0 ? 'bg-white border-b border-gray-100' : 'bg-gray-50 border-b border-gray-100'}
                              >
                                <td className="px-4 py-2.5 font-semibold text-gray-300">—</td>
                                <td className="px-4 py-2.5 font-medium text-gray-500">{g.name}</td>
                                <td className="px-4 py-2.5 text-center text-gray-400">--</td>
                                <td className="px-4 py-2.5 text-center text-gray-400">--</td>
                                <td className="px-4 py-2.5 text-center text-gray-400">--</td>
                                <td className="px-4 py-2.5 text-center text-gray-300">—</td>
                              </tr>
                            ))}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()
          ) : (
            <>
              <div className="px-4 py-2 bg-gray-50 border-b text-xs text-gray-500 flex justify-between items-center">
                <span>
                  {espnData.name} &mdash; {espnData.golfers.length} golfers
                  {espnData.cutPlayerCount > 0 &&
                    ` \u2022 ${espnData.cutPlayerCount} made the cut`}
                </span>
                {lastUpdated && (
                  <span className="text-gray-400">
                    Updated {lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-masters-green text-white">
                    <tr>
                      <th className="text-left px-4 py-3">Pos</th>
                      <th className="text-left px-4 py-3">Golfer</th>
                      <th className="text-center px-4 py-3">Score</th>
                      <th className="text-center px-4 py-3">Today</th>
                      <th className="text-center px-4 py-3">Thru</th>
                      <th className="text-center px-4 py-3">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {espnGolfers.map((g, idx) => (
                      <tr
                        key={g.id + idx}
                        className={`border-b border-gray-100 ${
                          g.status === 'cut'
                            ? 'bg-red-50/50 text-gray-400'
                            : g.status === 'withdrawn'
                              ? 'bg-gray-50 text-gray-400'
                              : idx % 2 === 0
                                ? 'bg-white'
                                : 'bg-gray-50'
                        }`}
                      >
                        <td className="px-4 py-2.5 font-semibold">
                          {g.status === 'cut'
                            ? 'CUT'
                            : g.status === 'withdrawn'
                              ? 'WD'
                              : g.position}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-gray-900">{g.name}</td>
                        <td className="px-4 py-2.5 text-center">{g.score}</td>
                        <td className="px-4 py-2.5 text-center">{g.today}</td>
                        <td className="px-4 py-2.5 text-center">{g.thru}</td>
                        <td className="px-4 py-2.5 text-center font-bold text-masters-green">
                          {g.poolPoints === null ? '--' : g.poolPoints}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
