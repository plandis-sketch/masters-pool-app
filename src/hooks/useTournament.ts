import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  setDoc,
  updateDoc,
  addDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Tournament, Tier, GolferScore, Entry, DailyStanding } from '../lib/types';

// Get the active tournament (most recent one)
export function useTournament() {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'tournaments'),
      (snap) => {
        const tournaments = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Tournament));
        // Pick the most recent active one, or just the first
        const active = tournaments.find((t) => t.status !== 'complete') || tournaments[0] || null;
        setTournament(active);
        setLoading(false);
      },
      (err) => {
        console.error('[useTournament] snapshot error:', err);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  return { tournament, loading };
}

// Get tiers for a tournament
export function useTiers(tournamentId: string | undefined) {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setLoading(false); return; }
    const unsub = onSnapshot(
      query(collection(db, 'tournaments', tournamentId, 'tiers'), orderBy('tierNumber')),
      (snap) => {
        setTiers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Tier)));
        setLoading(false);
      },
      (err) => {
        console.error('[useTiers] snapshot error:', err);
        setLoading(false);
      }
    );
    return unsub;
  }, [tournamentId]);

  return { tiers, loading };
}

// Get golfer scores for a tournament
export function useGolferScores(tournamentId: string | undefined) {
  const [scores, setScores] = useState<GolferScore[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setLoading(false); return; }
    const unsub = onSnapshot(
      collection(db, 'tournaments', tournamentId, 'golferScores'),
      (snap) => {
        setScores(snap.docs.map((d) => ({ id: d.id, ...d.data() } as GolferScore)));
        setLoading(false);
      },
      (err) => {
        console.error('[useGolferScores] snapshot error:', err);
        setLoading(false);
      }
    );
    return unsub;
  }, [tournamentId]);

  return { scores, loading };
}

// Get all entries for a tournament
export function useEntries(tournamentId: string | undefined) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setLoading(false); return; }
    const unsub = onSnapshot(
      collection(db, 'tournaments', tournamentId, 'entries'),
      (snap) => {
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Entry)));
        setLoading(false);
      },
      (err) => {
        console.error('[useEntries] snapshot error:', err);
        setLoading(false);
      }
    );
    return unsub;
  }, [tournamentId]);

  return { entries, loading };
}

// Get daily leaderboard snapshots
export function useDailyLeaderboards(tournamentId: string | undefined) {
  const [dailyLeaderboards, setDailyLeaderboards] = useState<DailyStanding[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setLoading(false); return; }
    const unsub = onSnapshot(
      collection(db, 'tournaments', tournamentId, 'dailyLeaderboards'),
      (snap) => {
        setDailyLeaderboards(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyStanding))
        );
        setLoading(false);
      },
      (err) => {
        console.error('[useDailyLeaderboards] snapshot error:', err);
        setLoading(false);
      }
    );
    return unsub;
  }, [tournamentId]);

  return { dailyLeaderboards, loading };
}

// Admin: Create tournament
export async function createTournament(data: Omit<Tournament, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, 'tournaments'), data);
  return ref.id;
}

// Admin: Update tournament
export async function updateTournament(id: string, data: Partial<Tournament>) {
  await updateDoc(doc(db, 'tournaments', id), data);
}

// Admin: Save tiers
export async function saveTier(tournamentId: string, tierId: string, data: Omit<Tier, 'id'>) {
  await setDoc(doc(db, 'tournaments', tournamentId, 'tiers', tierId), data);
}

// Admin: Update golfer score
export async function updateGolferScore(tournamentId: string, golferId: string, data: Partial<GolferScore>) {
  await setDoc(doc(db, 'tournaments', tournamentId, 'golferScores', golferId), data, { merge: true });
}

// Submit an entry
export async function submitEntry(tournamentId: string, entry: Omit<Entry, 'id'>) {
  const ref = await addDoc(collection(db, 'tournaments', tournamentId, 'entries'), entry);
  return ref.id;
}

// Admin: Update entry (pick overrides, payment)
export async function updateEntry(tournamentId: string, entryId: string, data: Partial<Entry>) {
  await updateDoc(doc(db, 'tournaments', tournamentId, 'entries', entryId), data);
}
