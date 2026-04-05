import { useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTournament, useEntries, useUsers } from '../../hooks/useTournament';
import { Link, useNavigate } from 'react-router-dom';

type SortKey = 'name' | 'entries';

interface ParticipantRow {
  uid: string;
  displayName: string;
  email: string;
  entryCount: number;
  paidCount: number;
}

export default function ParticipantList() {
  const { user } = useAuth();
  const { tournament } = useTournament();
  const { entries } = useEntries(tournament?.id);
  const { users } = useUsers();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);

  if (!user?.isAdmin) { navigate('/admin'); return null; }

  const participants = useMemo<ParticipantRow[]>(() => {
    return users
      .filter((u) => !u.isAdmin)
      .map((u) => {
        const userEntries = entries.filter((e) => e.userId === u.uid);
        return {
          uid: u.uid,
          displayName: u.displayName || '(no name)',
          email: u.email,
          entryCount: userEntries.length,
          paidCount: userEntries.filter((e) => e.paid).length,
        };
      });
  }, [users, entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? participants.filter(
          (p) =>
            p.displayName.toLowerCase().includes(q) ||
            p.email.toLowerCase().includes(q)
        )
      : participants;

    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.displayName.localeCompare(b.displayName);
      else cmp = a.entryCount - b.entryCount;
      return sortAsc ? cmp : -cmp;
    });
  }, [participants, search, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  };

  const exportCsv = () => {
    const header = ['Name', 'Email', 'Entries', 'Paid', 'Unpaid'];
    const rows = filtered.map((p) => [
      `"${p.displayName.replace(/"/g, '""')}"`,
      `"${p.email.replace(/"/g, '""')}"`,
      p.entryCount,
      p.paidCount,
      p.entryCount - p.paidCount,
    ]);
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'participants.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col ? (
      <span className="ml-1 text-xs">{sortAsc ? '▲' : '▼'}</span>
    ) : (
      <span className="ml-1 text-xs text-white/40">▲</span>
    );

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Participants</h1>
        <nav className="flex gap-2 text-sm">
          <Link to="/admin/tournament" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Setup</Link>
          <Link to="/admin/scores" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Scores</Link>
          <Link to="/admin/payments" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Payments</Link>
          <Link to="/admin/picks" className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600">Pick Overrides</Link>
        </nav>
      </div>

      {/* Summary + controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4 items-start sm:items-center justify-between">
        <div className="text-sm text-gray-500">
          {filtered.length} of {participants.length} participant{participants.length !== 1 ? 's' : ''}
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <input
            type="text"
            placeholder="Search name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 sm:w-64 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-masters-green"
          />
          <button
            onClick={exportCsv}
            className="px-3 py-1.5 text-sm bg-masters-green text-white rounded-lg hover:bg-masters-green/90 whitespace-nowrap"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-masters-green text-white">
            <tr>
              <th
                className="text-left px-4 py-3 cursor-pointer select-none"
                onClick={() => toggleSort('name')}
              >
                Name <SortIcon col="name" />
              </th>
              <th className="text-left px-4 py-3">Email</th>
              <th
                className="text-center px-4 py-3 cursor-pointer select-none"
                onClick={() => toggleSort('entries')}
              >
                Entries <SortIcon col="entries" />
              </th>
              <th className="text-center px-4 py-3">Payment</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  No participants found
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const unpaid = p.entryCount - p.paidCount;
              const paymentLabel =
                p.entryCount === 0
                  ? null
                  : p.paidCount === p.entryCount
                  ? { text: 'All Paid', cls: 'bg-green-100 text-green-700' }
                  : p.paidCount === 0
                  ? { text: 'Unpaid', cls: 'bg-red-100 text-red-600' }
                  : { text: `${unpaid} unpaid`, cls: 'bg-yellow-100 text-yellow-700' };

              return (
                <tr key={p.uid} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{p.displayName}</td>
                  <td className="px-4 py-3 text-gray-600">{p.email}</td>
                  <td className="px-4 py-3 text-center">{p.entryCount}</td>
                  <td className="px-4 py-3 text-center">
                    {paymentLabel && (
                      <span className={`text-xs px-2 py-1 rounded-full font-semibold ${paymentLabel.cls}`}>
                        {paymentLabel.text}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
