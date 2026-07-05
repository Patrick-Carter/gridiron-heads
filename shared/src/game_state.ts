// Game state — downs, distance, ball spot, possession.
//
// Field model (D-n): ball_yardline is the ABSOLUTE field position (0..100),
// not "yards from the offense's own goal line". `possession_idx` decides
// who attacks which end zone:
//   possession_idx === 0  →  offense attacks right toward yardline 100
//   possession_idx === 1  →  offense attacks left  toward yardline   0
// `offense_direction = +1 | -1` mirrors that for callers/renderers that
// want a signed number. After every change of possession (TD, safety,
// turnover, turnover-on-downs) the new offense gets a fresh 1st & 10 from
// the ball's current absolute spot — they attack the OPPOSITE end zone.
import type { GameState, TeamState } from './types.js';

/** Direction the current offense is attacking: +1 = toward 100, -1 = toward 0. */
export function offenseDirection(state: GameState): 1 | -1 {
  return state.possession_idx === 0 ? 1 : -1;
}

/** Yards remaining from the current LOS to the offense's target end zone.
 *  Caps at the field boundaries (0..100). */
export function yardsToEndzone(state: GameState): number {
  return offenseDirection(state) === 1 ? 100 - state.ball_yardline : state.ball_yardline;
}

export function newGameState(
  session_id: string,
  teams: [TeamState, TeamState],
): GameState {
  return {
    session_id,
    phase: 'between_plays',
    scores: [0, 0],
    down: 1,
    distance: 10,
    ball_yardline: 25,
    possession_idx: 0,
    teams,
    audibles_used: [0, 0],
    fake_audibles_used: [0, 0],
    history: [],
    last_play_seed: null,
  };
}

export interface AdvanceResult {
  next: GameState;
  touchdown: boolean;
  safety: boolean;
}

/** Move the ball `yards` in the offense's current direction. Caller still
 *  decides whether to change possession (TD/safety/turnover all return
 *  booleans so the caller can branch). Returns a fresh state — does NOT
 *  mutate the input. */
export function advanceAfterPlay(state: GameState, yards: number): AdvanceResult {
  const dir = offenseDirection(state);
  const next: GameState = {
    ...state,
    history: [...state.history],
  };
  // Move in the offense's direction. The resolver has already clamped
  // `yards` so a +20 from yardline 75 with a -1 offense can never produce
  // ball_yardline < 0 (and similarly for the +1 case at the other end).
  next.ball_yardline = state.ball_yardline + yards * dir;

  if (yards >= state.distance) {
    next.down = 1;
    next.distance = 10;
  } else {
    next.down = Math.min(4, state.down + 1) as 1 | 2 | 3 | 4;
    // Positive yards reduce distance; negative yards increase it
    next.distance = Math.max(1, state.distance - yards);
  }

  let touchdown = false;
  let safety = false;
  // Touchdown at the offense's target end zone (NOT always 100).
  if (dir === 1 && next.ball_yardline >= 100) {
    next.ball_yardline = 100;
    touchdown = true;
  } else if (dir === -1 && next.ball_yardline <= 0) {
    next.ball_yardline = 0;
    touchdown = true;
  }
  // Safety at the offense's OWN end zone (going the wrong way past the goal).
  else if (dir === 1 && next.ball_yardline <= 0) {
    next.ball_yardline = 0;
    safety = true;
  } else if (dir === -1 && next.ball_yardline >= 100) {
    next.ball_yardline = 100;
    safety = true;
  }
  return { next, touchdown, safety };
}

/** Flip possession to the other team at the current absolute spot, with a
 *  fresh 1st & 10. The new offense attacks the OPPOSITE end zone — no
 *  coordinate mirroring needed because ball_yardline is already absolute. */
export function flipPossession(state: GameState): GameState {
  return {
    ...state,
    possession_idx: state.possession_idx === 0 ? 1 : 0,
    down: 1,
    distance: 10,
  };
}