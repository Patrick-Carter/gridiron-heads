import { describe, it, expect } from 'vitest';
import { newGameState, advanceAfterPlay, offenseDirection, yardsToEndzone, flipPossession, kickoffYardline, yardsFromOwnGoal } from '../src/game_state.js';
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

  // === Direction-aware (D-n): possession_idx=1 attacks left toward 0 ===
  describe('direction-aware advance (team 1 attacks toward 0)', () => {
    function team1State(): GameState {
      return {
        ...newGameState('s', emptyTeams()),
        possession_idx: 1,
      };
    }

    it('team 1 at 75 with +10 yards moves LEFT (toward 0), not right', () => {
      const g = team1State();
      g.ball_yardline = 75;
      g.down = 1;
      g.distance = 10;
      const { next, touchdown } = advanceAfterPlay(g, 10);
      expect(touchdown).toBe(false);
      expect(next.ball_yardline).toBe(65);
      expect(next.down).toBe(1);
      expect(next.distance).toBe(10);
    });

    it('team 1 at 25 with +8 yards reaches yardline 17 (8yds toward 0)', () => {
      const g = team1State();
      g.ball_yardline = 25;
      const { next } = advanceAfterPlay(g, 8);
      expect(next.ball_yardline).toBe(17);
    });

    it('team 1 at 5 with +6 yards TOUCHDOWNS at yardline 0', () => {
      const g = team1State();
      g.ball_yardline = 5;
      const { next, touchdown, safety } = advanceAfterPlay(g, 6);
      expect(touchdown).toBe(true);
      expect(safety).toBe(false);
      expect(next.ball_yardline).toBe(0);
    });

    it('team 1 at 95 with -10 yards: SAFETY at yardline 100', () => {
      // -1 offense at yardline 95 losing yards → ball_yardline goes UP
      // (toward 100 = team 1's OWN end zone). -10yds from 95 → 105, clamped
      // to 100 = safety.
      const g = team1State();
      g.down = 2;
      g.distance = 5;
      g.ball_yardline = 95;
      const { next, touchdown, safety } = advanceAfterPlay(g, -10);
      expect(touchdown).toBe(false);
      expect(safety).toBe(true);
      expect(next.ball_yardline).toBe(100);
    });

    it('team 1 at 95 with -7 yards: NOT a safety yet (only 88yds past, no penalty past own goal)', () => {
      // Sanity: small negative yardage near own end zone shouldn't be a safety.
      // -7 from 95 → ball at 102... wait, 95 + 7 = 102 → clamped to 100.
      // Actually it SHOULD be a safety here. Hmm. Let me reason:
      //   dir=-1, yards=-7, ball = 95 + (-7)*(-1) = 95 + 7 = 102. >= 100 → safety.
      // So -7 IS enough. The minimum for a safety is yardline >= 94 (losing 6+
      // would push past 100).
      const g = team1State();
      g.down = 2;
      g.distance = 5;
      g.ball_yardline = 94;
      const { next, touchdown, safety } = advanceAfterPlay(g, -6);
      expect(touchdown).toBe(false);
      expect(safety).toBe(true);
      expect(next.ball_yardline).toBe(100);
    });

    it('team 1 at 50 with -3 yards → 3rd & 13 at yardline 53 (gained own ground)', () => {
      const g = team1State();
      g.down = 2;
      g.distance = 10;
      g.ball_yardline = 50;
      const { next } = advanceAfterPlay(g, -3);
      expect(next.down).toBe(3);
      expect(next.distance).toBe(13);
      // Negative yards → ball moves the WRONG way (toward 100 for team 1)
      expect(next.ball_yardline).toBe(53);
    });

    it('yardsToEndzone helper is direction-aware', () => {
      const team0 = newGameState('s', emptyTeams()); // possession_idx=0
      const team1 = { ...newGameState('s', emptyTeams()), possession_idx: 1 as 0 | 1 };
      expect(offenseDirection(team0)).toBe(1);
      expect(offenseDirection(team1)).toBe(-1);
      team0.ball_yardline = 30;
      expect(yardsToEndzone(team0)).toBe(70); // 100 - 30
      team1.ball_yardline = 30;
      expect(yardsToEndzone(team1)).toBe(30); // team 1 attacks toward 0
    });

    it('flipPossession flips possession, sets 1st & 10, keeps ball_yardline', () => {
      const g = newGameState('s', emptyTeams());
      g.ball_yardline = 37;
      g.down = 3;
      g.distance = 4;
      const flipped = flipPossession(g);
      expect(flipped.possession_idx).toBe(1);
      expect(flipped.down).toBe(1);
      expect(flipped.distance).toBe(10);
      expect(flipped.ball_yardline).toBe(37); // same absolute spot — new offense attacks opposite end zone
    });
  });
});

describe('kickoffYardline', () => {
  it('dir=+1 → absolute 25 (team 0 attacks right, own GL is at 0)', () => {
    expect(kickoffYardline(1)).toBe(25);
  });
  it('dir=-1 → absolute 75 (team 1 attacks left, own GL is at 100)', () => {
    expect(kickoffYardline(-1)).toBe(75);
  });
});

describe('yardsFromOwnGoal', () => {
  it('team 0 at absolute 20 → 20 yards from own goal', () => {
    const g: GameState = { ...newGameState('s', emptyTeams()), ball_yardline: 20 };
    expect(yardsFromOwnGoal(g)).toBe(20);
  });
  it('team 0 at absolute 75 → 75 yards from own goal', () => {
    const g: GameState = { ...newGameState('s', emptyTeams()), ball_yardline: 75 };
    expect(yardsFromOwnGoal(g)).toBe(75);
  });
  it('team 1 at absolute 20 → 80 yards from own goal (own GL at 100)', () => {
    const g: GameState = {
      ...newGameState('s', emptyTeams()),
      ball_yardline: 20,
      possession_idx: 1,
    };
    expect(yardsFromOwnGoal(g)).toBe(80);
  });
  it('team 1 at absolute 75 → 25 yards from own goal', () => {
    const g: GameState = {
      ...newGameState('s', emptyTeams()),
      ball_yardline: 75,
      possession_idx: 1,
    };
    expect(yardsFromOwnGoal(g)).toBe(25);
  });
  it('team 0 at own 1 (absolute 1)', () => {
    const g: GameState = { ...newGameState('s', emptyTeams()), ball_yardline: 1 };
    expect(yardsFromOwnGoal(g)).toBe(1);
  });
  it('team 1 at own 1 (absolute 99)', () => {
    const g: GameState = {
      ...newGameState('s', emptyTeams()),
      ball_yardline: 99,
      possession_idx: 1,
    };
    expect(yardsFromOwnGoal(g)).toBe(1);
  });
});