import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTournament, useTiers, useEntries, updateEntry } from '../../hooks/useTournament';
import { Link, useNavigate } from 'react-router-dom';
import TierBadge from '../../components/common/TierBadge';

export default function PickOverrides() {
  const { user } = useAuth();
  const { tournament } = useTournament();
  const { tiers } = useTiers(tournament?.id);
  const { entries } = useEntries(tournament?.id);
  const navigate = useNavigate();
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [editPicks, setEditPicks] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  if (!user?.isAdmin) { navigate('/admin'); return null; }

  const entry = entries.find((e) => e.id === selectedEntry);

  const handleSelectEntry = (entryId: string) => {
    const e = entries.find((en) => en.id === entryId);
    if (e) {
      setSelectedEntry(entryId);
      setEditPicks({ ...e.picks });
      setMessage('');
    }
  };

  const handleSave = async () => {
    if (!tournament || !selectedEntry) return;
    setSaving(true);
    try {
      await updateEntry(tournament.id, selectedEntry, {
        picks: editPicks as any,
      });
      setMessage('Picks updated!');
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    }
    setSaving(false);
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pick Overrides</h1>
        <nav className="flex gap-2 text-sm">
          <Link to="/admin/tournament" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Setup</Link>
          <Link to="/admin/scores" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Scores</Link>
          <Link to="/admin/payments" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Payments</Link>
          <Link to="/admin/participants" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Participants</Link>
        </nav>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${message.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Entry selector */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Select Entry</h2>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {entries.map((e) => (
              <button
                key={e.id}
                onClick={() => handleSelectEntry(e.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                  selectedEntry === e.id
                    ? 'bg-masters-green text-white'
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
              >
                {e.entryLabel}
              </button>
            ))}
          </div>
        </div>

        {/* Pick editor */}
        <div className="md:col-span-2 bg-white rounded-xl shadow-sm p-4">
          {!entry ? (
            <p className="text-gray-400 py-8 text-center">Select an entry to edit picks</p>
          ) : (
            <>
              <h2 className="font-semibold text-gray-900 mb-4">
                Editing: {entry.entryLabel}
              </h2>
              <div className="space-y-4">
                {tiers.map((tier) => {
                  const tierKey = `tier${tier.tierNumber}` as keyof typeof editPicks;
                  return (
                    <div key={tier.id}>
                      <div className="flex items-center gap-2 mb-2">
                        <TierBadge tierNumber={tier.tierNumber} size="sm" />
                        <span className="text-sm font-medium text-gray-700">{tier.label}</span>
                      </div>
                      <select
                        value={editPicks[tierKey] || ''}
                        onChange={(e) => setEditPicks((prev) => ({ ...prev, [tierKey]: e.target.value }))}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-masters-green outline-none"
                      >
                        <option value="">-- Select golfer --</option>
                        {tier.golfers.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={handleSave}
                disabled={saving}
                className="mt-6 bg-masters-green text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-masters-dark transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Pick Override'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
