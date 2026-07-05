import { describe, it, expect } from 'vitest';
import { newGameState, advanceAfterPlay } from '../src/game_state.js';
import type { GameState, TeamState } from '../src/types.js';

function emptyTeams(): [TeamState, TeamState] {
  return [
    {
      qb: null,
      d_line: null,
      o_line: null,
      off_skill: null,
      def_skill: null,
      kicker: null,
    },
    {
      qb: null,
      d_line: null,
      o_line: null,
      off_skill: null,
      def_skill: null,
      kicker: null,
    },
  ];
}

describe('newGameState', () => {
  it('initial state has 1st & 10 at the 25', () => {
    const g = newGameState('sess-1', emptyTeams());
    expect(g.down).toBe(1);
    expect(g.distance).toBe(10);
    expect(g.ball_yardline).toBe(25);
    expect(g.possession_idx).toBe(0);
    expect(g.scores).toEqual([0, 0]);
    expect(g.phase).toBe('between_plays');
    expect(g.history).toEqual([]);
  });
});

describe('advanceAfterPlay', () => {
  it('1st & 10 at 25, +12 yards → 1st & 10 at 37 (no TD)', () => {
    const g = newGameState('s', emptyTeams());
    const { next, touchdown } = advanceAfterPlay(g, 12);
    expect(next.down).toBe(1);
    expect(next.distance).toBe(10);
    expect(next.ball_yardline).toBe(37);
    expect(touchdown).toBe(false);
  });

  it('3rd & 7 at 60, +4 yards → 4th & 3 at 64', () => {
    const g: GameState = {
      ...newGameState('s', emptyTeams()),
      down: 3,
      distance: 7,
      ball_yardline: 60,
    };
    const { next, touchdown } = advanceAfterPlay(g, 4);
    expect(next.down).toBe(4);
    expect(next.distance).toBe(3);
    expect(next.ball_yardline).toBe(64);
    expect(touchdown).toBe(false);
  });

  it('1st & 10 at 95, +8 yards → touchdown at 100', () => {
    const g: GameState = {
      ...newGameState('s', emptyTeams()),
      ball_yardline: 95,
    };
    const { next, touchdown, safety } = advanceAfterPlay(g, 8);
    expect(next.ball_yardline).toBe(100);
    expect(touchdown).toBe(true);
    expect(safety).toBe(false);
  });

  it('2nd & 5 at 5, -7 yards → safety at 0', () => {
    const g: GameState = {
      ...newGameState('s', emptyTeams()),
      down: 2,
      distance: 5,
      ball_yardline: 5,
    };
    const { next, touchdown, safety } = advanceAfterPlay(g, -7);
    expect(next.ball_yardline).toBe(0);
    expect(safety).toBe(true);
    expect(touchdown).toBe(false);
  });

  it('gain exactly 10 on 3rd & 10 → new 1st down', () => {
    const g: GameState = {
      ...newGameState('s', emptyTeams()),
      down: 3,
      distance: 10,
      ball_yardline: 50,
    };
    const { next } = advanceAfterPlay(g, 10);
    expect(next.down).toBe(1);
    expect(next.distance).toBe(10);
    expect(next.ball_yardline).toBe(60);
  });

  it('loss of 3 on 2nd & 10 → 3rd & 13 (distance increases)', () => {
    const g: GameState = {
      ...newGameState('s', emptyTeams()),
      down: 2,
      distance: 10,
      ball_yardline: 50,
    };
    const { next } = advanceAfterPlay(g, -3);
    expect(next.down).toBe(3);
    expect(next.distance).toBe(13);
    expect(next.ball_yardline).toBe(47);
  });

  it('gain of 3 on 2nd & 10 → 3rd & 7 (distance decreases)', () => {
    const g: GameState = {
      ...newGameState('s', emptyTeams()),
      down: 2,
      distance: 10,
      ball_yardline: 50,
    };
    const { next } = advanceAfterPlay(g, 3);
    expect(next.down).toBe(3);
    expect(next.distance).toBe(7);
    expect(next.ball_yardline).toBe(53);
  });

  it('does not mutate input state', () => {
    const g = newGameState('s', emptyTeams());
    const originalYardline = g.ball_yardline;
    advanceAfterPlay(g, 5);
    expect(g.ball_yardline).toBe(originalYardline);
  });
});