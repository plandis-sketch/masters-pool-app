import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTournament, useTiers, createTournament, updateTournament, saveTier } from '../../hooks/useTournament';
import { Timestamp } from 'firebase/firestore';
import { TIER_COLORS, PAYMENT_METHODS, ENTRY_FEE } from '../../constants/theme';
import { Link, useNavigate } from 'react-router-dom';

export default function TournamentSetup() {
  const { user } = useAuth();
  const { tournament } = useTournament();
  const { tiers } = useTiers(tournament?.id);
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [firstTeeTime, setFirstTeeTime] = useState('');
  const [cutLine, setCutLine] = useState('');
  const [cutPlayerCount, setCutPlayerCount] = useState('');
  const [status, setStatus] = useState<string>('setup');
  const [currentRound, setCurrentRound] = useState(1);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Tier editor state
  const [tierData, setTierData] = useState<{ tierNumber: number; label: string; golfers: string }[]>([]);

  useEffect(() => {
    if (tournament) {
      setName(tournament.name);
      setStatus(tournament.status);
      setCurrentRound(tournament.currentRound);
      setCutLine(tournament.cutLine?.toString() || '');
      setCutPlayerCount(tournament.cutPlayerCount?.toString() || '');
      // Dates would need conversion from Timestamp
    }
  }, [tournament]);

  useEffect(() => {
    if (tiers.length > 0) {
      setTierData(
        tiers.map((t) => ({
          tierNumber: t.tierNumber,
          label: t.label,
          golfers: t.golfers.map((g) => g.name).join('\n'),
        }))
      );
    } else {
      // Default 6 empty tiers
      setTierData(
        Array.from({ length: 6 }, (_, i) => ({
          tierNumber: i + 1,
          label: TIER_COLORS[i]?.label || `Tier ${i + 1}`,
          golfers: '',
        }))
      );
    }
  }, [tiers]);

  if (!user?.isAdmin) {
    navigate('/admin');
    return null;
  }

  const handleSaveTournament = async () => {
    setSaving(true);
    setMessage('');
    try {
      const data = {
        name: name || 'The Masters 2026',
        dates: {
          start: startDate ? Timestamp.fromDate(new Date(startDate)) : Timestamp.now(),
          end: endDate ? Timestamp.fromDate(new Date(endDate)) : Timestamp.now(),
        },
        firstTeeTime: firstTeeTime ? Timestamp.fromDate(new Date(firstTeeTime)) : Timestamp.now(),
        cutLine: cutLine ? parseInt(cutLine) : null,
        cutPlayerCount: cutPlayerCount ? parseInt(cutPlayerCount) : null,
        picksLocked: false,
        currentRound,
        prizeStructure: [],
        paymentMethods: { ...PAYMENT_METHODS },
        entryFee: ENTRY_FEE,
        status: status as Tournament['status'],
      };

      if (tournament) {
        await updateTournament(tournament.id, data);
      } else {
        await createTournament(data as any);
      }
      setMessage('Tournament saved!');
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    }
    setSaving(false);
  };

  const handleSaveTiers = async () => {
    if (!tournament) { setMessage('Save tournament first.'); return; }
    setSaving(true);
    setMessage('');
    try {
      for (const td of tierData) {
        const golferNames = td.golfers
          .split('\n')
          .map((n) => n.trim())
          .filter(Boolean);
        const golfers = golferNames.map((name, idx) => ({
          id: `t${td.tierNumber}_g${idx + 1}`,
          name,
          ranking: (td.tierNumber - 1) * 10 + idx + 1,
        }));
        await saveTier(tournament.id, `tier${td.tierNumber}`, {
          tierNumber: td.tierNumber,
          label: td.label,
          golfers,
        });
      }
      setMessage('Tiers saved!');
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    }
    setSaving(false);
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tournament Setup</h1>
        <nav className="flex gap-2 text-sm">
          <Link to="/admin/scores" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Scores</Link>
          <Link to="/admin/payments" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Payments</Link>
          <Link to="/admin/picks" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Pick Overrides</Link>
          <Link to="/admin/participants" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Participants</Link>
        </nav>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${message.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message}
        </div>
      )}

      {/* Tournament Details */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Tournament Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tournament Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-masters-green outline-none"
              placeholder="The Masters 2026"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-masters-green outline-none"
            >
              <option value="setup">Setup</option>
              <option value="picks_open">Picks Open</option>
              <option value="in_progress">In Progress</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
            <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-masters-green outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
            <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-masters-green outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">First Tee Time (Pick Lock)</label>
            <input type="datetime-local" value={firstTeeTime} onChange={(e) => setFirstTeeTime(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-masters-green outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Round</label>
            <select value={currentRound} onChange={(e) => setCurrentRound(Number(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-masters-green outline-none">
              <option value={1}>Round 1</option>
              <option value={2}>Round 2</option>
              <option value={3}>Round 3</option>
              <option value={4}>Round 4</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cut Line Score (after R2)</label>
            <input type="number" value={cutLine} onChange={(e) => setCutLine(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-masters-green outline-none"
              placeholder="e.g., +5" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Players Who Made Cut</label>
            <input type="number" value={cutPlayerCount} onChange={(e) => setCutPlayerCount(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-masters-green outline-none"
              placeholder="e.g., 50" />
          </div>
        </div>
        <button
          onClick={handleSaveTournament}
          disabled={saving}
          className="mt-4 bg-masters-green text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-masters-dark transition disabled:opacity-50"
        >
          {saving ? 'Saving...' : tournament ? 'Update Tournament' : 'Create Tournament'}
        </button>
      </div>

      {/* Tier Setup */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold mb-4">Tier Setup (6 Tiers x 10 Golfers)</h2>
        <p className="text-sm text-gray-500 mb-4">Enter one golfer name per line, 10 golfers per tier.</p>

        <div className="space-y-4">
          {tierData.map((td, idx) => {
            const tierConfig = TIER_COLORS[td.tierNumber - 1];
            const golferCount = td.golfers.split('\n').filter((l) => l.trim()).length;
            return (
              <div key={td.tierNumber} className="border rounded-lg overflow-hidden">
                <div className={`${tierConfig?.bg || 'bg-gray-500'} px-4 py-2 flex items-center justify-between`}>
                  <span className={`font-semibold ${tierConfig?.text || 'text-white'}`}>{td.label}</span>
                  <span className={`text-sm ${tierConfig?.text || 'text-white'} opacity-80`}>{golferCount}/10</span>
                </div>
                <textarea
                  value={td.golfers}
                  onChange={(e) => {
                    const updated = [...tierData];
                    updated[idx] = { ...td, golfers: e.target.value };
                    setTierData(updated);
                  }}
                  rows={5}
                  className="w-full px-3 py-2 text-sm font-mono resize-none outline-none focus:ring-2 focus:ring-masters-green"
                  placeholder={`Golfer 1\nGolfer 2\n...\nGolfer 10`}
                />
              </div>
            );
          })}
        </div>

        <button
          onClick={handleSaveTiers}
          disabled={saving || !tournament}
          className="mt-4 bg-masters-green text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-masters-dark transition disabled:opacity-50"
        >
          {saving ? 'Saving Tiers...' : 'Save All Tiers'}
        </button>
      </div>
    </div>
  );
}

// Need to import Tournament type for the status cast
import type { Tournament } from '../../lib/types';
