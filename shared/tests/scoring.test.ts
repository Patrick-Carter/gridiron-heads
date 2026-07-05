import { describe, it, expect } from 'vitest';
import { addPoints, checkWinner } from '../src/scoring.js';

describe('addPoints', () => {
  it('adds points to one team', () => {
    expect(addPoints([0, 0], 0, 0.5)).toEqual([0.5, 0]);
    expect(addPoints([1.5, 2.0], 1, 0.5)).toEqual([1.5, 2.5]);
  });

  it('does not mutate input', () => {
    const original: [number, number] = [1, 2];
    addPoints(original, 0, 0.5);
    expect(original).toEqual([1, 2]);
  });
});

describe('checkWinner', () => {
  it('[3, 0] → winner 0', () => {
    expect(checkWinner([3, 0])).toBe(0);
  });
  it('[0, 3] → winner 1', () => {
    expect(checkWinner([0, 3])).toBe(1);
  });
  it('[3, 1] → no winner (lead 2, but only 2 vs 1 needs ≥3 for winner)', () => {
    expect(checkWinner([3, 1])).toBe(0); // leader has 3 (≥3) AND diff=2 → winner
  });
  it('[2.5, 3] → no winner (score 3 but lead only 0.5)', () => {
    expect(checkWinner([2.5, 3])).toBeNull();
  });
  it('[3.5, 1.5] → winner 0 (lead 2, score ≥3)', () => {
    expect(checkWinner([3.5, 1.5])).toBe(0);
  });
  it('[0.5, 2.5] → no winner (score 2.5 < 3)', () => {
    expect(checkWinner([0.5, 2.5])).toBeNull();
  });
  it('[3.5, 2] → no winner (lead only 1.5)', () => {
    expect(checkWinner([3.5, 2])).toBeNull();
  });
  it('[4, 2] → winner 0 (lead 2, ≥3)', () => {
    expect(checkWinner([4, 2])).toBe(0);
  });
  it('[2, 4] → winner 1', () => {
    expect(checkWinner([2, 4])).toBe(1);
  });
  it('[0, 0] → no winner', () => {
    expect(checkWinner([0, 0])).toBeNull();
  });
  it('[2.5, 0.5] → no winner (lead 2 but score <3)', () => {
    expect(checkWinner([2.5, 0.5])).toBeNull();
  });
  it('[5, 3] → winner 0 (lead 2, ≥3)', () => {
    expect(checkWinner([5, 3])).toBe(0);
  });
  it('[3, 3] → no winner (tie)', () => {
    expect(checkWinner([3, 3])).toBeNull();
  });
  it('[3.5, 3.5] → no winner (tie)', () => {
    expect(checkWinner([3.5, 3.5])).toBeNull();
  });
});