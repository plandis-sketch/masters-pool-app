import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

export default function Header() {
  const { user } = useAuth();
  const location = useLocation();

  const isActive = (path: string) =>
    location.pathname === path ? 'text-masters-yellow font-semibold' : 'text-white/80 hover:text-white';

  return (
    <header className="bg-masters-green shadow-lg sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <Link to="/leaderboard" className="flex items-center gap-2">
            <span className="text-masters-yellow text-xl font-bold">&#9971;</span>
            <span className="text-white font-bold text-lg hidden sm:inline">Masters Pool</span>
          </Link>

          {user && (
            <nav className="flex items-center gap-1 sm:gap-4 text-sm">
              <Link to="/leaderboard" className={`px-2 py-1 rounded transition ${isActive('/leaderboard')}`}>
                Leaderboard
              </Link>
              <Link to="/daily" className={`px-2 py-1 rounded transition ${isActive('/daily')}`}>
                Daily
              </Link>
              <Link to="/draft" className={`px-2 py-1 rounded transition ${isActive('/draft')}`}>
                Draft
              </Link>
              <Link to="/my-entries" className={`px-2 py-1 rounded transition ${isActive('/my-entries')}`}>
                My Entries
              </Link>
              <Link to="/message-board" className={`px-2 py-1 rounded transition ${isActive('/message-board')}`}>
                Board
              </Link>
              <Link to="/settings" className={`px-2 py-1 rounded transition ${isActive('/settings')}`}>
                Info
              </Link>
              {user.isAdmin && (
                <Link to="/admin/tournament" className={`px-2 py-1 rounded transition ${isActive('/admin/tournament')}`}>
                  Admin
                </Link>
              )}
              <Link to="/profile" className={`px-2 py-1 rounded transition ${isActive('/profile')}`}>
                <span className="w-7 h-7 rounded-full bg-masters-yellow text-masters-dark flex items-center justify-center text-xs font-bold">
                  {user.displayName ? user.displayName[0].toUpperCase() : '?'}
                </span>
              </Link>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
