import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  useTournament,
  useTiers,
  useEntries,
  useGolferScores,
  useWithdrawalAlerts,
  submitEntry,
  updateEntry,
} from '../hooks/useTournament';
import { TIER_COLORS } from '../constants/theme';
import TierBadge from '../components/common/TierBadge';
import { Timestamp } from 'firebase/firestore';
import { useSearchParams, useNavigate } from 'react-router-dom';

export default function Draft() {
  const { user } = useAuth();
  const { tournament } = useTournament();
  const { tiers } = useTiers(tournament?.id);
  const { entries } = useEntries(tournament?.id);
  const { scores } = useGolferScores(tournament?.id);
  const { alerts } = useWithdrawalAlerts(tournament?.id);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const editEntryId = searchParams.get('edit');
  const wdTierParam = searchParams.get('wdTier');
  const wdTierNumber = wdTierParam ? parseInt(wdTierParam, 10) : null;

  const [picks, setPicks] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Entry being edited (if any)
  const editingEntry = useMemo(() => {
    if (!editEntryId) return null;
    return entries.find((e) => e.id === editEntryId && e.userId === user?.uid) || null;
  }, [editEntryId, entries, user?.uid]);

  // Pre-populate picks when editing an existing entry
  useEffect(() => {
    if (editingEntry) {
      setPicks({
        tier1: editingEntry.picks.tier1,
        tier2: editingEntry.picks.tier2,
        tier3: editingEntry.picks.tier3,
        tier4: editingEntry.picks.tier4,
        tier5: editingEntry.picks.tier5,
        tier6: editingEntry.picks.tier6,
      });
    }
  }, [editingEntry]);

  // Deadline logic
  const firstTeeTime = tournament?.firstTeeTime?.toDate();
  const teeTimePassed = firstTeeTime ? firstTeeTime.getTime() <= Date.now() : false;
  const isLocked = tournament?.picksLocked || teeTimePassed;

  // Set of golfer IDs currently marked as withdrawn in Firestore
  const withdrawnGolferIds = useMemo(() => {
    const ids = new Set<string>();
    scores.forEach((s) => { if (s.status === 'withdrawn') ids.add(s.id); });
    return ids;
  }, [scores]);

  // WD swap mode: active when there's a valid, unexpired alert for this entry/tier
  const isWdSwapActive = useMemo(() => {
    if (!wdTierNumber || !editingEntry) return false;
    const now = new Date();
    return alerts.some((alert) => {
      if (alert.status !== 'active') return false;
      const deadline = alert.swapDeadline?.toDate?.() || new Date(alert.swapDeadline as any);
      if (deadline <= now) return false;
      return alert.tierNumber === wdTierNumber && alert.affectedEntryIds.includes(editingEntry.id);
    });
  }, [alerts, wdTierNumber, editingEntry]);

  // WD swap alert details (for the banner)
  const wdSwapAlert = useMemo(() => {
    if (!isWdSwapActive || !wdTierNumber || !editingEntry) return null;
    const now = new Date();
    return alerts.find((alert) => {
      if (alert.status !== 'active') return false;
      const deadline = alert.swapDeadline?.toDate?.() || new Date(alert.swapDeadline as any);
      if (deadline <= now) return false;
      return alert.tierNumber === wdTierNumber && alert.affectedEntryIds.includes(editingEntry.id);
    }) || null;
  }, [alerts, wdTierNumber, editingEntry, isWdSwapActive]);

  // isTierLocked: locked globally except the WD swap tier when a valid WD swap is active
  const isTierLocked = (tierNumber: number): boolean => {
    if (!isLocked) return false;
    if (isWdSwapActive && tierNumber === wdTierNumber) return false;
    return true;
  };

  const allTiersPicked =
    tiers.length === 6 && tiers.every((t) => picks[`tier${t.tierNumber}`]);

  // In WD swap mode, the WD tier pick must not still be the withdrawn golfer
  const wdSwapPickNeeded =
    isWdSwapActive &&
    wdTierNumber !== null &&
    withdrawnGolferIds.has(picks[`tier${wdTierNumber}`] || '');

  const userEntries = entries.filter((e) => e.userId === user?.uid);
  const nextEntryNumber = userEntries.length + 1;

  const handlePick = (tierNumber: number, golferId: string) => {
    if (isTierLocked(tierNumber)) return;
    if (withdrawnGolferIds.has(golferId)) return;
    setPicks((prev) => ({ ...prev, [`tier${tierNumber}`]: golferId }));
  };

  const handleSubmit = async () => {
    console.log('[Draft] handleSubmit called', { tournament: !!tournament, user: !!user, allTiersPicked, wdSwapPickNeeded });
    if (!tournament || !user || !allTiersPicked || wdSwapPickNeeded) {
      console.log('[Draft] guard returned early — tournament:', tournament?.id, 'user:', user?.uid, 'allTiersPicked:', allTiersPicked);
      return;
    }
    setSubmitting(true);
    setError('');

    const picksData = {
      tier1: picks.tier1,
      tier2: picks.tier2,
      tier3: picks.tier3,
      tier4: picks.tier4,
      tier5: picks.tier5,
      tier6: picks.tier6,
    };

    try {
      console.log('[Draft] starting Firestore write, editingEntry:', editingEntry?.id ?? 'none');
      if (editingEntry) {
        await updateEntry(tournament.id, editingEntry.id, { picks: picksData });
      } else {
        await submitEntry(tournament.id, {
          userId: user.uid,
          participantName: user.displayName,
          entryNumber: nextEntryNumber,
          entryLabel: `${user.displayName} #${nextEntryNumber}`,
          picks: picksData,
          totalScore: 0,
          paid: false,
          submittedAt: Timestamp.now(),
        });
      }
      console.log('[Draft] Firestore write succeeded — calling navigate(/my-entries)');
      navigate('/my-entries');
      console.log('[Draft] navigate called');
    } catch (err: any) {
      console.error('[Draft] caught error:', err);
      setError(err.message || 'Failed to submit entry.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!tournament) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No active tournament. Check back when the admin sets one up.</p>
      </div>
    );
  }

  const deadlineStr = firstTeeTime
    ? firstTeeTime.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }) +
      ' at ' +
      firstTeeTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : 'the first tee time on Thursday';

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {isWdSwapActive
            ? `Update Tier ${wdTierNumber} Pick — ${editingEntry?.entryLabel}`
            : editingEntry
              ? `Edit: ${editingEntry.entryLabel}`
              : `${tournament.name} — Draft`}
        </h1>
        <p className="text-gray-500 mt-1">
          {isWdSwapActive
            ? `Select a replacement for Tier ${wdTierNumber}. All other picks remain locked.`
            : isLocked
              ? 'Picks are locked. Contact the admin for any changes.'
              : editingEntry
                ? 'Update your picks below. You can edit until the picks deadline.'
                : `Select 1 golfer from each tier. This will be entry #${nextEntryNumber}.`}
        </p>
      </div>

      {isWdSwapActive && wdSwapAlert && (() => {
        const deadline = wdSwapAlert.swapDeadline?.toDate?.() || new Date(wdSwapAlert.swapDeadline as any);
        const deadlineStr =
          deadline.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) +
          ' at ' +
          deadline.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 mb-6 text-amber-800 text-sm">
            <p className="font-semibold">{wdSwapAlert.golferName} has withdrawn from the tournament.</p>
            <p className="mt-1">
              Select a replacement from Tier {wdTierNumber} below. Your new pick must be submitted by{' '}
              <span className="font-semibold">{deadlineStr}</span>.
            </p>
          </div>
        );
      })()}

      {isLocked && !isWdSwapActive && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-red-700 text-sm font-medium">
          Picks are locked — the tournament has started.
        </div>
      )}

      {!isLocked && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-blue-800 text-sm">
          You can edit your picks until{' '}
          <span className="font-semibold">{deadlineStr}</span>. Your picks are hidden from
          other participants until then.
        </div>
      )}

      <div className="space-y-6">
        {tiers.map((tier) => {
          const tierConfig = TIER_COLORS[tier.tierNumber - 1];
          const selectedGolferId = picks[`tier${tier.tierNumber}`];

          const tierLocked = isTierLocked(tier.tierNumber);
          const isWdTier = isWdSwapActive && tier.tierNumber === wdTierNumber;

          return (
            <div key={tier.id} className={`bg-white rounded-xl shadow-sm overflow-hidden ${isWdTier ? 'ring-2 ring-amber-400' : ''}`}>
              <div
                className={`${tierConfig?.bg || 'bg-gray-500'} px-4 py-3 flex items-center gap-3`}
              >
                <TierBadge tierNumber={tier.tierNumber} />
                <span className={`font-semibold ${tierConfig?.text || 'text-white'}`}>
                  {tier.label || tierConfig?.label}
                </span>
                {isWdSwapActive && tierLocked && (
                  <span className="ml-auto text-xs opacity-60 font-normal">Locked</span>
                )}
                {isWdTier && (
                  <span className="ml-auto text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded font-semibold">
                    Select replacement
                  </span>
                )}
              </div>
              <div className="p-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
                {tier.golfers.map((golfer) => {
                  const isSelected = selectedGolferId === golfer.id;
                  const isWithdrawn = withdrawnGolferIds.has(golfer.id);
                  const isDisabled = tierLocked || isWithdrawn;
                  return (
                    <button
                      key={golfer.id}
                      onClick={() => handlePick(tier.tierNumber, golfer.id)}
                      disabled={isDisabled}
                      className={`px-3 py-2.5 rounded-lg text-sm font-medium transition border-2 ${
                        isWithdrawn
                          ? 'border-red-100 bg-red-50 text-gray-400 cursor-not-allowed'
                          : isSelected
                            ? 'border-masters-green bg-masters-green text-white'
                            : tierLocked
                              ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed opacity-60'
                              : 'border-gray-200 hover:border-masters-green hover:bg-green-50 text-gray-700 cursor-pointer'
                      }`}
                    >
                      {isWithdrawn ? (
                        <span className="flex flex-col items-center gap-0.5">
                          <span className="line-through">{golfer.name}</span>
                          <span className="text-xs bg-red-200 text-red-700 px-1.5 rounded font-semibold">WD</span>
                        </span>
                      ) : (
                        golfer.name
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mt-4 bg-red-50 text-red-600 text-sm rounded-lg p-3">{error}</div>
      )}

      {(!isLocked || isWdSwapActive) && tiers.length > 0 && (
        <div className="mt-8 sticky bottom-4">
          <button
            onClick={handleSubmit}
            disabled={!allTiersPicked || submitting || wdSwapPickNeeded}
            className={`w-full py-4 rounded-xl font-bold text-lg transition shadow-lg ${
              allTiersPicked && !wdSwapPickNeeded
                ? 'bg-masters-green text-white hover:bg-masters-dark'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {submitting
              ? 'Saving...'
              : wdSwapPickNeeded
                ? `Select a replacement for Tier ${wdTierNumber}`
                : allTiersPicked
                  ? isWdSwapActive
                    ? 'Save Pick Update'
                    : editingEntry
                      ? 'Save Changes'
                      : `Submit Entry #${nextEntryNumber}`
                  : `Select all 6 tiers (${Object.keys(picks).length}/6)`}
          </button>
        </div>
      )}
    </div>
  );
}
