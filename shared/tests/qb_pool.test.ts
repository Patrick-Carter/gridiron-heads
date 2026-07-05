import { describe, it, expect } from 'vitest';
import { QB_POOL, drawQBs, modifierDescription } from '../src/qb_pool.js';

describe('QB_POOL invariants', () => {
  it('has at least 20 QBs', () => {
    expect(QB_POOL.length).toBeGreaterThanOrEqual(20);
  });

  it('every QB has modifier.value > 0 (buff-only per D26)', () => {
    for (const qb of QB_POOL) {
      expect(qb.modifier.value).toBeGreaterThan(0);
    }
  });

  it('every QB has valid stat + scope', () => {
    const VALID_STATS = [
      'off_skill_pct',
      'def_skill_pct',
      'turnover_chance_pct',
      'kicker_power_pct',
      'yards_pct',
      'fake_audible_refresh',
      'real_audible_refresh',
    ];
    const VALID_SCOPES = ['all_plays', 'pass', 'run', '4th_down', 'fg', 'punt'];
    for (const qb of QB_POOL) {
      expect(VALID_STATS).toContain(qb.modifier.stat);
      expect(VALID_SCOPES).toContain(qb.modifier.scope);
    }
  });

  it('every QB has non-empty name', () => {
    for (const qb of QB_POOL) {
      expect(qb.name.length).toBeGreaterThan(0);
    }
  });
});

describe('drawQBs', () => {
  it('returns N unique QBs', () => {
    const rng = () => 0.5;
    const drawn = drawQBs(rng, 3);
    expect(drawn).toHaveLength(3);
    const ids = drawn.map((q) => q.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('default n=3', () => {
    const rng = () => 0.5;
    expect(drawQBs(rng)).toHaveLength(3);
  });

  it('1000 draws of 3 → no duplicates within a draw', () => {
    for (let seed = 0; seed < 1000; seed++) {
      let s = (seed + 1) >>> 0;
      const rng = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const drawn = drawQBs(rng, 3);
      const ids = drawn.map((q) => q.id);
      expect(new Set(ids).size).toBe(3);
    }
  });

  it('returned QBs have id + group=QB + name + modifier fields', () => {
    const drawn = drawQBs(() => 0.5, 1);
    expect(drawn[0].group).toBe('QB');
    expect(drawn[0].id.length).toBeGreaterThan(0);
    expect(drawn[0].name.length).toBeGreaterThan(0);
    expect(drawn[0].modifier.value).toBeGreaterThan(0);
  });
});

describe('modifierDescription', () => {
  it('renders a human-readable string', () => {
    const desc = modifierDescription({
      stat: 'off_skill_pct',
      value: 10,
      scope: 'pass',
    });
    expect(desc).toMatch(/offense skill/i);
    expect(desc).toMatch(/pass/i);
  });

  it('handles all scope values without throwing', () => {
    const scopes = ['all_plays', 'pass', 'run', '4th_down', 'fg', 'punt'] as const;
    const stats = [
      'off_skill_pct',
      'def_skill_pct',
      'turnover_chance_pct',
      'kicker_power_pct',
      'yards_pct',
      'fake_audible_refresh',
      'real_audible_refresh',
    ] as const;
    for (const stat of stats) {
      for (const scope of scopes) {
        expect(() => modifierDescription({ stat, value: 5, scope })).not.toThrow();
      }
    }
  });
});