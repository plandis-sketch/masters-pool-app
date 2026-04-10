import { Outlet } from 'react-router-dom';
import Header from './Header';
import { EspnProvider } from '../../contexts/EspnContext';

export default function Layout() {
  return (
    <EspnProvider>
      <div className="min-h-screen bg-masters-bg">
        <Header />
        <main className="max-w-6xl mx-auto px-4 py-6">
          <Outlet />
        </main>
      </div>
    </EspnProvider>
  );
}
