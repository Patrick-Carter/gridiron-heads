import { describe, expect, it } from 'vitest';
import { advanceAfterPlay, newGameState } from '../src/game_state.js';
import { resolvePlay } from '../src/play_resolver.js';
import type { GameState, TeamState } from '../src/types.js';

const run = { parent: 'run', sub: 'inside' } as const;
const runDefense = { parent: 'run', sub: 'outside' } as const;

function emptyTeams(): [TeamState, TeamState] {
  const team = {
    qb: null,
    d_line: null,
    o_line: null,
    off_skill: null,
    def_skill: null,
    kicker: null,
  };
  return [{ ...team }, { ...team }];
}

describe('shared rule fixes', () => {
  it('applies offense and defense skill modifiers only to their matching effective skill', () => {
    const result = resolvePlay({
      off_skill: 50,
      def_skill: 60,
      off_play: run,
      def_play: runDefense,
      qb_off_modifiers: [
        { stat: 'off_skill_pct', value: 20, scope: 'run' },
        { stat: 'def_skill_pct', value: 50, scope: 'run' },
      ],
      qb_def_modifiers: [
        { stat: 'def_skill_pct', value: 20, scope: 'run' },
        { stat: 'off_skill_pct', value: 50, scope: 'run' },
      ],
      seed: 1,
    });

    expect(result.off_skill_eff).toBe(60);
    expect(result.def_skill_eff).toBe(72);
  });

  it('activates 4th_down modifiers only when optional down is 4', () => {
    const modifier = [{ stat: 'off_skill_pct', value: 20, scope: '4th_down' }] as const;
    const input = {
      off_skill: 50,
      def_skill: 60,
      off_play: run,
      def_play: runDefense,
      qb_off_modifiers: [...modifier],
      seed: 1,
    };

    expect(resolvePlay(input).off_skill_eff).toBe(50);
    expect(resolvePlay({ ...input, down: 3 }).off_skill_eff).toBe(50);
    expect(resolvePlay({ ...input, down: 4 }).off_skill_eff).toBe(60);
  });

  it('yards_pct improves positive gains without magnifying negative yardage', () => {
    const modifier = [{ stat: 'yards_pct', value: 50, scope: 'run' }] as const;
    const lossInput = {
      off_skill: 1,
      def_skill: 100,
      off_line_skill: 0,
      def_line_skill: 100,
      off_play: run,
      def_play: runDefense,
      seed: 1,
    };
    const gainInput = {
      off_skill: 100,
      def_skill: 1,
      off_line_skill: 100,
      def_line_skill: 0,
      off_play: run,
      def_play: { parent: 'pass', sub: 'deep' } as const,
      seed: 1,
    };

    const loss = resolvePlay(lossInput);
    const buffedLoss = resolvePlay({ ...lossInput, qb_off_modifiers: [...modifier] });
    const gain = resolvePlay(gainInput);
    const buffedGain = resolvePlay({ ...gainInput, qb_off_modifiers: [...modifier] });

    expect(loss.yards).toBe(-2);
    expect(buffedLoss.yards).toBe(loss.yards);
    expect(gain.yards).toBe(8);
    expect(buffedGain.yards).toBe(12);
  });

  it('prevents turnovers on tied skill rolls unless line dominance changes the outcome', () => {
    const tied = resolvePlay({
      off_skill: 10,
      def_skill: 10,
      off_line_skill: 1,
      def_line_skill: 1,
      off_play: run,
      def_play: run,
      seed: 14,
    });
    const dominated = resolvePlay({
      off_skill: 10,
      def_skill: 10,
      off_line_skill: 0,
      def_line_skill: 100,
      off_play: run,
      def_play: run,
      seed: 14,
    });

    expect([tied.off_roll, tied.def_roll]).toEqual([4, 4]);
    expect(tied.line_regime).toBeNull();
    expect(tied.turnover_chance).toBe(0);
    expect(tied.turnover).toBe(false);

    expect([dominated.off_roll, dominated.def_roll]).toEqual([4, 4]);
    expect(dominated.line_regime).toBe('dominate');
    expect(dominated.turnover_chance).toBe(0.4);
    expect(dominated.turnover).toBe(true);
  });

  it.each([
    { possession_idx: 0 as const, yardline: 85, expectedYardline: 91 },
    { possession_idx: 1 as const, yardline: 15, expectedYardline: 9 },
  ])('sets first-and-goal distance from the target end zone for possession $possession_idx', ({
    possession_idx,
    yardline,
    expectedYardline,
  }) => {
    const state: GameState = {
      ...newGameState('s', emptyTeams()),
      possession_idx,
      down: 2,
      distance: 5,
      ball_yardline: yardline,
    };

    const { next } = advanceAfterPlay(state, 6);
    expect(next.ball_yardline).toBe(expectedYardline);
    expect(next.down).toBe(1);
    expect(next.distance).toBe(9);
  });

  it.each([
    { yardline_before: 100, offense_direction: 1 as const, forceGain: true },
    { yardline_before: 0, offense_direction: -1 as const, forceGain: true },
    { yardline_before: 0, offense_direction: 1 as const, forceGain: false },
    { yardline_before: 100, offense_direction: -1 as const, forceGain: false },
  ])('reports zero movement at an exact field boundary: $yardline_before/$offense_direction', ({
    yardline_before,
    offense_direction,
    forceGain,
  }) => {
    const result = resolvePlay({
      off_skill: forceGain ? 100 : 1,
      def_skill: forceGain ? 1 : 100,
      off_line_skill: forceGain ? 100 : 0,
      def_line_skill: forceGain ? 0 : 100,
      off_play: run,
      def_play: forceGain ? { parent: 'pass', sub: 'deep' } : run,
      yardline_before,
      offense_direction,
      seed: 1,
    });

    expect(result.turnover).toBe(false);
    expect(result.yards).toBe(0);
  });
});
