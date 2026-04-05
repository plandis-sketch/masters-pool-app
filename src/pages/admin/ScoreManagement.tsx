import { useState, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTournament, useTiers, useGolferScores, updateGolferScore } from '../../hooks/useTournament';
import { useEspnLeaderboard } from '../../lib/espnApi';
import { calculateGolferPoints, getMissedCutScore, golferHasStarted } from '../../constants/scoring';
import { Timestamp } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import TierBadge from '../../components/common/TierBadge';

export default function ScoreManagement() {
  const { user } = useAuth();
  const { tournament } = useTournament();
  const { tiers } = useTiers(tournament?.id);
  const { scores } = useGolferScores(tournament?.id);
  const { data: espnData } = useEspnLeaderboard();
  const navigate = useNavigate();

  // Same priority as all other views: ESPN first (authoritative), then Firestore.
  const cutPlayerCount = useMemo((): number | null => {
    if (espnData && espnData.cutPlayerCount > 0) return espnData.cutPlayerCount;
    if (tournament?.cutPlayerCount && tournament.cutPlayerCount > 0) return tournament.cutPlayerCount;
    return null;
  }, [espnData, tournament?.cutPlayerCount]);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  // Build editable score state
  const [edits, setEdits] = useState<Record<string, Partial<{
    position: string;
    score: string;
    today: string;
    thru: string;
    status: string;
  }>>>({});

  if (!user?.isAdmin) { navigate('/admin'); return null; }

  // All golfers from tiers with their current scores
  const allGolfers = useMemo(() => {
    const scoreMap = new Map(scores.map((s) => [s.id, s]));
    const golfers: { id: string; name: string; tierNumber: number; score: typeof scores[0] | null }[] = [];
    tiers.forEach((t) => {
      t.golfers.forEach((g) => {
        golfers.push({ id: g.id, name: g.name, tierNumber: t.tierNumber, score: scoreMap.get(g.id) || null });
      });
    });
    return golfers;
  }, [tiers, scores]);

  const handleSave = async (golferId: string, golferName: string) => {
    if (!tournament) return;
    setSaving(golferId);
    setMessage('');
    const edit = edits[golferId] || {};
    const existing = scores.find((s) => s.id === golferId);

    const position = edit.position !== undefined ? (edit.position ? parseInt(edit.position) : null) : existing?.position ?? null;
    const status = (edit.status || existing?.status || 'active') as 'active' | 'cut' | 'withdrawn';
    const points = calculateGolferPoints(position, status, cutPlayerCount);

    try {
      await updateGolferScore(tournament.id, golferId, {
        name: golferName,
        position,
        score: edit.score ?? existing?.score ?? '--',
        today: edit.today ?? existing?.today ?? '--',
        thru: edit.thru ?? existing?.thru ?? '--',
        status,
        points,
        roundScores: existing?.roundScores ?? { r1: null, r2: null, r3: null, r4: null },
        lastUpdated: Timestamp.now(),
        source: 'manual',
      });
      setMessage(`Updated ${golferName}`);
      // Clear edit for this golfer
      setEdits((prev) => { const next = { ...prev }; delete next[golferId]; return next; });
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    }
    setSaving(null);
  };

  const handleBulkSave = async () => {
    if (!tournament) return;
    setSaving('bulk');
    for (const golfer of allGolfers) {
      if (edits[golfer.id]) {
        await handleSave(golfer.id, golfer.name);
      }
    }
    setSaving(null);
    setMessage('All changes saved!');
  };

  const updateEdit = (golferId: string, field: string, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [golferId]: { ...prev[golferId], [field]: value },
    }));
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Score Management</h1>
        <nav className="flex gap-2 text-sm">
          <Link to="/admin/tournament" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Setup</Link>
          <Link to="/admin/payments" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Payments</Link>
          <Link to="/admin/picks" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Pick Overrides</Link>
          <Link to="/admin/participants" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Participants</Link>
        </nav>
      </div>

      {cutPlayerCount ? (
        <div className="mb-4 p-3 rounded-lg text-sm font-medium bg-blue-50 text-blue-700">
          Cut locked: {cutPlayerCount} made the cut · Missed cut score = {getMissedCutScore(cutPlayerCount)}
        </div>
      ) : null}

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${message.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
          <span className="text-sm text-gray-500">{allGolfers.length} golfers across {tiers.length} tiers</span>
          <button
            onClick={handleBulkSave}
            disabled={saving !== null || Object.keys(edits).length === 0}
            className="bg-masters-green text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-masters-dark transition disabled:opacity-50"
          >
            Save All Changes
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-masters-green text-white">
              <tr>
                <th className="text-left px-3 py-2">Tier</th>
                <th className="text-left px-3 py-2">Golfer</th>
                <th className="text-center px-3 py-2 w-20">Pos</th>
                <th className="text-center px-3 py-2 w-20">Score</th>
                <th className="text-center px-3 py-2 w-20">Today</th>
                <th className="text-center px-3 py-2 w-20">Thru</th>
                <th className="text-center px-3 py-2 w-24">Status</th>
                <th className="text-center px-3 py-2 w-16">Pts</th>
                <th className="px-3 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {allGolfers.map((g) => {
                const edit = edits[g.id] || {};
                const existing = g.score;
                return (
                  <tr key={g.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2"><TierBadge tierNumber={g.tierNumber} size="sm" /></td>
                    <td className="px-3 py-2 font-medium">{g.name}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={edit.position ?? existing?.position?.toString() ?? ''}
                        onChange={(e) => updateEdit(g.id, 'position', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-center text-sm"
                        placeholder="--"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={edit.score ?? existing?.score ?? ''}
                        onChange={(e) => updateEdit(g.id, 'score', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-center text-sm"
                        placeholder="E"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={edit.today ?? existing?.today ?? ''}
                        onChange={(e) => updateEdit(g.id, 'today', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-center text-sm"
                        placeholder="--"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={edit.thru ?? existing?.thru ?? ''}
                        onChange={(e) => updateEdit(g.id, 'thru', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-center text-sm"
                        placeholder="F"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={edit.status ?? existing?.status ?? 'active'}
                        onChange={(e) => updateEdit(g.id, 'status', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
                      >
                        <option value="active">Active</option>
                        <option value="cut">Cut</option>
                        <option value="withdrawn">WD</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center font-bold text-masters-green">
                      {existing
                        ? (existing.status !== 'active' || golferHasStarted(existing.thru))
                          ? calculateGolferPoints(existing.position, existing.status, cutPlayerCount)
                          : '--'
                        : '--'}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => handleSave(g.id, g.name)}
                        disabled={saving === g.id || !edits[g.id]}
                        className="text-masters-green hover:underline text-xs font-semibold disabled:opacity-30"
                      >
                        {saving === g.id ? '...' : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
