import { describe, it, expect } from 'vitest';
import { attemptFieldGoal } from '../src/kicker.js';
import { mulberry32 } from '../src/rng.js';

describe('attemptFieldGoal', () => {
  it('50yd FG, power 50 → returns valid result fields', () => {
    const r = attemptFieldGoal({ yards_to_endzone: 50, kicker_power: 50, seed: 1 });
    expect(typeof r.make).toBe('boolean');
    expect(r.power_roll).toBeGreaterThanOrEqual(0);
    expect(r.power_roll).toBeLessThanOrEqual(50);
    expect(r.bonus_roll).toBeGreaterThanOrEqual(0);
    expect(r.bonus_roll).toBeLessThanOrEqual(20);
    expect(r.total).toBe(r.power_roll + r.bonus_roll);
    expect(r.seed).toBe(1);
    expect(r.make).toBe(r.total > 50);
  });

  it('power_roll ∈ [0, power], bonus_roll ∈ [0,20]', () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const r = attemptFieldGoal({ yards_to_endzone: 30, kicker_power: 80, seed: i + 1 });
      expect(r.power_roll).toBeGreaterThanOrEqual(0);
      expect(r.power_roll).toBeLessThanOrEqual(80);
      expect(r.bonus_roll).toBeGreaterThanOrEqual(0);
      expect(r.bonus_roll).toBeLessThanOrEqual(20);
    }
  });

  it('empirical make-rate for short FG with high power is high', () => {
    let makes = 0;
    const TRIALS = 5000;
    for (let i = 0; i < TRIALS; i++) {
      const r = attemptFieldGoal({ yards_to_endzone: 25, kicker_power: 80, seed: i + 1 });
      if (r.make) makes++;
    }
    const rate = makes / TRIALS;
    // Theoretical: P(power_roll + bonus > 25) with power ~ U[0,80], bonus ~ U[0,20]
    // E[total] = 40 + 10 = 50, threshold = 25 → empirically ~0.79-0.82
    expect(rate).toBeGreaterThan(0.70);
  });

  it('empirical make-rate for long FG with low power is low', () => {
    let makes = 0;
    const TRIALS = 5000;
    for (let i = 0; i < TRIALS; i++) {
      const r = attemptFieldGoal({ yards_to_endzone: 70, kicker_power: 50, seed: i + 1 });
      if (r.make) makes++;
    }
    const rate = makes / TRIALS;
    // E[total] = 25 + 10 = 35, threshold = 70 → very low rate
    expect(rate).toBeLessThan(0.15);
  });

  it('QB kicker_power_pct +20 raises effective power and increases make rate', () => {
    let makesLow = 0;
    let makesHigh = 0;
    const TRIALS = 5000;
    const qbMod = [{ stat: 'kicker_power_pct' as const, value: 20, scope: 'fg' as const }];
    for (let i = 0; i < TRIALS; i++) {
      const r = attemptFieldGoal({
        yards_to_endzone: 55,
        kicker_power: 60,
        seed: i + 1,
        qb_modifiers: qbMod,
      });
      if (r.make) makesHigh++;
    }
    for (let i = 0; i < TRIALS; i++) {
      const r = attemptFieldGoal({
        yards_to_endzone: 55,
        kicker_power: 60,
        seed: i + 1,
      });
      if (r.make) makesLow++;
    }
    expect(makesHigh / TRIALS).toBeGreaterThan(makesLow / TRIALS);
  });

  it('same seed → byte-identical result', () => {
    const a = attemptFieldGoal({ yards_to_endzone: 40, kicker_power: 70, seed: 999 });
    const b = attemptFieldGoal({ yards_to_endzone: 40, kicker_power: 70, seed: 999 });
    expect(a).toEqual(b);
  });

  it('power_used is clamped to [1, 100]', () => {
    const hugeMod = [{ stat: 'kicker_power_pct' as const, value: 1000, scope: 'fg' as const }];
    const r = attemptFieldGoal({
      yards_to_endzone: 30,
      kicker_power: 80,
      seed: 1,
      qb_modifiers: hugeMod,
    });
    expect(r.power_used).toBeLessThanOrEqual(100);
    expect(r.power_used).toBeGreaterThanOrEqual(1);
  });
});