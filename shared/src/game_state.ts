// Game state — downs, distance, ball spot, possession.
import type { GameState, TeamState } from './types.js';

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

export function advanceAfterPlay(state: GameState, yards: number): AdvanceResult {
  const next: GameState = {
    ...state,
    history: [...state.history],
  };
  next.ball_yardline = state.ball_yardline + yards;

  if (yards >= state.distance) {
    next.down = 1;
    next.distance = 10;
  } else {
    next.down = Math.min(4, state.down + 1) as 1 | 2 | 3 | 4;
    next.distance = state.distance - yards;
  }

  let touchdown = false;
  let safety = false;
  if (next.ball_yardline >= 100) {
    next.ball_yardline = 100;
    touchdown = true;
  } else if (next.ball_yardline <= 0) {
    next.ball_yardline = 0;
    safety = true;
  }
  return { next, touchdown, safety };
}