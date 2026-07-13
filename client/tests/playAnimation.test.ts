import { describe, expect, it } from 'vitest';
import {
  PLAY_TICKS,
  buildPlayPlan,
  effectsBetween,
  frameAt,
  type PlayAnimationResult,
} from '../src/components/playAnimation.js';
import type { PlayOutcome } from '@gridiron/shared';

function result(
  parent: 'run' | 'pass' | 'punt' | 'fg',
  sub: 'inside' | 'outside' | 'short' | 'deep',
  outcome?: PlayOutcome,
  extra: Partial<PlayAnimationResult> = {},
): PlayAnimationResult {
  return {
    seed: 0xdecafbad,
    yards: 8,
    off_call: { parent, sub },
    play_outcome: outcome,
    yardline_before: 45,
    yardline_after: 53,
    scoring_event: null,
    turnover: false,
    text_recap: '',
    ...extra,
  };
}

function geometry(plan: ReturnType<typeof buildPlayPlan>) {
  return plan.frames.map((frame) => ({
    tick: frame.tick,
    ball: frame.ball,
    players: frame.players.map(({ team: _team, ...player }) => player),
  }));
}

describe('play animation planner', () => {
  it('is deterministic from the PlayResult seed', () => {
    const play = result('run', 'outside', 'run', { seed: 12345, yards: 17 });
    expect(buildPlayPlan(play, 0)).toEqual(buildPlayPlan({ ...play }, 0));
    expect(buildPlayPlan({ ...play, seed: 12346 }, 0)).not.toEqual(buildPlayPlan(play, 0));
  });

  it('returns only one of 96 fixed simulation ticks', () => {
    const plan = buildPlayPlan(result('run', 'inside', 'run'), 0);
    expect(plan.frames).toHaveLength(PLAY_TICKS);
    expect(frameAt(plan, 0.105)).toBe(frameAt(plan, 0.109));
    expect(frameAt(plan, -2).tick).toBe(0);
    expect(frameAt(plan, 2).tick).toBe(PLAY_TICKS - 1);
    expect(frameAt(plan, Number.NaN).tick).toBe(0);
  });

  it('prefers effective_off_call, otherwise flips a real audible', () => {
    const audible = result('pass', 'deep', 'pass_complete', {
      off_audible: { parent: 'pass', sub: 'short' },
    });
    expect(buildPlayPlan(audible, 0).effectiveCall).toEqual({ parent: 'pass', sub: 'short' });

    const explicit = { ...audible, effective_off_call: { parent: 'run', sub: 'outside' } as const };
    expect(buildPlayPlan(explicit, 0).effectiveCall).toEqual({ parent: 'run', sub: 'outside' });
  });

  it('gives short and deep passes distinct drops, routes, and ball arcs', () => {
    const short = buildPlayPlan(result('pass', 'short', 'pass_complete', { yards: 9 }), 0);
    const deep = buildPlayPlan(result('pass', 'deep', 'pass_complete', { yards: 24 }), 0);
    const shortQb = frameAt(short, 0.4).players.find((p) => p.role === 'QB');
    const deepQb = frameAt(deep, 0.4).players.find((p) => p.role === 'QB');
    expect(deepQb!.xOffset).toBeLessThan(shortQb!.xOffset);
    expect(frameAt(deep, 0.58).ball.height).toBeGreaterThan(0.3);
    expect(deep.effects.some((event) => event.type === 'throw')).toBe(true);

    const incomplete = buildPlayPlan(result('pass', 'short', 'pass_incomplete', { yards: 0 }), 0);
    expect(incomplete.effects.some((event) => event.type === 'bounce')).toBe(true);
    expect(frameAt(incomplete, 0.9).banner?.text).toBe('INCOMPLETE');
  });

  it('turns line and defensive-read rolls into visible blocking and pursuit', () => {
    const offenseLine = buildPlayPlan(result('run', 'inside', 'run', {
      line_winner: 'offense',
      line_regime: 'dominate',
      parent_match: false,
      sub_match: false,
    }), 0);
    const defenseLine = buildPlayPlan(result('run', 'inside', 'run', {
      line_winner: 'defense',
      line_regime: 'dominate',
      parent_match: true,
      sub_match: true,
    }), 0);
    const offensePush = offenseLine.frames[42].players.find((p) => p.role === 'OL')!;
    const defensePush = defenseLine.frames[42].players.find((p) => p.role === 'OL')!;
    const misreadLb = offenseLine.frames[28].players.find((p) => p.role === 'LB')!;
    const readingLb = defenseLine.frames[28].players.find((p) => p.role === 'LB')!;

    expect(offensePush.xOffset).toBeGreaterThan(defensePush.xOffset);
    expect(misreadLb.xOffset).toBeGreaterThan(readingLb.xOffset);
    expect(offenseLine.effects.filter((event) => event.type === 'block')).toHaveLength(3);
    const pass = buildPlayPlan(result('pass', 'deep', 'pass_complete'), 0);
    expect(pass.effects.filter((event) => event.type === 'block')).toHaveLength(3);
  });

  it('returns every audio event crossed by a skipped render frame once', () => {
    const plan = buildPlayPlan(result('pass', 'short', 'pass_complete'), 0);
    expect(effectsBetween(plan.effects, 3, 14).map((event) => event.type)).toEqual(['snap', 'block']);
    expect(effectsBetween(plan.effects, 14, 24)).toEqual([]);
    expect(effectsBetween(plan.effects, 24, 38).map((event) => event.type)).toEqual(['block', 'throw', 'block']);
  });

  it('shows an interception catch and backward return without changing authoritative advance', () => {
    const plan = buildPlayPlan(result('pass', 'deep', 'interception', {
      yards: 0,
      turnover: true,
    }), 0);
    const catchFrame = plan.frames[68];
    const finalFrame = plan.frames[91];
    const interceptorAtCatch = catchFrame.players.find((p) => p.side === 'defense' && p.pose === 'catch');
    const interceptorAtEnd = finalFrame.players.find((p) => p.id === finalFrame.ball.carrierId);
    expect(interceptorAtCatch).toBeDefined();
    expect(interceptorAtEnd?.facing).toBe('defense');
    expect(finalFrame.ball.xOffset).toBeLessThan(catchFrame.ball.xOffset);
    expect(plan.authoritativeAdvance).toBe(0);
    expect(plan.banner?.text).toBe('INTERCEPTION!');
  });

  it('animates a loose fumble, recovery, and optional return', () => {
    const plan = buildPlayPlan(result('run', 'inside', 'fumble', {
      yards: 3,
      turnover: true,
    }), 1);
    expect(plan.effects.some((event) => event.type === 'loose_ball')).toBe(true);
    expect(plan.frames[66].ball.carrierId).toBeUndefined();
    expect(plan.frames[91].ball.carrierId).toMatch(/^d-/);
    expect(plan.frames[91].ball.xOffset).toBeLessThan(3);
    expect(plan.authoritativeAdvance).toBe(3);
  });

  it('keeps all geometry offense-relative when possession changes', () => {
    const play = result('run', 'outside', 'run', {
      yards: 12,
      offense_direction: -1,
    });
    const teamZero = buildPlayPlan(play, 0);
    const teamOne = buildPlayPlan({ ...play, offense_direction: 1 }, 1);
    expect(geometry(teamZero)).toEqual(geometry(teamOne));
    expect(teamZero.frames[0].players.filter((p) => p.side === 'offense').every((p) => p.team === 0)).toBe(true);
    expect(teamOne.frames[0].players.filter((p) => p.side === 'offense').every((p) => p.team === 1)).toBe(true);
  });

  it('snaps, kicks, and lands a punt at the authoritative forward offset', () => {
    const plan = buildPlayPlan(result('punt', 'inside', 'punt', {
      yards: 41,
      punt_roll: 41,
    }), 0);
    expect(plan.frames[12].ball.xOffset).toBeLessThan(0);
    expect(plan.frames[55].ball.height).toBeGreaterThan(0.8);
    expect(plan.frames[95].ball.xOffset).toBe(41);
    expect(plan.effects.some((event) => event.type === 'kick')).toBe(true);
  });

  it('handles blocked punts and blocked or missed field goals', () => {
    const blockedPunt = buildPlayPlan(result('punt', 'inside', 'punt_blocked', { yards: 0 }), 0);
    expect(blockedPunt.effects.some((event) => event.type === 'impact')).toBe(true);
    expect(Math.abs(blockedPunt.frames[95].ball.xOffset)).toBeLessThan(3);

    const blockedFg = buildPlayPlan(result('fg', 'inside', 'field_goal_blocked', { yards: 0 }), 0);
    expect(blockedFg.effects.some((event) => event.type === 'bounce')).toBe(true);
    expect(blockedFg.frames[95].ball.height).toBe(0);

    const missedFg = buildPlayPlan(result('fg', 'inside', 'field_goal_missed', { yards: 0 }), 0);
    expect([0.06, 0.94]).toContain(missedFg.frames[95].ball.y);
    expect(missedFg.banner?.text).toBe('NO GOOD');
  });

  it('renders shootout kicks without a defense or block effects', () => {
    const plan = buildPlayPlan(result('fg', 'inside', 'field_goal_good', {
      shootout_attempt: {
        round: 1,
        distance: 25,
        player_idx: 0,
        made: true,
        power_roll: 40,
        bonus_roll: 10,
        total: 50,
        power_used: 70,
        seed: 1,
      },
    }), 0);
    expect(plan.frames[0].players.filter((player) => player.side === 'offense')).toHaveLength(11);
    expect(plan.frames[0].players.filter((player) => player.side === 'defense')).toHaveLength(0);
    expect(plan.effects.some((event) => event.type === 'block')).toBe(false);
  });

  it('starts every formation with a complete 22-player pre-snap roster', () => {
    for (const play of [
      result('run', 'inside', 'run'),
      result('pass', 'deep', 'pass_complete'),
      result('punt', 'inside', 'punt'),
      result('fg', 'inside', 'field_goal_good'),
    ]) {
      const frame = buildPlayPlan(play, 0).frames[0];
      expect(frame.players).toHaveLength(22);
      expect(frame.players.filter((p) => p.side === 'offense')).toHaveLength(11);
      expect(frame.players.filter((p) => p.side === 'defense')).toHaveLength(11);
      expect(new Set(frame.players.map((p) => p.id)).size).toBe(22);
      expect(frame.players.every((p) => p.pose === 'stance')).toBe(true);
    }
  });

  it('infers outcomes for old payloads without play_outcome', () => {
    expect(buildPlayPlan(result('punt', 'inside', undefined, { text_recap: 'PUNT BLOCKED!' }), 0).outcome).toBe('punt_blocked');
    expect(buildPlayPlan(result('fg', 'inside', undefined, { scoring_event: 'fg' }), 0).outcome).toBe('field_goal_good');
    expect(buildPlayPlan(result('pass', 'short', undefined, { yards: 0 }), 0).outcome).toBe('pass_incomplete');
    expect(buildPlayPlan(result('run', 'inside', undefined, { turnover: true }), 0).outcome).toBe('fumble');
    expect(buildPlayPlan(result('pass', 'deep', undefined, { scoring_event: 'td', turnover: true }), 0).outcome).toBe('pass_complete');
  });
});
