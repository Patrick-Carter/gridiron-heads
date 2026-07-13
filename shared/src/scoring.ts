// Scoring — half-point increments allowed (D9).

export function addPoints(
  scores: [number, number],
  scoring_idx: 0 | 1,
  pts: number,
): [number, number] {
  const next: [number, number] = [scores[0], scores[1]];
  next[scoring_idx] += pts;
  return next;
}

export type RegulationOutcome =
  | { status: 'ongoing' }
  | { status: 'shootout' }
  | { status: 'winner'; winner_idx: 0 | 1 };

export function evaluateRegulation(
  scores: [number, number],
  possessions_completed: [number, number],
): RegulationOutcome {
  if (possessions_completed[0] < 4 || possessions_completed[1] < 4) {
    return { status: 'ongoing' };
  }
  if (scores[0] === scores[1]) return { status: 'shootout' };
  return { status: 'winner', winner_idx: scores[0] > scores[1] ? 0 : 1 };
}

export function shootoutDistance(round: number): number {
  return Math.min(65, 25 + Math.max(0, round - 1) * 10);
}
