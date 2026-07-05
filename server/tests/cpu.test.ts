// Unit tests for the CPU opponent decision logic in `server/src/socket/cpu.ts`.
// These tests construct a RoomState by hand (no socket layer) and call the
// exported CPU functions directly to verify they produce legal moves.
import { describe, it, expect } from 'vitest';
import {
  cpuDraftPick,
  cpuPickScheme,
  cpuMaybeAudible,
  cpuRespondAudible,
  CPU_PLAYER_ID,
} from '../src/socket/cpu.js';
import {
  newRoom,
  flipCoin,
  startDraft,
} from '../src/socket/game_machine.js';
import type { RoomState } from '../src/socket/game_machine.js';
import { mulberry32 } from '@gridiron/shared';
import type { GameState, Play, QBOption } from '@gridiron/shared';

// ---------------------------------------------------------------------------
// Test helpers — build a minimal CPU room state without spinning up sockets.
// ---------------------------------------------------------------------------
function makeCpuRoom(draft_seed = 1): RoomState {
  const room = newRoom('test-session', 'host-id', 'Host', {
    cpu_player_id: CPU_PLAYER_ID,
  });
  // Make CPU the first possession so it picks first in the draft.
  room.first_possession_id = CPU_PLAYER_ID;
  // Both players marked ready so allReady() returns true.
  room.players.forEach((p) => (p.ready = true));
  room.guest_id = CPU_PLAYER_ID;
  // Use a deterministic seed so the pool is reproducible across runs.
  room.draft_seed = draft_seed;
  return room;
}

function makeCpuRoomWithDraft(draft_seed = 1): RoomState {
  const room = makeCpuRoom(draft_seed);
  // Bypass random flipCoin by directly constructing pick_order so CPU is
  // always first (positions 0,2,4,6,8,10). Tests need determinism.
  const rng = mulberry32(draft_seed);
  // Pre-populate the draft pool with a deterministic seed so makeCpuGameRoom
  // (which consumes the pool) and the helper tests both see the same options.
  room.first_possession_id = CPU_PLAYER_ID;
  room.coin_result = 'heads';
  startDraft(room);
  return room;
}

function makeCpuGameRoom(draft_seed = 1, down: 1 | 2 | 3 | 4 = 1, yardline = 25): RoomState {
  const room = makeCpuRoomWithDraft(draft_seed);
  // Walk the draft for BOTH players — test doesn't care about the team
  // contents, just phase and possession_idx. CPU uses the highest-skill
  // option for each group; we pick the first option for the host.
  const groups = ['QB', 'D_LINE', 'O_LINE', 'OFF_SKILL', 'DEF_SKILL', 'KICKER'] as const;
  const cpuPoolFirst = (g: typeof groups[number]) => {
    const pool = room.draft!.pool[g] as any[];
    if (g === 'QB') {
      return pool.reduce<QBOption>((acc, o) => (o.modifier.value >= acc.modifier.value ? o : acc), pool[0] as QBOption);
    }
    return pool.reduce<any>((acc, o) => (o.skill >= acc.skill ? o : acc), pool[0]);
  };
  for (let i = 0; i < 12; i++) {
    const pickerId = room.draft!.pick_order[i];
    const team = room.draft!.picks[pickerId];
    const group = groups.find((g) => (team as any)[g.toLowerCase()] == null)!;
    const opt = cpuPoolFirst(group);
    room.draft!.pool[group].splice(room.draft!.pool[group].findIndex((o) => o.id === opt.id), 1);
    (team as any)[group.toLowerCase()] = opt;
    room.draft!.current_turn++;
  }
  // Now boot the game.
  const teams = [room.draft!.picks['host-id'], room.draft!.picks[CPU_PLAYER_ID]] as any;
  const game: GameState = {
    session_id: room.session_id,
    phase: 'awaiting_schemes',
    scores: [0, 0],
    down,
    distance: 10,
    ball_yardline: yardline,
    possession_idx: 0, // host is offense for these tests
    teams,
    audibles_used: [0, 0],
    fake_audibles_used: [0, 0],
    history: [],
    last_play_seed: null,
  };
  room.game = game;
  return room;
}

// ---------------------------------------------------------------------------
// Draft picks
// ---------------------------------------------------------------------------
describe('cpuDraftPick', () => {
  it('picks from the priority group when it is CPU turn', () => {
    const room = makeCpuRoomWithDraft();
    const beforeTurn = room.draft!.current_turn;
    cpuDraftPick(room);
    expect(room.draft!.current_turn).toBe(beforeTurn + 1);
    // CPU should have a QB now (first group in PICK_ORDER is QB).
    expect(room.draft!.picks[CPU_PLAYER_ID].qb).toBeTruthy();
  });

  it('does nothing when it is not CPU turn', () => {
    const room = makeCpuRoomWithDraft();
    // Flip first_possession so the HOST picks first.
    room.first_possession_id = 'host-id';
    room.draft!.pick_order = room.draft!.pick_order.map((_, i) =>
      i % 2 === 0 ? 'host-id' : CPU_PLAYER_ID,
    );
    const beforeTurn = room.draft!.current_turn;
    cpuDraftPick(room);
    expect(room.draft!.current_turn).toBe(beforeTurn); // no change
  });

  it('picks the highest-skill option from a skill group', () => {
    const room = makeCpuRoomWithDraft();
    // Force the pool for D_LINE so the test is deterministic.
    room.draft!.pool.D_LINE = [
      { id: 'lo', group: 'D_LINE', skill: 60, name: 'Lo' } as any,
      { id: 'hi', group: 'D_LINE', skill: 95, name: 'Hi' } as any,
    ];
    // Pre-fill QB + O_LINE so the next CPU pick is D_LINE (3rd group).
    room.draft!.picks[CPU_PLAYER_ID].qb = { id: 'pre_qb', group: 'QB', name: 'Pre', modifier: { stat: 'off_skill_pct', value: 10, scope: 'all_plays' } } as any;
    room.draft!.picks[CPU_PLAYER_ID].o_line = { id: 'pre_ol', group: 'O_LINE', skill: 80, name: 'PreO' } as any;
    // Pick_order: CPU at index 3 (the 3rd CPU pick = D_LINE since QB and
    // O_LINE are pre-filled but D_LINE is not). With CPU as first_possession,
    // pick_order = [CPU, HOST, CPU, HOST, CPU, HOST, ...]. Turn 3 is HOST.
    // Force CPU at turn 3 instead.
    room.draft!.pick_order[3] = CPU_PLAYER_ID;
    room.draft!.current_turn = 3;
    cpuDraftPick(room);
    expect(room.draft!.picks[CPU_PLAYER_ID].d_line).toBeTruthy();
    expect(room.draft!.picks[CPU_PLAYER_ID].d_line!.id).toBe('hi');
  });
});

// ---------------------------------------------------------------------------
// Scheme pick
// ---------------------------------------------------------------------------
describe('cpuPickScheme', () => {
  it('picks FG on 4th down within 35 yards of the end zone', () => {
    const room = makeCpuGameRoom(1, 4, 70); // 30 yards to end zone for +1 offense
    room.game!.possession_idx = 0; // offense attacks right (+1)
    const play = cpuPickScheme(room, 'host-id');
    expect(play).toBeTruthy();
    expect(play!.parent).toBe('fg');
  });

  it('picks punt on 4th down beyond FG range', () => {
    const room = makeCpuGameRoom(1, 4, 50); // 50 yards to end zone — outside 35
    const play = cpuPickScheme(room, 'host-id');
    expect(play!.parent).toBe('punt');
  });

  it('picks run-inside inside the opponent 5', () => {
    const room = makeCpuGameRoom(1, 1, 97); // 3 yards to end zone for +1 offense
    const play = cpuPickScheme(room, 'host-id');
    expect(play!.parent).toBe('run');
    expect(play!.sub).toBe('inside');
  });

  it('picks a legal run or pass on neutral downs', () => {
    // Run the picker many times to check the distribution is legal.
    let runs = 0, passes = 0;
    for (let i = 0; i < 200; i++) {
      const room = makeCpuGameRoom(1 + i, 2, 50); // 50 yards to end zone
      const play = cpuPickScheme(room, 'host-id');
      expect(['run', 'pass']).toContain(play!.parent);
      if (play!.parent === 'run') runs++; else passes++;
    }
    expect(runs).toBeGreaterThan(0);
    expect(passes).toBeGreaterThan(0);
    // 60/40 ratio gives roughly 80-160 runs / 40-120 passes at 200 trials.
    expect(runs).toBeGreaterThan(80);
    expect(passes).toBeGreaterThan(40);
  });

  it('returns null if game phase is wrong', () => {
    const room = makeCpuGameRoom(1, 1, 50);
    room.game!.phase = 'play_anim';
    const play = cpuPickScheme(room, 'host-id');
    expect(play).toBeNull();
  });

  it('does not double-pick if already picked', () => {
    const room = makeCpuGameRoom(1, 1, 50);
    const existing: Play = { parent: 'pass', sub: 'deep' };
    room.pending_schemes['host-id'] = existing;
    const play = cpuPickScheme(room, 'host-id');
    expect(play).toBeNull();
  });

  it('handles -1 direction offense (possession_idx = 1)', () => {
    // possession_idx=1 → offense attacks LEFT, so yardline=30 means 30
    // yards to endzone (within 35 → FG).
    const room = makeCpuGameRoom(1, 4, 30);
    room.game!.possession_idx = 1;
    const play = cpuPickScheme(room, 'host-id');
    expect(play!.parent).toBe('fg');
  });
});

// ---------------------------------------------------------------------------
// Offense audibles
// ---------------------------------------------------------------------------
describe('cpuMaybeAudible', () => {
  function setupReady(play: Play): RoomState {
    const room = makeCpuGameRoom(1, 1, 50);
    room.game!.phase = 'ready_to_snap';
    room.game!.possession_idx = 0; // host is offense
    room.pending_schemes['host-id'] = play;
    return room;
  }

  it('returns null on punt/FG (never audibles specials)', () => {
    for (const play of [
      { parent: 'punt', sub: 'short' },
      { parent: 'fg', sub: 'short' },
    ] as Play[]) {
      const room = setupReady(play);
      const r = cpuMaybeAudible(room, 0);
      expect(r).toBeNull();
    }
  });

  it('consumes a fake audible when picked', () => {
    // Force Math.random to always return 0.1 (below 0.25 fake threshold).
    // setupReady's makeCpuGameRoom also calls Math.random for draft_seed, so
    // we just override unconditionally.
    const orig = Math.random;
    Math.random = () => 0.1;
    try {
      const room = setupReady({ parent: 'run', sub: 'inside' });
      // Need the CPU to be offense for this to do anything.
      const cpuIdx = room.players.findIndex((p) => p.id === CPU_PLAYER_ID) as 0 | 1;
      room.game!.possession_idx = cpuIdx;
      room.pending_schemes[CPU_PLAYER_ID] = room.pending_schemes['host-id'];
      const r = cpuMaybeAudible(room, cpuIdx);
      expect(r).toBe('fake');
      expect(room.game!.fake_audibles_used[room.game!.possession_idx]).toBe(1);
      expect(room.game!.phase).toBe('awaiting_def_response');
    } finally {
      Math.random = orig;
    }
  });

  it('consumes a real audible when picked', () => {
    // Always returns 0.30 — above 0.25 fake threshold (skip fake) AND
    // below 0.35 audible threshold (take audible).
    const orig = Math.random;
    Math.random = () => 0.30;
    try {
      const room = setupReady({ parent: 'run', sub: 'inside' });
      const cpuIdx = room.players.findIndex((p) => p.id === CPU_PLAYER_ID) as 0 | 1;
      room.game!.possession_idx = cpuIdx;
      room.pending_schemes[CPU_PLAYER_ID] = room.pending_schemes['host-id'];
      const r = cpuMaybeAudible(room, cpuIdx);
      expect(r).toBe('audible');
      expect(room.game!.audibles_used[cpuIdx]).toBe(1);
      expect(room.game!.phase).toBe('awaiting_def_response');
    } finally {
      Math.random = orig;
    }
  });

  it('does nothing if CPU is not offense', () => {
    const room = setupReady({ parent: 'run', sub: 'inside' });
    // possession_idx = 0 = host. cpuMaybeAudible called with playerIdx = 0 → not CPU.
    const r = cpuMaybeAudible(room, 0);
    expect(r).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Defensive audible response
// ---------------------------------------------------------------------------
describe('cpuRespondAudible', () => {
  function setupAwaiting(play: Play): RoomState {
    const room = makeCpuGameRoom(1, 1, 50);
    room.game!.phase = 'awaiting_def_response';
    room.pending_schemes['host-id'] = play;
    // Make CPU the defense.
    const cpuIdx = room.players.findIndex((p) => p.id === CPU_PLAYER_ID) as 0 | 1;
    room.game!.possession_idx = cpuIdx === 0 ? 1 : 0;
    room.pending_schemes[CPU_PLAYER_ID] = play;
    return room;
  }

  it('flips the sub on audible response (60% case)', () => {
    const orig = Math.random;
    Math.random = () => 0.3; // < 0.6 → audible response
    try {
      const room = setupAwaiting({ parent: 'run', sub: 'inside' });
      const cpuIdx = room.players.findIndex((p) => p.id === CPU_PLAYER_ID) as 0 | 1;
      const r = cpuRespondAudible(room, cpuIdx);
      expect(r).toBe('audible');
      expect((room.game as any)._pending_def_audible).toEqual({
        parent: 'run',
        sub: 'outside',
      });
      expect(room.game!.phase).toBe('ready_to_snap');
    } finally {
      Math.random = orig;
    }
  });

  it('stays put on 40% case', () => {
    const orig = Math.random;
    Math.random = () => 0.9; // > 0.6 → stay
    try {
      const room = setupAwaiting({ parent: 'run', sub: 'inside' });
      const cpuIdx = room.players.findIndex((p) => p.id === CPU_PLAYER_ID) as 0 | 1;
      const r = cpuRespondAudible(room, cpuIdx);
      expect(r).toBe('stay');
      expect((room.game as any)._pending_def_audible).toBeNull();
      expect(room.game!.phase).toBe('ready_to_snap');
    } finally {
      Math.random = orig;
    }
  });

  it('does nothing if phase is not awaiting_def_response', () => {
    const room = makeCpuGameRoom(1, 1, 50);
    room.game!.phase = 'awaiting_schemes';
    const cpuIdx = room.players.findIndex((p) => p.id === CPU_PLAYER_ID) as 0 | 1;
    const r = cpuRespondAudible(room, cpuIdx);
    expect(r).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Determinism — generateDraft with same seed produces same pool (sanity).
// ---------------------------------------------------------------------------
describe('mulberry32 determinism', () => {
  it('produces identical sequences for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });
});