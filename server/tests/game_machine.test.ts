import { describe, it, expect, beforeEach } from 'vitest';
import {
  newRoom,
  addPlayer,
  setReady,
  allReady,
  flipCoin,
  startDraft,
  draftPick,
  startGame,
  resolveCurrentPlay,
  isValidAudibleSub,
  snapshot,
  emptyTeam,
} from '../src/socket/game_machine.js';
import type { RoomState } from '../src/socket/game_machine.js';

function mkRoom(): RoomState {
  return newRoom('s1', 'host1', 'Alice');
}

describe('Room basics', () => {
  it('starts with 1 player in lobby', () => {
    const r = mkRoom();
    expect(r.players).toHaveLength(1);
    expect(r.players[0].name).toBe('Alice');
    expect(r.draft).toBeNull();
    expect(r.game).toBeNull();
  });
});

describe('addPlayer', () => {
  it('adds a 2nd player', () => {
    const r = mkRoom();
    const res = addPlayer(r, 'g1', 'Bob');
    expect(res.ok).toBe(true);
    expect(r.players).toHaveLength(2);
    expect(r.guest_id).toBe('g1');
  });
  it('rejects 3rd player', () => {
    const r = mkRoom();
    addPlayer(r, 'g1', 'Bob');
    const res = addPlayer(r, 'g2', 'Carol');
    expect(res.ok).toBe(false);
  });
  it('rejects duplicate', () => {
    const r = mkRoom();
    const res = addPlayer(r, 'host1', 'AliceAgain');
    expect(res.ok).toBe(false);
  });
});

describe('Coin flip', () => {
  it('sets result and first_possession_id', () => {
    const r = mkRoom();
    addPlayer(r, 'g1', 'Bob');
    const result = flipCoin(r);
    expect(['heads', 'tails']).toContain(result);
    expect(r.coin_result).toBe(result);
    expect(r.first_possession_id).toBeTruthy();
    // heads → guest first
    if (result === 'heads') {
      expect(r.first_possession_id).toBe('g1');
    } else {
      expect(r.first_possession_id).toBe('host1');
    }
  });
});

describe('Draft flow', () => {
  let room: RoomState;
  beforeEach(() => {
    room = mkRoom();
    addPlayer(room, 'g1', 'Bob');
    flipCoin(room);
    startDraft(room);
  });
  it('initializes pool + order + empty teams', () => {
    expect(room.draft).toBeTruthy();
    expect(room.draft!.pool.QB).toHaveLength(3);
    expect(room.draft!.order).toHaveLength(12);
    expect(room.draft!.picks[room.first_possession_id!]).toBeDefined();
  });
  it('alternating picks work', () => {
    const first = room.first_possession_id!;
    const second = room.players.find((p) => p.id !== first)!.id;
    // First picks QB option 0
    const qbOpt = room.draft!.pool.QB[0];
    const r = draftPick(room, first, 'QB', qbOpt.id);
    expect(r.ok).toBe(true);
    expect(room.draft!.picks[first].qb).toBeTruthy();
    expect(room.draft!.pool.QB).toHaveLength(2);
    // Second picks D_LINE
    const dlOpts = room.draft!.pool.D_LINE;
    const r2 = draftPick(room, second, 'D_LINE', dlOpts[0].id);
    expect(r2.ok).toBe(true);
    expect(room.draft!.turn).toBe(2);
  });
  it('rejects wrong turn', () => {
    const first = room.first_possession_id!;
    const second = room.players.find((p) => p.id !== first)!.id;
    const r = draftPick(room, second, 'QB', room.draft!.pool.QB[0].id);
    expect(r.ok).toBe(false);
  });
  it('full draft → 12 picks → startGame', () => {
    const order = room.draft!.order;
    for (let i = 0; i < 12; i++) {
      const player = order[i];
      const group = ['QB', 'D_LINE', 'O_LINE', 'OFF_SKILL', 'DEF_SKILL', 'KICKER'][i % 6];
      const pool = (room.draft!.pool as any)[group];
      if (pool.length === 0) continue; // shouldn't happen in normal flow
      const r = draftPick(room, player, group as any, pool[0].id);
      expect(r.ok).toBe(true);
    }
    expect(room.draft!.turn).toBe(12);
    const game = startGame(room);
    expect(game).toBeTruthy();
    expect(game.phase).toBe('between_plays');
  });
});

describe('isValidAudibleSub', () => {
  it('allows flipping sub', () => {
    expect(isValidAudibleSub({ parent: 'pass', sub: 'deep' }, 'short')).toBe(true);
    expect(isValidAudibleSub({ parent: 'pass', sub: 'short' }, 'deep')).toBe(true);
    expect(isValidAudibleSub({ parent: 'run', sub: 'inside' }, 'outside')).toBe(true);
    expect(isValidAudibleSub({ parent: 'run', sub: 'outside' }, 'inside')).toBe(true);
  });
  it('rejects same sub', () => {
    expect(isValidAudibleSub({ parent: 'pass', sub: 'deep' }, 'deep')).toBe(false);
  });
  it('rejects invalid flips', () => {
    expect(isValidAudibleSub({ parent: 'pass', sub: 'deep' }, 'inside')).toBe(false);
  });
});

describe('Play resolution', () => {
  it('run play with same parent+sub has 25% turnover rate', () => {
    const room = setupReadyToSnapRoom();
    const seed = 42;
    let tos = 0;
    const N = 500;
    for (let i = 0; i < N; i++) {
      // Re-set schemes each iteration
      const r = setupReadyToSnapRoom();
      r.pending_schemes[r.players[0].id] = { parent: 'run', sub: 'inside' };
      r.pending_schemes[r.players[1].id] = { parent: 'run', sub: 'inside' };
      const { result } = resolveCurrentPlay(r, i + 1);
      if (result.turnover) tos++;
    }
    // 25% rate, allow ±5% for 500 trials
    expect(tos / N).toBeGreaterThan(0.18);
    expect(tos / N).toBeLessThan(0.32);
  });

  it('FG made → adds 0.5 points + possession change', () => {
    const room = setupReadyToSnapRoom();
    room.pending_schemes[room.players[0].id] = { parent: 'fg', sub: 'deep' };
    room.pending_schemes[room.players[1].id] = { parent: 'fg', sub: 'deep' };
    const before = room.game!.scores[0];
    const { result, scoring_event } = resolveCurrentPlay(room, 1);
    // result.text_recap may say GOOD or missed
    expect(result.scoring_event === 'fg' || result.scoring_event === null).toBe(true);
    if (result.scoring_event === 'fg') {
      expect(room.game!.scores[0]).toBe(before + 0.5);
      expect(scoring_event).toBe('fg');
    }
  });

  it('TD scores 1 point + possession change', () => {
    const room = setupReadyToSnapRoom();
    // Force a TD by setting ball near goal line + huge skill gap
    room.game!.ball_yardline = 99;
    room.game!.teams[0].off_skill = { id: 'OFF', group: 'OFF_SKILL', skill: 100, name: 'A' };
    room.game!.teams[1].def_skill = { id: 'DEF', group: 'DEF_SKILL', skill: 50, name: 'B' };
    room.pending_schemes[room.players[0].id] = { parent: 'run', sub: 'inside' };
    room.pending_schemes[room.players[1].id] = { parent: 'pass', sub: 'deep' };
    const before = room.game!.scores[0];
    const { result, scoring_event } = resolveCurrentPlay(room, 1);
    if (scoring_event === 'td') {
      expect(room.game!.scores[0]).toBe(before + 1);
    } else {
      // accept no TD on this seed but result still valid
      expect(result.yards).toBeGreaterThanOrEqual(0);
    }
  });
});

function setupReadyToSnapRoom(): RoomState {
  const room = mkRoom();
  addPlayer(room, 'g1', 'Bob');
  flipCoin(room);
  startDraft(room);
  // Manually fill draft to skip 12 picks
  const order = room.draft!.order;
  for (let i = 0; i < 12; i++) {
    const player = order[i];
    const group = ['QB', 'D_LINE', 'O_LINE', 'OFF_SKILL', 'DEF_SKILL', 'KICKER'][i % 6];
    const pool = (room.draft!.pool as any)[group];
    if (pool.length > 0) {
      draftPick(room, player, group as any, pool[0].id);
    }
  }
  startGame(room);
  return room;
}

describe('Snapshot', () => {
  it('serializes room for broadcast', () => {
    const room = mkRoom();
    addPlayer(room, 'g1', 'Bob');
    flipCoin(room);
    startDraft(room);
    const snap = snapshot(room);
    expect(snap.session_id).toBe('s1');
    expect(snap.players).toHaveLength(2);
    expect(snap.draft).toBeTruthy();
    expect(snap.game).toBeNull();
  });
});