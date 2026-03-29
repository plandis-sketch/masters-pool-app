import { Timestamp } from 'firebase/firestore';

export interface User {
  uid: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  feeAcknowledged: boolean;
  createdAt: Timestamp;
}

export interface Tournament {
  id: string;
  name: string;
  dates: { start: Timestamp; end: Timestamp };
  firstTeeTime: Timestamp;
  cutLine: number | null;
  cutPlayerCount: number | null;
  picksLocked: boolean;
  currentRound: number;
  prizeStructure: PrizePlace[];
  paymentMethods: {
    venmo: string;
    cashApp: string;
    payPal: string;
  };
  entryFee: number;
  status: 'setup' | 'picks_open' | 'in_progress' | 'complete';
}

export interface PrizePlace {
  place: number;
  amount: number;
  label?: string;
}

export interface Tier {
  id: string;
  tierNumber: number;
  label: string;
  golfers: Golfer[];
}

export interface Golfer {
  id: string;
  name: string;
  ranking: number;
}

export interface GolferScore {
  id: string;
  name: string;
  position: number | null;
  score: string;
  today: string;
  thru: string;
  status: 'active' | 'cut' | 'withdrawn';
  points: number;
  roundScores: {
    r1: number | null;
    r2: number | null;
    r3: number | null;
    r4: number | null;
  };
  lastUpdated: Timestamp;
  source: 'scrape' | 'manual';
}

export interface Entry {
  id: string;
  userId: string;
  participantName: string;
  entryNumber: number;
  entryLabel: string;
  picks: {
    tier1: string;
    tier2: string;
    tier3: string;
    tier4: string;
    tier5: string;
    tier6: string;
  };
  totalScore: number;
  paid: boolean;
  submittedAt: Timestamp;
}

export interface DailyGolferSnapshot {
  id: string;
  name: string;
  points: number;
  score: string;
  status: 'active' | 'cut' | 'withdrawn';
}

export interface DailyStandingEntry {
  entryId: string;
  participantName: string;
  entryLabel: string;
  totalScore: number;
  golfers: DailyGolferSnapshot[];
}

export interface DailyStanding {
  id: string;
  round: number;
  standings: DailyStandingEntry[];
  snapshotAt: Timestamp;
}
