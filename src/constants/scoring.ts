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
 * IMPORTANT: Once the cut is determined, no golfer's score may ever exceed
 * the missed-cut score (cutPlayerCount + 1). This is a hard ceiling that
 * prevents data-refresh bugs from inflating scores.
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

  const rawPoints = position ?? 999;

  // Safety cap: once we know the cut, no golfer can score above the missed-cut score.
  // This catches stale ESPN data, re-ordered positions, or any other edge case.
  if (cutPlayerCount && cutPlayerCount > 0 && rawPoints > missedCutScore) {
    return missedCutScore;
  }

  return rawPoints;
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
