// Scoring — half-point increments allowed (D9).
// Win condition: leader has ≥3 AND lead ≥ 2.

export function addPoints(
  scores: [number, number],
  scoring_idx: 0 | 1,
  pts: number,
): [number, number] {
  const next: [number, number] = [scores[0], scores[1]];
  next[scoring_idx] += pts;
  return next;
}

export function checkWinner(scores: [number, number]): 0 | 1 | null {
  const [a, b] = scores;
  if (a === b) return null;
  const leader: 0 | 1 = a > b ? 0 : 1;
  const leader_score = leader === 0 ? a : b;
  const diff = Math.abs(a - b);
  if (leader_score >= 3 && diff >= 2) return leader;
  return null;
}