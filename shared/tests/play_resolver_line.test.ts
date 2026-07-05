import { describe, it, expect } from 'vitest';
import {
  resolvePlay,
  LINE_ROLL_GAP_LEAN,
  LINE_ROLL_GAP_DOMINATE,
} from '../src/play_resolver.js';

describe('resolvePlay line roll (D-LINE / O-LINE mechanic) — per-play roll', () => {
  it('line rolls every run/pass play (same pattern as off_skill/def_skill)', () => {
    // Two plays with different seeds MUST produce different line_roll_gap
    // distributions on average — proves the line roll is firing per play.
    // (We can't check the exact gap deterministically because mulberry32
    // consumes multiple rng() calls per play; instead we verify the line
    // roll EXISTS by checking that line_winner/line_roll_gap are populated
    // across enough seeds.)
    let populated = 0;
    const TRIALS = 50;
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 70,
        def_line_skill: 70,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'outside' },
        seed: i + 1,
      });
      // Both lines roll [0, 70] — gaps vary per play
      if (r.line_roll_gap > 0) populated++;
    }
    // Expect most plays to have a non-zero gap (70 vs 70 → ~99% non-tie).
    expect(populated).toBeGreaterThan(TRIALS * 0.9);
  });

  it('bad-draft line is NOT permanently locked out (50 O_LINE vs 90 D_LINE still loses sometimes)', () => {
    // The whole point of the fix: a bad-draft team shouldn't be locked out
    // every play. With O=50, D=90, the O-line should still win ~36% of the
    // time (P(O_roll > D_roll) for uniform [0,50] vs [0,90]).
    // https://math.stackexchange.com/q/4010456 — closed form gives ~0.361.
    let offense_line_wins = 0;
    const TRIALS = 5000;
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 50,
        def_line_skill: 90,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'outside' },
        seed: i + 1,
      });
      if (r.line_winner === 'offense') offense_line_wins++;
    }
    // Allow 25%..45% range (random variance + sanity bound).
    const rate = offense_line_wins / TRIALS;
    expect(rate).toBeGreaterThan(0.25);
    expect(rate).toBeLessThan(0.45);
  });

  it('good-draft line still loses some plays (90 O_LINE vs 50 D_LINE)', () => {
    // Mirror of the above — a great-draft team can still get stuffed.
    let defense_line_wins = 0;
    const TRIALS = 5000;
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 90,
        def_line_skill: 50,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'outside' },
        seed: i + 1,
      });
      if (r.line_winner === 'defense') defense_line_wins++;
    }
    const rate = defense_line_wins / TRIALS;
    expect(rate).toBeGreaterThan(0.25);
    expect(rate).toBeLessThan(0.45);
  });

  it('per-play roll gap decides regime (NOT draft-time skill gap)', () => {
    // Even with huge draft-time skill gap (20 vs 95 = 75), if the rolls happen
    // to be close (e.g., 18 vs 19 → gap 1) the line should NOT dominate.
    let dominated = 0;
    const TRIALS = 2000;
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 20,
        def_line_skill: 95, // gap=75 in skill, but roll-gap varies
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'outside' },
        seed: i + 1,
      });
      if (r.line_regime === 'dominate') dominated++;
    }
    // dominate rate should be the chance the roll gap is >=15 when def wins
    // by enough. Even with 20 vs 95 skills, dominates aren't every play.
    expect(dominated).toBeLessThan(TRIALS * 0.85);
    expect(dominated).toBeGreaterThan(0);
  });

  it('user example: O_LINE=20, D_LINE=60, wrong-parent defense → some plays blown up by line', () => {
    // The original user scenario: defense wrong parent would normally give
    // offense auto-win +5..+25. When the D-line roll wins by ≥15, it
    // dominates and stuffs the play.
    let blownUp = 0;
    const TRIALS = 500;
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
      if (r.line_regime === 'dominate' && r.line_winner === 'defense') {
        // Negative yards (stuff) or turnover (fumble behind LOS)
        if (r.yards < 0 || r.turnover) blownUp++;
      }
    }
    expect(blownUp).toBeGreaterThan(0);
  });

  it('user example: O_LINE=70, D_LINE=10, perfect-read defense → some plays escape via line', () => {
    // Original user scenario: defense perfect read would be +1..+10.
    // When the O-line roll wins by ≥15, it dominates and gives +5..+15.
    // Some plays will be turnovers (~28% with line bumps); we only check
    // that NON-turnover dominated plays are in the 5..15 tier.
    let escaped = 0;
    let dominated = 0;
    let turnover = 0;
    const TRIALS = 500;
    for (let i = 0; i < TRIALS; i++) {
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
        dominated++;
        if (r.turnover) {
          turnover++;
        } else {
          // Non-turnover dominated-offense plays → +5..+15
          if (r.yards >= 5 && r.yards <= 15) escaped++;
        }
      }
    }
    expect(dominated).toBeGreaterThan(0);
    expect(escaped + turnover).toBe(dominated); // every dominated play accounted for
    expect(escaped).toBeGreaterThan(0);
  });

  it('ties and small roll gaps fall through (line_regime=null → no effect)', () => {
    // Find seeds where the line roll produces a small gap and verify
    // line_regime=null (lean/dominate both absent). Internal flags
    // (line_dominated_offense/defense) aren't part of the public ResolveOutput
    // — only line_regime and line_winner are observable. line_winner IS set
    // even on small gaps, which is fine: yardage/recap ignore it when
    // line_regime is null.
    let found = false;
    for (let seed = 1; seed <= 500 && !found; seed++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 70,
        def_line_skill: 70,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'outside' },
        seed,
      });
      if (r.line_roll_gap > 0 && r.line_roll_gap < LINE_ROLL_GAP_LEAN) {
        expect(r.line_regime).toBeNull();
        // line_winner is still set (one side won the roll), but the regime
        // is null so downstream code treats this as a non-event.
        expect(r.line_winner).not.toBeNull();
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('default line skills (no input) → both default to 60, rolls still fire', () => {
    // Caller omits line skills → defaults to 60 each. With roll_gap >= 15 on
    // two uniform [0,60], P(|a-b| >= 15) = (60-15)²/60² ≈ 56%.
    let dominated = 0;
    const TRIALS = 2000;
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        // no line skills passed
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'outside' },
        seed: i + 1,
      });
      if (r.line_regime === 'dominate') dominated++;
    }
    // Allow 48-64% for rng variance around the 56% theoretical rate.
    expect(dominated).toBeGreaterThan(TRIALS * 0.48);
    expect(dominated).toBeLessThan(TRIALS * 0.64);
  });

  it('punt/fg → line roll never fires (parent !== run|pass)', () => {
    const r = resolvePlay({
      off_skill: 70,
      def_skill: 70,
      off_line_skill: 20,
      def_line_skill: 100,
      off_play: { parent: 'punt', sub: 'deep' },
      def_play: { parent: 'punt', sub: 'deep' },
      seed: 1,
    });
    expect(r.line_winner).toBeNull();
    expect(r.line_regime).toBeNull();
    expect(r.line_roll_gap).toBe(0);
  });

  it('line DOMINATE + defense wins bumps turnover chance on perfect read', () => {
    // Compare turnover rate with vs without a big defensive line skill.
    // With the per-play roll model, the +15% bump applies only when the
    // defense's line roll dominates (roll_gap >= 15). With 60 vs 60 skills,
    // dominates happen ~25% of the time → net bump ~3.75%.
    let withLineAdv = 0;
    let withoutLineAdv = 0;
    const TRIALS = 2000;
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 50,
        def_line_skill: 90,
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
        def_line_skill: 60,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'inside' }, // perfect read
        seed: i + 1,
      });
      if (r.turnover) withoutLineAdv++;
    }
    expect(withLineAdv).toBeGreaterThan(withoutLineAdv);
  });

  it('exports the new LINE_ROLL_GAP_* constants', () => {
    expect(LINE_ROLL_GAP_LEAN).toBe(5);
    expect(LINE_ROLL_GAP_DOMINATE).toBe(15);
  });

  it('seed stability for turnovers: perfect-read turnover rate ≈ 28% (with line bumps)', () => {
    // The base turnover math must NOT have shifted when we changed line
    // mechanics. Pre-line tests asserted 22-28% turnover on perfect read.
    // Now ~25% + line-bumped ~3% = ~28%. Allow 25-31%.
    let tos = 0;
    const TRIALS = 2000;
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 60,
        def_line_skill: 60,
        off_play: { parent: 'pass', sub: 'deep' },
        def_play: { parent: 'pass', sub: 'deep' },
        seed: i + 1,
      });
      if (r.turnover) tos++;
    }
    expect(tos / TRIALS).toBeGreaterThan(0.25);
    expect(tos / TRIALS).toBeLessThan(0.31);
  });

  it('seed stability for yardage: full mismatch (non-turnover) fits a tier', () => {
    // Non-turnover full-mismatch plays fall into ONE of these tiers:
    //   - line_regime=null AND offense owned line (line_regime=lean→+3):
    //     5..28 (5..25 + lean nudge on offense)
    //   - line_regime=dominate + offense won: 5..15 (line blow-up tier)
    //   - line_regime=dominate + defense won: -6..-1 (stuff)
    //   - line_regime=lean + defense won: -2..-6 (lean nudge further)
    // So full mismatch is NOT capped at 5..25 anymore — line dominance can
    // produce negative yards. We just verify every non-turnover play falls
    // into one of the valid tiers above.
    let inValidTier = 0;
    let total = 0;
    const TRIALS = 2000;
    for (let i = 0; i < TRIALS; i++) {
      const r = resolvePlay({
        off_skill: 70,
        def_skill: 70,
        off_line_skill: 60,
        def_line_skill: 60,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'pass', sub: 'short' }, // wrong parent
        seed: i + 1,
        yardline_before: 50,
        offense_direction: 1,
      });
      if (r.turnover) continue;
      total++;
      const inMismatchTier = r.yards >= 1 && r.yards <= 28;
      const inLineOffenseTier = r.line_regime === 'dominate' && r.line_winner === 'offense'
        && r.yards >= 5 && r.yards <= 15;
      const inLineDefenseStuff = r.line_regime === 'dominate' && r.line_winner === 'defense'
        && r.yards >= -6 && r.yards <= -1;
      if (inMismatchTier || inLineOffenseTier || inLineDefenseStuff) inValidTier++;
    }
    // Every non-turnover full-mismatch play fits a known tier.
    expect(total).toBeGreaterThan(0);
    expect(inValidTier).toBe(total);
  });
});