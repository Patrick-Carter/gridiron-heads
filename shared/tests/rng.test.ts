import { describe, it, expect } from 'vitest';
import { mulberry32, rollD100, rollD21 } from '../src/rng.js';

describe('mulberry32', () => {
  it('same seed → same sequence', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('different seeds → different sequences', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const aVals = Array.from({ length: 10 }, () => a());
    const bVals = Array.from({ length: 10 }, () => b());
    expect(aVals).not.toEqual(bVals);
  });

  it('1000 rolls all in [0,1)', () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('rollD100', () => {
  it('returns integer in [1,100]', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rollD100(rng);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('rollD21', () => {
  it('returns integer in [0,20]', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const v = rollD21(rng);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it('over 10k trials hits both endpoints', () => {
    const rng = mulberry32(2024);
    let sawZero = false;
    let saw20 = false;
    for (let i = 0; i < 10000; i++) {
      const v = rollD21(rng);
      if (v === 0) sawZero = true;
      if (v === 20) saw20 = true;
      if (sawZero && saw20) break;
    }
    expect(sawZero).toBe(true);
    expect(saw20).toBe(true);
  });
});