import { useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTournament, useTiers, useGolferScores, useEntries, useWithdrawalAlerts } from '../hooks/useTournament';
import { useEspnLeaderboard } from '../lib/espnApi';
import { calculateGolferPoints } from '../constants/scoring';
import TierBadge from '../components/common/TierBadge';
import { useNavigate } from 'react-router-dom';

function ordinal(n: number): string {
  const v = n % 100;
  const s = ['th', 'st', 'nd', 'rd'];
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default function MyEntries() {
  const { user } = useAuth();
  const { tournament } = useTournament();
  const { tiers } = useTiers(tournament?.id);
  const { scores } = useGolferScores(tournament?.id);
  const { entries } = useEntries(tournament?.id);
  const { alerts } = useWithdrawalAlerts(tournament?.id);
  const { data: espnData } = useEspnLeaderboard();
  const navigate = useNavigate();

  // Deadline logic
  const firstTeeTime = tournament?.firstTeeTime?.toDate();
  const teeTimePassed = firstTeeTime ? firstTeeTime.getTime() <= Date.now() : false;
  const isLocked = tournament?.picksLocked || teeTimePassed;

  // cutPlayerCount: null when no cut has happened yet (rounds 1-2 — no cap on points).
  // Priority: Firestore (locked by scraper) → ESPN live (R3+) → active+cut detected → null.
  const cutPlayerCount = useMemo((): number | null => {
    if (tournament?.cutPlayerCount && tournament.cutPlayerCount > 0) return tournament.cutPlayerCount;
    if (espnData && espnData.cutPlayerCount > 0) return espnData.cutPlayerCount;
    const activeInFirestore = scores.filter((s) => s.status === 'active').length;
    if (activeInFirestore > 0 && scores.some((s) => s.status === 'cut'))
      return activeInFirestore;
    return null; // No cut yet — no cap on points during rounds 1-2
  }, [espnData, scores, tournament?.cutPlayerCount]);

  // ESPN live position lookup by name (for active players only).
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

  const scoreMap = useMemo(() => {
    const map = new Map<string, { points: number; score: string; position: number | null; status: string }>();
    scores.forEach((s) => {
      const status = s.status as 'active' | 'cut' | 'withdrawn';
      const livePos = status === 'active' ? espnByName.get(s.name.toLowerCase().trim()) : undefined;
      const position = livePos ?? s.position;
      const points = calculateGolferPoints(position, status, cutPlayerCount);
      map.set(s.id, { points, score: s.score, position, status });
    });
    return map;
  }, [scores, espnByName, cutPlayerCount]);

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

  const myEntries = useMemo(() => {
    return entries
      .filter((e) => e.userId === user?.uid)
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
          score: scoreMap.get(id)?.score ?? '--',
          status: scoreMap.get(id)?.status ?? 'active',
        }));
        const totalScore = golferDetails.reduce((sum, g) => sum + g.points, 0);
        return { ...entry, golferDetails, totalScore };
      })
      .sort((a, b) => a.entryNumber - b.entryNumber);
  }, [entries, user, scoreMap, golferNameMap, golferTierMap]);

  // Pool position map: tie-aware positions across ALL entries (matches Pool Standings ranking)
  const poolPositionMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!isLocked) return map;
    const allScored = entries
      .map((entry) => {
        const pickIds = [
          entry.picks.tier1,
          entry.picks.tier2,
          entry.picks.tier3,
          entry.picks.tier4,
          entry.picks.tier5,
          entry.picks.tier6,
        ];
        const totalScore = pickIds.reduce((sum, id) => sum + (scoreMap.get(id)?.points ?? 0), 0);
        return { id: entry.id, totalScore };
      })
      .sort((a, b) => a.totalScore - b.totalScore);
    allScored.forEach((entry, idx) => {
      if (idx === 0 || entry.totalScore !== allScored[idx - 1].totalScore) {
        map.set(entry.id, idx + 1);
      } else {
        map.set(entry.id, map.get(allScored[idx - 1].id)!);
      }
    });
    return map;
  }, [entries, scoreMap, isLocked]);

  // Active WD alerts per entry — only shown when the entry still has the withdrawn golfer picked
  // and the swap deadline hasn't passed.
  const activeAlertsByEntry = useMemo(() => {
    const now = new Date();
    const map = new Map<string, Array<{ golferName: string; tierNumber: number; deadline: Date; alertId: string }>>();
    alerts.forEach((alert) => {
      if (alert.status !== 'active') return;
      const deadline = alert.swapDeadline?.toDate?.() || new Date(alert.swapDeadline as any);
      if (deadline <= now) return;
      alert.affectedEntryIds.forEach((entryId) => {
        const entry = entries.find((e) => e.id === entryId);
        if (!entry) return;
        // Only show alert if the entry still has the withdrawn golfer picked
        const tierKey = `tier${alert.tierNumber}` as keyof typeof entry.picks;
        if (entry.picks[tierKey] !== alert.golferId) return;
        if (!map.has(entryId)) map.set(entryId, []);
        map.get(entryId)!.push({
          golferName: alert.golferName,
          tierNumber: alert.tierNumber,
          deadline,
          alertId: alert.id,
        });
      });
    });
    return map;
  }, [alerts, entries]);

  if (!tournament) {
    return <div className="text-center py-12 text-gray-500">No active tournament.</div>;
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Entries</h1>
          <p className="text-gray-500 mt-1">
            {myEntries.length} entr{myEntries.length === 1 ? 'y' : 'ies'} submitted
          </p>
        </div>
        {!isLocked && (
          <button
            onClick={() => navigate('/draft')}
            className="bg-masters-green text-white px-4 py-2 rounded-lg font-semibold text-sm hover:bg-masters-dark transition"
          >
            + New Entry
          </button>
        )}
      </div>

      {!isLocked && myEntries.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-6 text-blue-800 text-sm">
          You can edit your picks until <span className="font-semibold">{deadlineStr}</span>.
          Your picks are hidden from other participants.
        </div>
      )}

      {isLocked && myEntries.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-6 text-green-800 text-sm font-medium">
          Picks are locked and visible to all participants.
        </div>
      )}

      {myEntries.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl shadow-sm">
          <span className="text-4xl">&#128203;</span>
          <p className="text-gray-500 mt-3">You haven't submitted any entries yet.</p>
          <button
            onClick={() => navigate('/draft')}
            className="mt-4 bg-masters-green text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-masters-dark transition"
          >
            Make Your Picks
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {myEntries.map((entry) => (
            <div
              key={entry.id}
              className={`bg-white rounded-xl shadow-sm overflow-hidden ${
                isLocked && (poolPositionMap.get(entry.id) ?? 0) <= 3
                  ? 'ring-2 ring-masters-yellow'
                  : ''
              }`}
            >
              {/* WD notification banners */}
              {activeAlertsByEntry.get(entry.id)?.map((alert) => {
                const deadlineStr =
                  alert.deadline.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
                  ' at ' +
                  alert.deadline.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                return (
                  <div
                    key={alert.alertId}
                    className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-start justify-between gap-3"
                  >
                    <div className="text-amber-800 text-sm">
                      <span className="font-semibold">{alert.golferName}</span> has withdrawn.
                      Please update your Tier {alert.tierNumber} pick before{' '}
                      <span className="font-semibold">{deadlineStr}</span>.
                    </div>
                    <button
                      onClick={() => navigate(`/draft?edit=${entry.id}&wdTier=${alert.tierNumber}`)}
                      className="shrink-0 bg-amber-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-amber-700 transition"
                    >
                      Update Pick
                    </button>
                  </div>
                );
              })}

              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  {isLocked && (() => {
                    const pos = poolPositionMap.get(entry.id) ?? 0;
                    return (
                      <span
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                          pos === 1
                            ? 'bg-masters-yellow text-gray-900'
                            : pos === 2
                              ? 'bg-gray-300 text-gray-700'
                              : pos === 3
                                ? 'bg-orange-300 text-gray-800'
                                : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {ordinal(pos)}
                      </span>
                    );
                  })()}
                  <div>
                    <span className="font-semibold text-gray-900">{entry.entryLabel}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          entry.paid
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {entry.paid ? 'Paid' : 'Unpaid'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {!isLocked && (
                    <button
                      onClick={() => navigate(`/draft?edit=${entry.id}`)}
                      className="text-masters-green text-sm font-semibold hover:underline"
                    >
                      Edit Picks
                    </button>
                  )}
                  <span className="text-xl font-bold text-masters-green">
                    {entry.totalScore || '--'}
                  </span>
                </div>
              </div>
              <div className="px-4 py-3 space-y-2">
                {entry.golferDetails.map((g) => (
                  <div key={g.id} className="flex items-center gap-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <TierBadge tierNumber={g.tier} size="sm" />
                      {g.status === 'withdrawn' ? (
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="text-gray-400 line-through truncate">{g.name}</span>
                          <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold shrink-0">WD</span>
                        </span>
                      ) : (
                        <span className="text-gray-700 truncate">{g.name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-gray-400 text-xs">{g.score}</span>
                      <span className="font-semibold text-gray-900 w-8 text-right">
                        {g.points || '--'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
