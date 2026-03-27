import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Layout from './components/layout/Layout';
import SignIn from './pages/SignIn';
import NameEntry from './pages/NameEntry';
import FeeAcknowledgment from './pages/FeeAcknowledgment';
import Leaderboard from './pages/Leaderboard';
import Draft from './pages/Draft';
import MyEntries from './pages/MyEntries';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import AdminLogin from './pages/AdminLogin';
import TournamentSetup from './pages/admin/TournamentSetup';
import ScoreManagement from './pages/admin/ScoreManagement';
import PaymentTracking from './pages/admin/PaymentTracking';
import PickOverrides from './pages/admin/PickOverrides';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-masters-bg">
        <div className="text-center">
          <span className="text-4xl animate-pulse">&#9971;</span>
          <p className="text-gray-500 mt-3">Loading...</p>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  if (!user.displayName) return <Navigate to="/name-entry" replace />;
  if (!user.feeAcknowledged) return <Navigate to="/fee-acknowledgment" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (!user.isAdmin) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-masters-green">
        <div className="text-center">
          <span className="text-5xl animate-pulse">&#9971;</span>
          <p className="text-white/60 mt-3">Loading Masters Pool...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public auth routes */}
      <Route path="/" element={user ? <Navigate to="/leaderboard" replace /> : <SignIn />} />
      <Route path="/name-entry" element={user ? <NameEntry /> : <Navigate to="/" replace />} />
      <Route path="/fee-acknowledgment" element={user ? <FeeAcknowledgment /> : <Navigate to="/" replace />} />

      {/* Protected routes */}
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/draft" element={<Draft />} />
        <Route path="/my-entries" element={<MyEntries />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/admin" element={<AdminLogin />} />
        <Route path="/admin/tournament" element={<RequireAdmin><TournamentSetup /></RequireAdmin>} />
        <Route path="/admin/scores" element={<RequireAdmin><ScoreManagement /></RequireAdmin>} />
        <Route path="/admin/payments" element={<RequireAdmin><PaymentTracking /></RequireAdmin>} />
        <Route path="/admin/picks" element={<RequireAdmin><PickOverrides /></RequireAdmin>} />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
