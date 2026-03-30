import { useState, useMemo } from 'react';
import { useTournament, useDailyLeaderboards } from '../hooks/useTournament';

const DAY_LABELS = ['Day 1', 'Day 2', 'Day 3', 'Final Day'];
const DAY_DESCRIPTIONS = [
  "Day 1 results will be posted at the conclusion of Thursday's round.",
  "Day 2 results will be posted at the conclusion of Friday's round.",
  "Day 3 results will be posted at the conclusion of Saturday's round.",
  "Final Day results will be posted at the conclusion of Sunday's round.",
];

export default function DailyLeaderboard() {
  const { tournament } = useTournament();
  const { dailyLeaderboards, loading } = useDailyLeaderboards(tournament?.id);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);

  // Find the latest finalized round to auto-select
  const latestRound = useMemo(() => {
    if (dailyLeaderboards.length === 0) return 0;
    return Math.max(...dailyLeaderboards.map((d) => d.round));
  }, [dailyLeaderboards]);

  const activeRound = selectedRound ?? (latestRound || 1);

  const currentSnapshot = useMemo(() => {
    return dailyLeaderboards.find((d) => d.round === activeRound) || null;
  }, [dailyLeaderboards, activeRound]);

  if (!tournament) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No active tournament.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Daily Leaderboard</h1>
        <p className="text-gray-500 mt-1">Top 10 standings at the end of each round</p>
      </div>

      {/* Round tabs */}
      <div className="grid grid-cols-4 bg-white rounded-xl shadow-sm p-1 mb-6">
        {DAY_LABELS.map((label, idx) => {
          const round = idx + 1;
          const hasData = dailyLeaderboards.some((d) => d.round === round);
          return (
            <button
              key={round}
              onClick={() => setSelectedRound(round)}
              className={`py-2.5 rounded-lg font-semibold text-sm transition ${
                activeRound === round
                  ? 'bg-masters-green text-white'
                  : hasData
                    ? 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                    : 'text-gray-400 hover:text-gray-500'
              }`}
            >
              {label}
              {hasData && activeRound !== round && (
                <span className="ml-1 text-xs text-green-500">&#10003;</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-12">
          <span className="text-3xl animate-pulse">&#9971;</span>
          <p className="text-gray-400 mt-3">Loading...</p>
        </div>
      ) : !currentSnapshot ? (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center">
          <span className="text-4xl">&#128197;</span>
          <p className="text-gray-500 mt-3">{DAY_DESCRIPTIONS[activeRound - 1]}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="px-2 text-xs text-gray-400 flex justify-between">
            <span>
              {DAY_LABELS[activeRound - 1]} &mdash; Top {Math.min(10, currentSnapshot.standings.length)}
            </span>
            <span>
              Finalized{' '}
              {currentSnapshot.snapshotAt?.toDate
                ? currentSnapshot.snapshotAt.toDate().toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                : ''}
            </span>
          </div>

          {currentSnapshot.standings.map((entry, idx) => {
            const isTop3 = idx < 3;
            return (
              <div
                key={entry.entryId}
                className={`bg-white rounded-xl shadow-sm overflow-hidden ${
                  isTop3 ? 'ring-2 ring-masters-yellow' : ''
                }`}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        idx === 0
                          ? 'bg-masters-yellow text-gray-900'
                          : idx === 1
                            ? 'bg-gray-300 text-gray-700'
                            : idx === 2
                              ? 'bg-orange-300 text-gray-800'
                              : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span className="font-semibold text-gray-900">{entry.entryLabel}</span>
                  </div>
                  <span className="text-xl font-bold text-masters-green">
                    {entry.totalScore}
                  </span>
                </div>
                <div className="px-4 py-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                  {entry.golfers.map((g) => (
                    <div key={g.id} className="flex items-center gap-1.5 text-gray-600">
                      <span className="truncate">{g.name}</span>
                      <span className="font-semibold text-gray-900 ml-auto">
                        {g.points}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
