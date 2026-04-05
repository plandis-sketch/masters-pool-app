import { useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTournament, useEntries, updateEntry } from '../../hooks/useTournament';
import { Link, useNavigate } from 'react-router-dom';
import { ENTRY_FEE } from '../../constants/theme';

export default function PaymentTracking() {
  const { user } = useAuth();
  const { tournament } = useTournament();
  const { entries } = useEntries(tournament?.id);
  const navigate = useNavigate();
  const [saving, setSaving] = useState<string | null>(null);

  if (!user?.isAdmin) { navigate('/admin'); return null; }

  const totalPot = entries.length * ENTRY_FEE;
  const paidCount = entries.filter((e) => e.paid).length;
  const unpaidCount = entries.length - paidCount;

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.entryLabel.localeCompare(b.entryLabel)),
    [entries]
  );

  const togglePaid = async (entryId: string, currentPaid: boolean) => {
    if (!tournament) return;
    setSaving(entryId);
    await updateEntry(tournament.id, entryId, { paid: !currentPaid });
    setSaving(null);
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Payment Tracking</h1>
        <nav className="flex gap-2 text-sm">
          <Link to="/admin/tournament" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Setup</Link>
          <Link to="/admin/scores" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Scores</Link>
          <Link to="/admin/picks" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Pick Overrides</Link>
          <Link to="/admin/participants" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Participants</Link>
        </nav>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4 text-center">
          <div className="text-3xl font-bold text-masters-green">${totalPot}</div>
          <div className="text-sm text-gray-500 mt-1">Total Pool</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 text-center">
          <div className="text-3xl font-bold text-green-600">{paidCount}</div>
          <div className="text-sm text-gray-500 mt-1">Paid</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 text-center">
          <div className="text-3xl font-bold text-red-500">{unpaidCount}</div>
          <div className="text-sm text-gray-500 mt-1">Unpaid</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-masters-green text-white">
            <tr>
              <th className="text-left px-4 py-3">Entry</th>
              <th className="text-center px-4 py-3">Fee</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-center px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {sortedEntries.map((entry) => (
              <tr key={entry.id} className="border-b border-gray-100">
                <td className="px-4 py-3 font-medium">{entry.entryLabel}</td>
                <td className="px-4 py-3 text-center">${ENTRY_FEE}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                    entry.paid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                  }`}>
                    {entry.paid ? 'Paid' : 'Unpaid'}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => togglePaid(entry.id, entry.paid)}
                    disabled={saving === entry.id}
                    className={`text-xs font-semibold px-3 py-1 rounded-lg transition ${
                      entry.paid
                        ? 'text-red-600 hover:bg-red-50'
                        : 'text-green-600 hover:bg-green-50'
                    }`}
                  >
                    {saving === entry.id ? '...' : entry.paid ? 'Mark Unpaid' : 'Mark Paid'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
