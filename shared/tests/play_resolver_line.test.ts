import { describe, it, expect } from 'vitest';
import { resolvePlay, LINE_GAP_LEAN, LINE_GAP_DOMINATE } from '../src/play_resolver.js';

describe('resolvePlay line roll (D-LINE / O-LINE mechanic)', () => {
  it('gap below LINE_GAP_LEAN → line roll skipped (line_winner=null, line_regime=null)', () => {
    // Gap = 15 (60 vs 75) — below the 20 threshold. No rng calls for line.
    const r = resolvePlay({
      off_skill: 70,
      def_skill: 70,
      off_line_skill: 60,
      def_line_skill: 75,
      off_play: { parent: 'run', sub: 'inside' },
      def_play: { parent: 'run', sub: 'outside' },
      seed: 42,
    });
    expect(r.line_winner).toBeNull();
    expect(r.line_regime).toBeNull();
    expect(r.line_roll_gap).toBe(0);
  });

  it('LEAP gap but default line skills → line stays dormant (both null = 60)', () => {
    // Caller didn't pass line skills. Defaults to 60/60 → gap 0 → dormant.
    const r = resolvePlay({
      off_skill: 70,
      def_skill: 70,
      off_play: { parent: 'run', sub: 'inside' },
      def_play: { parent: 'run', sub: 'outside' },
      seed: 42,
    });
    expect(r.line_winner).toBeNull();
  });

  it('DOMINATE gap + wrong-parent defense + defense line wins → play blown up (negative yards)', () => {
    // The user's example: defense wrong parent → would auto-win offense +5..+25.
    // But O_LINE=20, D_LINE=60 → gap 40 (DOMINATE), line favors defense → stuff.
    let sawNegative = 0;
    const TRIALS = 200;
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 20,
        def_line_skill: 60,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'pass', sub: 'short' }, // wrong parent
        seed: i + 1,
        yardline_before: 50,
        offense_direction: 1,
      });
      expect(r.parent_match).toBe(false);
      // The defense won the line roll so often enough that we should see some
      // dominated-outcome negative-yard plays.
      if (r.line_regime === 'dominate' && r.line_winner === 'defense') {
        expect(r.yards).toBeLessThanOrEqual(0);
        sawNegative++;
      }
    }
    // At gap=40 with def_line=60, defense should win the line roll >70% of the time
    // (offense rolls [0,20], defense rolls [0,60]).
    expect(sawNegative).toBeGreaterThan(0);
  });

  it('DOMINATE gap + perfect-read defense + offense line wins → offense escapes (5..15 yards)', () => {
    // The user's example: defense perfect read would be +1..+10.
    // O_LINE=70, D_LINE=10 → gap 60 (DOMINATE), offense wins → +5..+15.
    // Some of these will be turnovers (25% baseline from the perfect read), in
    // which case yards=0 by design. The non-turnover ones must all be 5..15.
    let inRange = 0;
    let turnover = 0;
    let total = 0;
    for (let i = 0; i < 500; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 70,
        def_line_skill: 10,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'inside' }, // perfect read
        seed: i + 1,
        yardline_before: 50,
        offense_direction: 1,
      });
      if (r.line_regime === 'dominate' && r.line_winner === 'offense') {
        total++;
        if (r.turnover) {
          turnover++;
          expect(r.yards).toBe(0);
        } else {
          // Non-turnover dominated-offense plays → +5..+15.
          if (r.yards >= 5 && r.yards <= 15) inRange++;
        }
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(inRange + turnover).toBe(total); // every dominated play accounted for
    expect(inRange).toBeGreaterThan(0);
  });

  it('DOMINATE gap + defense line wins + perfect-read offense → stuff behind LOS (or fumble)', () => {
    // Defense's perfect read should still allow offense to win the skill roll
    // when off_skill >= def_skill. But line dominating defense blows it up.
    // Result is EITHER negative yards (stuff, 60% of the time) OR turnover
    // (fumble behind the LOS, ~40% — the bumped +15% turnover chance fires).
    let sawStuff = 0;
    let sawFumble = 0;
    for (let i = 0; i < 500; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 15,
        def_line_skill: 90,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'inside' }, // perfect read
        seed: i + 1,
        yardline_before: 50,
        offense_direction: 1,
      });
      if (r.line_regime === 'dominate' && r.line_winner === 'defense') {
        if (r.turnover) {
          sawFumble++;
          // Turnover = ball lost; yards = 0 by design.
          expect(r.yards).toBe(0);
        } else {
          // No turnover, the stuff happened — must be negative.
          expect(r.yards).toBeLessThan(0);
          sawStuff++;
        }
      }
    }
    expect(sawStuff + sawFumble).toBeGreaterThan(0);
    expect(sawFumble).toBeGreaterThan(0); // line-bump +15% should fire some fumbles
  });

  it('LEAP gap but tied line roll → line dormant (no regime, no winner)', () => {
    // O_LINE=20, D_LINE=60 → gap 40. But seed produces a tied roll.
    // Find a seed where the line roll ties (off_line_roll == def_line_roll).
    let found = false;
    for (let seed = 1; seed <= 200 && !found; seed++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 20,
        def_line_skill: 60,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'outside' },
        seed,
      });
      if (r.line_roll_gap === 0) {
        expect(r.line_winner).toBeNull();
        expect(r.line_regime).toBeNull();
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('does NOT consume rng for line when gap < threshold → downstream rolls identical to no-line call', () => {
    // Same seed, same off/def skill. Line inputs below threshold should NOT
    // shift the yardage distribution vs. omitting line skills entirely.
    let identical = 0;
    const TRIALS = 100;
    for (let i = 0; i < TRIALS; i++) {
      const a = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 55,
        def_line_skill: 65, // gap=10, dormant
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'inside' },
        seed: i + 1,
      });
      const b = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        // no line skills → defaults to 60/60, gap=0, also dormant
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'inside' },
        seed: i + 1,
      });
      if (a.yards === b.yards && a.turnover === b.turnover) identical++;
    }
    expect(identical).toBe(TRIALS);
  });

  it('exports the LINE_GAP_* constants so callers/tests can reference them', () => {
    expect(LINE_GAP_LEAN).toBe(20);
    expect(LINE_GAP_DOMINATE).toBe(40);
  });

  it('punt/fg → line roll never fires (parent !== run|pass)', () => {
    const r = resolvePlay({
      off_skill: 70,
      def_skill: 70,
      off_line_skill: 20,
      def_line_skill: 100, // massive gap
      off_play: { parent: 'punt', sub: 'deep' },
      def_play: { parent: 'punt', sub: 'deep' },
      seed: 1,
    });
    expect(r.line_winner).toBeNull();
    expect(r.line_regime).toBeNull();
  });

  it('DOMINATE + defense line wins bumps turnover chance (+15%) on perfect read', () => {
    // Perfect read (parent+sub match) baseline = 25% turnover.
    // Add line dominate defense → expected ≈ 25% + 15%*line_dominance_rate.
    // Compare turnover rate with vs without a big defensive line advantage.
    let withLineAdv = 0;
    let withoutLineAdv = 0;
    const TRIALS = 1000;
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 15,
        def_line_skill: 95, // gap=80, dominates
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'inside' }, // perfect read
        seed: i + 1,
      });
      if (r.turnover) withLineAdv++;
    }
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 60,
        def_line_skill: 60, // tied lines, no line roll
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'inside' }, // perfect read
        seed: i + 1,
      });
      if (r.turnover) withoutLineAdv++;
    }
    expect(withLineAdv).toBeGreaterThan(withoutLineAdv);
  });
});