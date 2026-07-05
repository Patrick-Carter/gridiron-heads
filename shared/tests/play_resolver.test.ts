import { describe, it, expect } from 'vitest';
import { resolvePlay } from '../src/play_resolver.js';
import { mulberry32 } from '../src/rng.js';

describe('resolvePlay', () => {
  it('returns valid structure', () => {
    const r = resolvePlay({
      off_skill: 70,
      def_skill: 70,
      off_play: { parent: 'run', sub: 'inside' },
      def_play: { parent: 'run', sub: 'outside' },
      seed: 1,
    });
    expect(r.parent_match).toBe(true);
    expect(r.sub_match).toBe(false);
    expect(r.off_roll).toBeGreaterThanOrEqual(0);
    expect(r.def_roll).toBeGreaterThanOrEqual(0);
    expect(r.seed).toBe(1);
  });

  it('parent+sub match → turnover rate ≈ 25%', () => {
    let tos = 0;
    const TRIALS = 2000;
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_play: { parent: 'pass', sub: 'deep' },
        def_play: { parent: 'pass', sub: 'deep' },
        seed: i + 1,
      });
      if (r.turnover) tos++;
    }
    const rate = tos / TRIALS;
    expect(rate).toBeGreaterThan(0.22);
    expect(rate).toBeLessThan(0.28);
  });

  it('parent-only match → turnover rate ≈ 5%', () => {
    let tos = 0;
    const TRIALS = 2000;
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_play: { parent: 'pass', sub: 'deep' },
        def_play: { parent: 'pass', sub: 'short' },
        seed: i + 1,
      });
      if (r.turnover) tos++;
    }
    const rate = tos / TRIALS;
    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(0.07);
  });

  it('no match → turnover rate = 0%', () => {
    let tos = 0;
    const TRIALS = 2000;
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'pass', sub: 'deep' },
        seed: i + 1,
      });
      if (r.turnover) tos++;
    }
    expect(tos).toBe(0);
  });

  it('audible flips sub only (never parent)', () => {
    const r = resolvePlay({
      off_skill: 70,
      def_skill: 70,
      off_play: { parent: 'pass', sub: 'deep' },
      def_play: { parent: 'run', sub: 'outside' },
      off_audible: { parent: 'pass', sub: 'short' },
      seed: 1,
    });
    expect(r.effective_off_play.parent).toBe('pass');
    expect(r.effective_off_play.sub).toBe('short');
  });

  it('QB turnover_chance_pct +50 halves the 25% turnover rate', () => {
    let withMod = 0;
    let withoutMod = 0;
    const TRIALS = 2000;
    const qbMod = [{ stat: 'turnover_chance_pct' as const, value: 50, scope: 'all_plays' as const }];
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_play: { parent: 'pass', sub: 'deep' },
        def_play: { parent: 'pass', sub: 'deep' },
        qb_off_modifiers: qbMod,
        seed: i + 1,
      });
      if (r.turnover) withMod++;
    }
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_play: { parent: 'pass', sub: 'deep' },
        def_play: { parent: 'pass', sub: 'deep' },
        seed: i + 1,
      });
      if (r.turnover) withoutMod++;
    }
    expect(withMod / TRIALS).toBeLessThan(withoutMod / TRIALS);
    expect(withMod / TRIALS).toBeLessThan(0.15); // ~12.5%
  });

  it('fake audible: defense CAN audible even though off_play unchanged', () => {
    const r = resolvePlay({
      off_skill: 70,
      def_skill: 70,
      off_play: { parent: 'pass', sub: 'deep' },
      def_play: { parent: 'pass', sub: 'short' },
      off_fake_audible: true,
      def_audible: { parent: 'pass', sub: 'deep' }, // defense responds
      seed: 1,
    });
    expect(r.effective_off_play).toEqual({ parent: 'pass', sub: 'deep' });
    expect(r.effective_def_play).toEqual({ parent: 'pass', sub: 'deep' });
    expect(r.parent_match).toBe(true);
    expect(r.sub_match).toBe(true);
  });

  it('defense CANNOT audible without off audible or fake', () => {
    const r = resolvePlay({
      off_skill: 70,
      def_skill: 70,
      off_play: { parent: 'pass', sub: 'deep' },
      def_play: { parent: 'pass', sub: 'short' },
      def_audible: { parent: 'pass', sub: 'deep' }, // ignored
      seed: 1,
    });
    expect(r.effective_def_play).toEqual({ parent: 'pass', sub: 'short' });
  });

  it('same seed → byte-identical output', () => {
    const a = resolvePlay({
      off_skill: 70,
      def_skill: 70,
      off_play: { parent: 'pass', sub: 'deep' },
      def_play: { parent: 'pass', sub: 'deep' },
      seed: 12345,
    });
    const b = resolvePlay({
      off_skill: 70,
      def_skill: 70,
      off_play: { parent: 'pass', sub: 'deep' },
      def_play: { parent: 'pass', sub: 'deep' },
      seed: 12345,
    });
    expect(a).toEqual(b);
  });

  it('punt parent matches its own (no sub) → turnover possible', () => {
    let tos = 0;
    const TRIALS = 2000;
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_play: { parent: 'punt', sub: 'deep' },
        def_play: { parent: 'punt', sub: 'deep' },
        seed: i + 1,
      });
      if (r.turnover) tos++;
    }
    // both parent+sub match → 25%
    expect(tos / TRIALS).toBeGreaterThan(0.22);
    expect(tos / TRIALS).toBeLessThan(0.28);
  });

  it('QB off_skill_pct +25 raises effective skill and win rate', () => {
    let winsMod = 0;
    let winsNoMod = 0;
    const TRIALS = 1000;
    const qbMod = [{ stat: 'off_skill_pct' as const, value: 25, scope: 'all_plays' as const }];
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 60,
        def_skill: 80,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'outside' },
        qb_off_modifiers: qbMod,
        seed: i + 1,
      });
      if (r.yards > 0) winsMod++;
    }
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 60,
        def_skill: 80,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'outside' },
        seed: i + 1,
      });
      if (r.yards > 0) winsNoMod++;
    }
    expect(winsMod).toBeGreaterThan(winsNoMod);
  });
});