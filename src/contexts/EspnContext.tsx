import { createContext, useContext, type ReactNode } from 'react';
import { useEspnLeaderboard, type EspnTournamentData } from '../lib/espnApi';

interface EspnContextValue {
  data: EspnTournamentData | null;
  loading: boolean;
  lastUpdated: Date | null;
}

const EspnContext = createContext<EspnContextValue | null>(null);

export function EspnProvider({ children }: { children: ReactNode }) {
  const value = useEspnLeaderboard();
  return <EspnContext.Provider value={value}>{children}</EspnContext.Provider>;
}

/** Returns the shared ESPN leaderboard data. Must be used inside EspnProvider. */
export function useEspnContext(): EspnContextValue {
  const ctx = useContext(EspnContext);
  if (!ctx) throw new Error('useEspnContext must be used within EspnProvider');
  return ctx;
}
