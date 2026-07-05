// Phase 0 — verifies the resolver exposes the per-play roll values that
// the canvas HUD will display. Before Phase 0 these were discarded (always 0)
// in the return literal. These tests pin the contract so the client can
// safely depend on them.

import { describe, it, expect } from 'vitest';
import { resolvePlay } from '../src/play_resolver.js';
import { attemptFieldGoal } from '../src/kicker.js';

describe('resolvePlay — roll-data plumbing (Phase 0)', () => {
  it('run/pass: populates off_roll + def_roll within their skill bounds', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 65,
        off_line_skill: 80,
        def_line_skill: 60,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'inside' },
        seed,
      });
      // Skill rolls are within [0, skill]
      expect(r.off_roll).toBeGreaterThanOrEqual(0);
      expect(r.off_roll).toBeLessThanOrEqual(70);
      expect(r.def_roll).toBeGreaterThanOrEqual(0);
      expect(r.def_roll).toBeLessThanOrEqual(65);
      // Effective skill matches input (no QB mods here)
      expect(r.off_skill_eff).toBe(70);
      expect(r.def_skill_eff).toBe(65);
      // Line rolls within their bounds
      expect(r.off_line_roll).toBeGreaterThanOrEqual(0);
      expect(r.off_line_roll).toBeLessThanOrEqual(80);
      expect(r.def_line_roll).toBeGreaterThanOrEqual(0);
      expect(r.def_line_roll).toBeLessThanOrEqual(60);
      expect(r.off_line_skill).toBe(80);
      expect(r.def_line_skill).toBe(60);
    }
  });

  it('run/pass: line winner + regime computed correctly', () => {
    // Force a known seed → fixed roll. We don't know which seed wins the line
    // without inspecting; just sanity-check the relationship:
    //   if line_regime is null → line_winner is also null (sub-LEAN rolls skipped)
    //   if line_regime is set → line_winner must be set
    for (let seed = 1; seed <= 50; seed++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 65,
        off_line_skill: 90,
        def_line_skill: 60,
        off_play: { parent: 'pass', sub: 'short' },
        def_play: { parent: 'pass', sub: 'short' },
        seed,
      });
      if (r.line_regime === null) {
        // Sub-LEAN gap → gap < 5 OR tied → no winner picked
        expect(r.line_winner === null || r.line_roll_gap < 5).toBe(true);
      } else {
        expect(r.line_winner).not.toBeNull();
        expect(['lean', 'dominate']).toContain(r.line_regime);
        expect(r.line_roll_gap).toBeGreaterThanOrEqual(5);
        if (r.line_regime === 'dominate') {
          expect(r.line_roll_gap).toBeGreaterThanOrEqual(15);
        }
      }
    }
  });

  it('parent mismatch: off_roll + def_roll stay 0 (no skill roll fired)', () => {
    // When defense guesses wrong parent, offense auto-wins — no roll is made,
    // so the values stay at their default 0. The HUD will detect this case
    // by checking `parent_match === false` and skip the skill-roll display.
    const r = resolvePlay({
      off_skill: 70,
      def_skill: 65,
      off_play: { parent: 'run', sub: 'inside' },
      def_play: { parent: 'pass', sub: 'deep' },
      seed: 42,
    });
    expect(r.parent_match).toBe(false);
    expect(r.off_roll).toBe(0);
    expect(r.def_roll).toBe(0);
  });

  it('punt/fg: line rolls stay 0 (line roll skipped for non-run/pass)', () => {
    // Punt and FG don't trigger the line roll mechanic. Even though the
    // resolver returns 0 for off_roll/def_roll/off_line_roll/etc. in those
    // cases, the game_machine constructs the PlayResult for punt/fg directly
    // (not via resolvePlay) so this test documents the resolver contract.
    const r = resolvePlay({
      off_skill: 70,
      def_skill: 65,
      off_line_skill: 80,
      def_line_skill: 60,
      off_play: { parent: 'punt', sub: 'inside' as any },
      def_play: { parent: 'punt', sub: 'inside' as any },
      seed: 42,
    });
    expect(r.off_line_roll).toBe(0);
    expect(r.def_line_roll).toBe(0);
    expect(r.off_line_skill).toBe(0);
    expect(r.def_line_skill).toBe(0);
    expect(r.line_winner).toBeNull();
    expect(r.line_regime).toBeNull();
  });

  it('QB modifier scales the effective skill (HUD shows post-mod value)', () => {
    // off_skill 50 + +20% off_skill_pct pass mod → 60 effective
    const r = resolvePlay({
      off_skill: 50,
      def_skill: 70,
      off_play: { parent: 'pass', sub: 'short' },
      def_play: { parent: 'pass', sub: 'short' },
      qb_off_modifiers: [{ stat: 'off_skill_pct', value: 20, scope: 'pass' }],
      seed: 1,
    });
    expect(r.off_skill_eff).toBe(60);
    expect(r.off_roll).toBeLessThanOrEqual(60);
    expect(r.def_skill_eff).toBe(70);
  });
});

describe('attemptFieldGoal — Phase 0 fg_* fields available', () => {
  it('returns power_roll, bonus_roll, total, power_used', () => {
    const fg = attemptFieldGoal({
      yards_to_endzone: 30,
      kicker_power: 80,
      seed: 42,
    });
    expect(fg.power_roll).toBeGreaterThanOrEqual(0);
    expect(fg.power_roll).toBeLessThanOrEqual(80);
    expect(fg.bonus_roll).toBeGreaterThanOrEqual(0);
    expect(fg.bonus_roll).toBeLessThanOrEqual(20);
    expect(fg.total).toBe(fg.power_roll + fg.bonus_roll);
    expect(fg.power_used).toBe(80);
    // make iff total > ytg
    expect(fg.make).toBe(fg.total > 30);
  });

  it('QB kicker_power_pct modifier scales power_used', () => {
    const fg = attemptFieldGoal({
      yards_to_endzone: 30,
      kicker_power: 50,
      seed: 1,
      qb_modifiers: [{ stat: 'kicker_power_pct', value: 50, scope: 'fg' }],
    });
    expect(fg.power_used).toBe(75); // 50 * 1.5
    expect(fg.power_roll).toBeLessThanOrEqual(75);
  });
});