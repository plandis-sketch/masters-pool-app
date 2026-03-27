import { useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTournament, useTiers, useGolferScores, useEntries } from '../hooks/useTournament';
import { useEspnLeaderboard } from '../lib/espnApi';
import { calculateGolferPoints } from '../constants/scoring';
import TierBadge from '../components/common/TierBadge';
import { useNavigate } from 'react-router-dom';

export default function MyEntries() {
  const { user } = useAuth();
  const { tournament } = useTournament();
  const { tiers } = useTiers(tournament?.id);
  const { scores } = useGolferScores(tournament?.id);
  const { entries } = useEntries(tournament?.id);
  const { data: espnData } = useEspnLeaderboard();
  const navigate = useNavigate();

  // Deadline logic
  const firstTeeTime = tournament?.firstTeeTime?.toDate();
  const teeTimePassed = firstTeeTime ? firstTeeTime.getTime() <= Date.now() : false;
  const isLocked = tournament?.picksLocked || teeTimePassed;

  // Auto-calculate cutPlayerCount
  const cutPlayerCount = useMemo(() => {
    if (espnData && espnData.cutPlayerCount > 0) return espnData.cutPlayerCount;
    const activeInFirestore = scores.filter((s) => s.status === 'active').length;
    if (activeInFirestore > 0 && scores.some((s) => s.status === 'cut'))
      return activeInFirestore;
    return tournament?.cutPlayerCount ?? 50;
  }, [espnData, scores, tournament?.cutPlayerCount]);

  const scoreMap = useMemo(() => {
    const map = new Map<string, { points: number; score: string; position: number | null }>();
    scores.forEach((s) => {
      const points = calculateGolferPoints(s.position, s.status, cutPlayerCount);
      map.set(s.id, { points, score: s.score, position: s.position });
    });
    return map;
  }, [scores, cutPlayerCount]);

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
        }));
        const totalScore = golferDetails.reduce((sum, g) => sum + g.points, 0);
        return { ...entry, golferDetails, totalScore };
      })
      .sort((a, b) => a.entryNumber - b.entryNumber);
  }, [entries, user, scoreMap, golferNameMap, golferTierMap]);

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
            <div key={entry.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-gray-900">{entry.entryLabel}</span>
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
                  <div key={g.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <TierBadge tierNumber={g.tier} size="sm" />
                      <span className="text-gray-700">{g.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
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
