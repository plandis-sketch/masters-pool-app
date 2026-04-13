/**
 * Scoring logic for the Masters Pool
 *
 * - Each golfer's points = their current tournament position
 * - Ties: all tied golfers receive the same position points (T3 = 3 pts each)
 * - Missed cut: points = (number who made cut) + 1
 * - Withdrawn: same as missed cut
 * - Entry total = sum of 6 golfers' points
 * - Lowest total wins
 *
 * IMPORTANT: Only players with status 'cut' or 'withdrawn' receive the missed-cut
 * penalty score. Active players (those who made the cut) always receive their actual
 * finishing position — never capped at missedCutScore, since they can legitimately
 * finish at positions higher than cutPlayerCount.
 */

export function getMissedCutScore(cutPlayerCount: number | null): number {
  return (cutPlayerCount ?? 50) + 1;
}

export function calculateGolferPoints(
  position: number | null,
  status: 'active' | 'cut' | 'withdrawn',
  cutPlayerCount: number | null
): number {
  const missedCutScore = getMissedCutScore(cutPlayerCount);

  if (status === 'cut' || status === 'withdrawn') {
    return missedCutScore;
  }

  // Active players: return their actual position as points.
  // NEVER cap active players at missedCutScore — a player who made the cut can legitimately
  // finish at a position numerically higher than cutPlayerCount (ESPN's c.order numbering
  // includes cut players, so their stored position can exceed the active-player count).
  // Only status === 'cut' / 'withdrawn' (handled above) should receive the missed-cut penalty.
  return position ?? 999;
}

export function calculateEntryTotal(golferPoints: number[]): number {
  return golferPoints.reduce((sum, pts) => sum + pts, 0);
}

/**
 * Returns true if a golfer has started their round.
 * thru must be a positive integer string ("1"–"18") or "F" (finished).
 * A tee time string or "--" means they haven't started.
 */
export function golferHasStarted(thru: string | undefined | null): boolean {
  if (!thru) return false;
  if (thru === 'F') return true;
  return /^\d+$/.test(thru);
}
