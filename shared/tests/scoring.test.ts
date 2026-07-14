import { describe, it, expect } from 'vitest';
import { addPoints, evaluateRegulation, shootoutDistance } from '../src/scoring.js';

describe('addPoints', () => {
  it('adds points without mutating input', () => {
    const original: [number, number] = [1, 2];
    expect(addPoints(original, 0, 0.5)).toEqual([1.5, 2]);
    expect(original).toEqual([1, 2]);
  });
});

describe('evaluateRegulation', () => {
  it('does not end before both teams complete three possessions', () => {
    expect(evaluateRegulation([10, 0], [3, 2])).toEqual({ status: 'ongoing' });
    expect(evaluateRegulation([3, 0], [2, 2])).toEqual({ status: 'ongoing' });
  });

  it('selects the higher score after three possessions each', () => {
    expect(evaluateRegulation([1, 0.5], [3, 3])).toEqual({ status: 'winner', winner_idx: 0 });
    expect(evaluateRegulation([0.5, 1], [3, 3])).toEqual({ status: 'winner', winner_idx: 1 });
  });

  it('starts a shootout when regulation ends tied', () => {
    expect(evaluateRegulation([2.5, 2.5], [3, 3])).toEqual({ status: 'shootout' });
  });
});

describe('shootoutDistance', () => {
  it('advances by ten yards and caps at 65', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(shootoutDistance)).toEqual([25, 35, 45, 55, 65, 65, 65]);
  });
});
