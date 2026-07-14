// CPU opponent — pure functions over RoomState that mutate the room in-place
// (same mutation pattern as the socket handlers: no returns, just effect).
//
// Every function is legal per the server's validation rules:
//   - draftPick only picks from unpicked groups + available pool options
//   - scheme_pick only emits legal parent/sub combinations
//   - audibles only fire when not on punt/FG + still has quota
//   - defensive respond only flips the sub (server validates via isValidAudibleSub)
//   - snap reuses the existing resolveCurrentPlay + auto-advance setTimeouts
//
// CPU strategy is deliberately simple: pick for strength, lean toward
// run/pass with situational punts/FGs, audible ~35% of the time, respond
// to audibles ~60% of the time. Smarter AI is deferred (see plan).
import type { Server as IOServer } from 'socket.io';
import { PICK_ORDER, TOTAL_PICKS } from '@gridiron/shared';
import type {
  GameState,
  Play,
  PlayParent,
  PlaySub,
  PositionGroup,
  PositionOption,
  QBOption,
  TeamState,
} from '@gridiron/shared';
import type { RoomState } from './game_machine.js';
import {
  draftPick,
  clearSchemes,
  clearAudibles,
  resolveCurrentPlay,
  snapshot,
  startGame,
  audibleLimit,
  resolveShootoutKick,
  nextActionPhase,
  endMatch,
  playActiveSkill,
  passActiveSkill,
  respondActiveSkill,
} from './game_machine.js';
import { touchRoom } from '../rooms.js';
// Note: cpu.ts is a leaf — only handlers.ts imports it. No circular deps.
// Static import of resolveCurrentPlay + snapshot avoids dynamic require().

// ---------------------------------------------------------------------------
// Constants for the CPU's decision logic. Tuned so the CPU plays a normal
// game of football without being stupid or annoying.
// ---------------------------------------------------------------------------
const OFFENSE_AUDIBLE_CHANCE = 0.35;
const OFFENSE_FAKE_AUDIBLE_CHANCE = 0.25;
const DEFENSE_RESPOND_AUDIBLE_CHANCE = 0.60;
const OFFENSE_ACTIVE_CHANCE = 0.45;
const DEFENSE_ACTIVE_CHANCE = 0.65;
const RUN_PASS_RUN_RATIO = 0.60; // 60% run, 40% pass on neutral downs
// Yards-to-endzone thresholds (relative to offense's target end zone).
const FG_RANGE_YARDS = 35;       // inside own 35 (or opp 65) → consider FG on 4th
const GOAL_LINE_RANGE_YARDS = 5; // inside opp 5 → go run-inside
// Cap recursion: tickCpu can chain when CPU mutates state. Bounded by total
// possible CPU actions per phase (~3-4). 8 is comfortable headroom.
const MAX_CPU_RECURSION = 8;

// ---------------------------------------------------------------------------
// Type extensions for RoomState.players[] (is_cpu flag).
// ---------------------------------------------------------------------------
export interface CpuPlayer {
  id: string;
  name: string;
  ready: boolean;
  is_cpu: boolean;
}

/** CPU's stable player_id. Distinct format from nanoid(12) so it never collides. */
export const CPU_PLAYER_ID = 'cpu';

// ---------------------------------------------------------------------------
// Draft — take a QB first, then pick the highest-skill player available across
// every unfilled group. For QB picks, prefer the highest-value modifier since
// QBs only contribute via their single buff.
// ---------------------------------------------------------------------------
export function cpuDraftPick(room: RoomState): void {
  if (!room.draft) return;
  if (room.draft.current_turn >= TOTAL_PICKS) return;
  const pickerId = room.draft.pick_order[room.draft.current_turn];
  if (pickerId !== CPU_PLAYER_ID) return; // not CPU's turn
  const team = room.draft.picks[CPU_PLAYER_ID];
  if (!team) return;

  if (!team.qb) {
    const pool = room.draft.pool.QB as QBOption[];
    if (pool.length === 0) return;
    const best = pool.reduce((acc, option) =>
      option.modifier.value + activeDraftValue(option.active_skill)
        > acc.modifier.value + activeDraftValue(acc.active_skill) ? option : acc,
    );
    draftPick(room, CPU_PLAYER_ID, 'QB', best.id);
    return;
  }

  let bestGroup: PositionGroup | null = null;
  let bestPlayer: PositionOption | null = null;
  for (const group of PICK_ORDER) {
    if (group === 'QB' || groupPicked(team, group)) continue;
    for (const option of room.draft.pool[group] as PositionOption[]) {
      if (!bestPlayer || option.skill + activeDraftValue(option.active_skill)
        > bestPlayer.skill + activeDraftValue(bestPlayer.active_skill)) {
        bestGroup = group;
        bestPlayer = option;
      }
    }
  }

  if (bestGroup && bestPlayer) {
    draftPick(room, CPU_PLAYER_ID, bestGroup, bestPlayer.id);
  }
}

/** Small enough that raw skill still matters, large enough to break close picks. */
export function activeDraftValue(skill: PositionOption['active_skill'] | QBOption['active_skill']): number {
  if (!skill) return 0;
  if (skill === 'protect_football' || skill === 'sure_hands' || skill === 'film_study'
    || skill === 'line_stunt' || skill === 'perfect_hold') return 9;
  if (skill === 'field_general' || skill === 'pancake_block' || skill === 'pin_ears_back'
    || skill === 'sure_tackling' || skill === 'ice_water') return 8;
  if (skill === 'big_leg' || skill === 'breakaway_speed' || skill === 'matchup_nightmare'
    || skill === 'strip_rush' || skill === 'ball_hawk') return 7;
  return 5;
}

function groupPicked(team: TeamState, group: PositionGroup): boolean {
  switch (group) {
    case 'QB': return team.qb !== null;
    case 'D_LINE': return team.d_line !== null;
    case 'O_LINE': return team.o_line !== null;
    case 'OFF_SKILL': return team.off_skill !== null;
    case 'DEF_SKILL': return team.def_skill !== null;
    case 'KICKER': return team.kicker !== null;
  }
}

// ---------------------------------------------------------------------------
// Scheme pick — situational: 4th + own 15-35 → FG, 4th + own 35+ → punt,
// inside opp 5 → run-inside, else 60/40 run/pass with random sub.
// ---------------------------------------------------------------------------
export function cpuPickScheme(room: RoomState, playerId: string): Play | null {
  const game = room.game;
  if (!game) return null;
  if (game.phase !== 'awaiting_schemes') return null;
  // Already picked? Don't double-pick.
  if (room.pending_schemes[playerId]) return null;

  const ytg = yardsToEndzone(game);
  const down = game.down;

  // Punt/FG only available on 4th. FG only viable inside FG range.
  if (down === 4) {
    if (ytg <= FG_RANGE_YARDS) {
      const play: Play = { parent: 'fg', sub: 'short' };
      room.pending_schemes[playerId] = play;
      return play;
    }
    // Outside FG range → punt on 4th
    const play: Play = { parent: 'punt', sub: 'short' };
    room.pending_schemes[playerId] = play;
    return play;
  }

  // Goal-line situation: go run-inside
  if (ytg <= GOAL_LINE_RANGE_YARDS) {
    const play: Play = { parent: 'run', sub: 'inside' };
    room.pending_schemes[playerId] = play;
    return play;
  }

  // Neutral down: weighted random over {run, pass} + random sub
  const parent: PlayParent = Math.random() < RUN_PASS_RUN_RATIO ? 'run' : 'pass';
  const sub: PlaySub = Math.random() < 0.5
    ? (parent === 'run' ? 'inside' : 'short')
    : (parent === 'run' ? 'outside' : 'deep');
  const play: Play = { parent, sub };
  room.pending_schemes[playerId] = play;
  return play;
}

// ---------------------------------------------------------------------------
// Offense audible — 35% chance to real-audible, 25% chance to fake (only
// if real audible NOT used). Caller must broadcast after.
// Returns 'audible' | 'fake' | null so the caller can decide whether to
// advance to awaiting_def_response.
// ---------------------------------------------------------------------------
export function cpuMaybeAudible(room: RoomState, playerIdx: 0 | 1): 'audible' | 'fake' | null {
  const game = room.game;
  if (!game) return null;
  if (game.phase !== 'ready_to_snap') return null;
  const playerId = room.players[playerIdx].id;
  if (playerId !== CPU_PLAYER_ID) return null;
  const currentPlay = room.pending_schemes[playerId];
  if (!currentPlay) return null;
  // Server rule: no audibles on punt/FG.
  if (currentPlay.parent === 'punt' || currentPlay.parent === 'fg') return null;

  const team = game.teams[playerIdx];
  const realLeft = game.audibles_used[playerIdx] < audibleLimit(team, 'real');
  const fakeLeft = game.fake_audibles_used[playerIdx] < audibleLimit(team, 'fake');

  // Fake takes priority over real audible so we use the consumable.
  // 25% fake (only if both available and the dice hit)
  if (realLeft && fakeLeft && Math.random() < OFFENSE_FAKE_AUDIBLE_CHANCE) {
    (game as any)._pending_off_fake = true;
    game.fake_audibles_used[playerIdx]++;
    game.phase = 'awaiting_def_response';
    return 'fake';
  }

  // Otherwise 35% real audible
  if (realLeft && Math.random() < OFFENSE_AUDIBLE_CHANCE) {
    // Flip the sub (server validates via isValidAudibleSub).
    const flip: Record<string, PlaySub> = {
      deep: 'short', short: 'deep', inside: 'outside', outside: 'inside',
    };
    const newSub = flip[currentPlay.sub];
    if (!newSub) return null;
    (game as any)._pending_off_audible = { parent: currentPlay.parent, sub: newSub };
    game.audibles_used[playerIdx]++;
    game.phase = 'awaiting_def_response';
    return 'audible';
  }

  return null; // CPU keeps the original play; phase stays ready_to_snap
}

// ---------------------------------------------------------------------------
// Defense audible response — 60% audible back, 40% stay.
// ---------------------------------------------------------------------------
export function cpuRespondAudible(room: RoomState, playerIdx: 0 | 1): 'audible' | 'stay' | null {
  const game = room.game;
  if (!game) return null;
  if (game.phase !== 'awaiting_def_response') return null;
  const playerId = room.players[playerIdx].id;
  if (playerId !== CPU_PLAYER_ID) return null;
  const currentPlay = room.pending_schemes[playerId];
  if (!currentPlay) return null;
  if (currentPlay.parent === 'punt' || currentPlay.parent === 'fg') {
    // Server rejects these anyway; just stay.
    (game as any)._pending_def_audible = null;
    game.phase = 'ready_to_snap';
    return 'stay';
  }

  if (Math.random() < DEFENSE_RESPOND_AUDIBLE_CHANCE) {
    const flip: Record<string, PlaySub> = {
      deep: 'short', short: 'deep', inside: 'outside', outside: 'inside',
    };
    const newSub = flip[currentPlay.sub];
    if (!newSub) {
      (game as any)._pending_def_audible = null;
      game.phase = 'ready_to_snap';
      return 'stay';
    }
    (game as any)._pending_def_audible = { parent: currentPlay.parent, sub: newSub };
    game.phase = 'ready_to_snap';
    return 'audible';
  }

  (game as any)._pending_def_audible = null;
  game.phase = 'ready_to_snap';
  return 'stay';
}

function cardFitsPlay(skill: string, play: Play): boolean {
  if (skill === 'gunslinger' || skill === 'route_technician' || skill === 'sure_hands'
    || skill === 'clean_pocket') return play.parent === 'pass';
  if (skill === 'cutback_artist' || skill === 'road_graders') return play.parent === 'run';
  if (skill === 'pulling_guards') return play.parent === 'run' && play.sub === 'outside';
  if (skill === 'crash_a_gap') return play.parent === 'run' && play.sub === 'inside';
  if (skill === 'set_edge') return play.parent === 'run' && play.sub === 'outside';
  if (skill === 'collapse_pocket' || skill === 'ball_hawk') return play.parent === 'pass';
  if (skill === 'press_coverage') return play.parent === 'pass' && play.sub === 'short';
  if (skill === 'two_high_shell') return play.parent === 'pass' && play.sub === 'deep';
  if (skill === 'run_fits') return play.parent === 'run';
  if (skill === 'clutch_command') return false; // handled with the current down below
  if (skill === 'coffin_corner' || skill === 'quick_punt') return play.parent === 'punt';
  if (skill === 'big_leg' || skill === 'ice_water' || skill === 'perfect_hold'
    || skill === 'friendly_upright') return play.parent === 'fg';
  return true;
}

export function cpuMaybePlayActive(room: RoomState, playerIdx: 0 | 1): boolean {
  const game = room.game;
  if (!game || game.phase !== 'ready_to_snap' || game.possession_idx !== playerIdx) return false;
  if (room.players[playerIdx]?.id !== CPU_PLAYER_ID) return false;
  const play = room.pending_schemes[CPU_PLAYER_ID];
  if (!play) return false;
  const team = game.teams[playerIdx];
  const groups: PositionGroup[] = play.parent === 'punt' || play.parent === 'fg'
    ? ['KICKER']
    : ['QB', 'O_LINE', 'OFF_SKILL'];
  const candidates = groups.filter((group) => {
    const option = group === 'QB' ? team.qb
      : group === 'O_LINE' ? team.o_line
        : group === 'OFF_SKILL' ? team.off_skill : team.kicker;
    const skill = option?.active_skill;
    if (!skill || game.active_skills_used[playerIdx]?.includes(skill)) return false;
    if (skill === 'clutch_command') return game.down === 3 || game.down === 4;
    return cardFitsPlay(skill, play);
  });
  if (!candidates.length) return false;
  const lateGame = game.possessions_completed[playerIdx] >= 2;
  if (!lateGame && Math.random() >= OFFENSE_ACTIVE_CHANCE) return false;
  const group = candidates[Math.floor(Math.random() * candidates.length)];
  return playActiveSkill(room, CPU_PLAYER_ID, group).ok;
}

export function cpuRespondActive(room: RoomState, playerIdx: 0 | 1): boolean {
  const game = room.game;
  if (!game || game.phase !== 'awaiting_card_response') return false;
  if (room.players[playerIdx]?.id !== CPU_PLAYER_ID) return false;
  const offenseId = room.players[game.possession_idx]?.id;
  const play = offenseId ? room.pending_schemes[offenseId] : undefined;
  const team = game.teams[playerIdx];
  const candidates = (['D_LINE', 'DEF_SKILL'] as const).filter((group) => {
    const skill = group === 'D_LINE' ? team.d_line?.active_skill : team.def_skill?.active_skill;
    return !!skill && !game.active_skills_used[playerIdx]?.includes(skill)
      && (!play || cardFitsPlay(skill, play));
  });
  const shouldPlay = candidates.length > 0 && Math.random() < DEFENSE_ACTIVE_CHANCE;
  if (!shouldPlay) return respondActiveSkill(room, CPU_PLAYER_ID, null).ok;
  const group = candidates[Math.floor(Math.random() * candidates.length)];
  return respondActiveSkill(room, CPU_PLAYER_ID, group).ok;
}

// ---------------------------------------------------------------------------
// CPU snap — mirrors the socket handler's snap logic exactly. Reuses
// resolveCurrentPlay + the 2s/4.5s auto-advance setTimeouts. Refuses to
// run if the game has already ended (avoids zombie plays per D024).
// ---------------------------------------------------------------------------
export function cpuSnap(io: IOServer, room: RoomState): void {
  const game = room.game;
  if (!game) return;
  if (game.phase !== 'card_chain_complete') return;

  const sid = room.session_id;
  const seed = Math.floor(Math.random() * 2 ** 32);
  const generation = ++room.play_generation;
  const { result } = resolveCurrentPlay(room, seed);

  // D024 guard: don't overwrite 'ended' phase.
  const gameEnded = !!room.outcome;
  if (!gameEnded) game.phase = 'play_anim';

  io.to(`session:${sid}`).emit('play:result', { result });
  io.to(`session:${sid}`).emit('session:state', snapshot(room));

  if (gameEnded) return; // no auto-advance

  setTimeout(() => {
    if (room.play_generation === generation && room.game?.phase === 'play_anim') {
      room.game.phase = 'between_plays';
      io.to(`session:${sid}`).emit('session:state', snapshot(room));
    }
  }, 2000);
  setTimeout(() => {
    if (room.play_generation === generation && room.game?.phase === 'between_plays') {
      room.game.phase = nextActionPhase(room.game);
      clearSchemes(room);
      io.to(`session:${sid}`).emit('session:state', snapshot(room));
      tickCpu(io, room);
    }
  }, 4500);
}

export function cpuShootoutKick(io: IOServer, room: RoomState, playerIdx: 0 | 1): void {
  const game = room.game;
  if (!game?.shootout || game.phase !== 'shootout_ready' || room.outcome) return;
  if (room.players[playerIdx]?.id !== CPU_PLAYER_ID) return;
  const sid = room.session_id;
  const resolved = resolveShootoutKick(room, playerIdx, Math.floor(Math.random() * 2 ** 32));
  if (!resolved.ok) return;
  const generation = ++room.play_generation;
  game.phase = 'shootout_anim';
  touchRoom(room);
  io.to(`session:${sid}`).emit('play:result', { result: resolved.result });
  io.to(`session:${sid}`).emit('session:state', snapshot(room));
  setTimeout(() => {
    if (room.play_generation === generation && room.game?.phase === 'shootout_anim') {
      room.game.phase = 'shootout_between';
      touchRoom(room);
      io.to(`session:${sid}`).emit('session:state', snapshot(room));
    }
  }, 2000);
  setTimeout(() => {
    if (room.play_generation === generation && room.game?.phase === 'shootout_between') {
      if (room.pending_outcome) {
        const pending = room.pending_outcome;
        endMatch(room, pending.winner_idx, pending.reason, pending.conceded_by_idx);
      } else {
        room.game.phase = 'shootout_ready';
      }
      touchRoom(room);
      io.to(`session:${sid}`).emit('session:state', snapshot(room));
      if (!room.outcome) tickCpu(io, room);
    }
  }, 4500);
}

// ---------------------------------------------------------------------------
// tickCpu — the central "is it CPU's turn?" dispatcher. Called after every
// state mutation. Loops internally so a single CPU action that mutates
// state can chain into the next CPU action (e.g. CPU picks scheme → both
// schemes present → CPU snaps).
// ---------------------------------------------------------------------------
export function tickCpu(io: IOServer, room: RoomState, depth = 0): void {
  if (depth >= MAX_CPU_RECURSION) return;
  if (!room.cpu_player_id) return;
  if (room.outcome) return;
  const cpuIdx = room.players.findIndex((p) => p.id === room.cpu_player_id);
  if (cpuIdx === -1) return;

  const sid = room.session_id;
  const broadcast = () => {
    touchRoom(room);
    io.to(`session:${sid}`).emit('session:state', snapshot(room));
  };

  // Draft phase — CPU picks on its turn.
  if (room.draft && room.draft.current_turn < TOTAL_PICKS) {
    const pickerId = room.draft.pick_order[room.draft.current_turn];
    if (pickerId === room.cpu_player_id) {
      cpuDraftPick(room);
      if (room.draft.current_turn >= TOTAL_PICKS && !room.game) {
        const game = startGame(room);
        game.phase = 'awaiting_schemes';
      }
      // After the final pick, continue into the first scheme selection.
      // Recurse: CPU may now be offense in awaiting_schemes.
      broadcast();
      tickCpu(io, room, depth + 1);
    }
    return;
  }

  const game = room.game;
  if (!game) return;
  const phase = game.phase;

  if (phase === 'shootout_ready' && game.shootout?.next_kicker_idx === cpuIdx) {
    const kickerSkill = game.teams[cpuIdx].kicker?.active_skill;
    if (kickerSkill && (kickerSkill === 'big_leg' || kickerSkill === 'ice_water'
      || kickerSkill === 'friendly_upright')
      && !game.active_skills_used[cpuIdx]?.includes(kickerSkill)) {
      playActiveSkill(room, CPU_PLAYER_ID, 'KICKER');
    }
    cpuShootoutKick(io, room, cpuIdx as 0 | 1);
    return;
  }

  // Scheme pick phase. CPU may be offense, defense, or both (but in vs-CPU
  // mode only one is CPU). Pick for whichever side hasn't picked yet.
  if (phase === 'awaiting_schemes') {
    const offIdx = game.possession_idx;
    const defIdx = offIdx === 0 ? 1 : 0;
    const offId = room.players[offIdx].id;
    const defId = room.players[defIdx].id;
    let didPick = false;
    if (offId === room.cpu_player_id && !room.pending_schemes[offId]) {
      cpuPickScheme(room, offId);
      didPick = true;
    }
    if (defId === room.cpu_player_id && !room.pending_schemes[defId]) {
      cpuPickScheme(room, defId);
      didPick = true;
    }
    if (!didPick) return;
    // Both picked → ready_to_snap (same rule as scheme_pick handler).
    if (bothSchemesPicked(room) && game.phase === 'awaiting_schemes') {
      game.phase = 'ready_to_snap';
    }
    broadcast();
    // Recurse: if ready_to_snap and CPU is offense, may audible or snap.
    tickCpu(io, room, depth + 1);
    return;
  }

  // Ready to snap — CPU offense may audible, then snap.
  if (phase === 'ready_to_snap') {
    const offIdx = game.possession_idx;
    const offId = room.players[offIdx].id;
    if (offId === room.cpu_player_id) {
      const audResult = cpuMaybeAudible(room, offIdx);
      if (audResult) {
        // Phase moved to awaiting_def_response. Recurse so CPU defense (in
        // vs-CPU mode there's none, but future-proof) responds; or wait
        // for human defense to respond.
        broadcast();
        tickCpu(io, room, depth + 1);
        return;
      }
      if (cpuMaybePlayActive(room, offIdx)) {
        broadcast();
        tickCpu(io, room, depth + 1);
        return;
      }
      // Offense explicitly passes priority so defense can still play a card.
      passActiveSkill(room, CPU_PLAYER_ID);
      broadcast();
      tickCpu(io, room, depth + 1);
      return;
    }
    // CPU is defense → wait for human offense to snap.
    return;
  }

  // Awaiting defensive response to offense audible — CPU is defense.
  if (phase === 'awaiting_def_response') {
    const defIdx = game.possession_idx === 0 ? 1 : 0;
    if (room.players[defIdx].id === room.cpu_player_id) {
      cpuRespondAudible(room, defIdx);
      // cpuRespondAudible sets phase = ready_to_snap.
      broadcast();
      // Now CPU offense (if same player? no, different) or human offense
      // will snap. Recurse so if CPU happens to be offense here too we
      // snap immediately; otherwise we wait.
      tickCpu(io, room, depth + 1);
    }
    return;
  }


  if (phase === 'awaiting_card_response') {
    const defIdx = game.possession_idx === 0 ? 1 : 0;
    if (room.players[defIdx].id === room.cpu_player_id) {
      cpuRespondActive(room, defIdx);
      broadcast();
      tickCpu(io, room, depth + 1);
    }
    return;
  }

  if (phase === 'card_chain_complete' && room.players[game.possession_idx].id === room.cpu_player_id) {
    cpuSnap(io, room);
  }
}

// ---------------------------------------------------------------------------
// Helpers — kept local to avoid spreading logic across files.
// ---------------------------------------------------------------------------
function bothSchemesPicked(room: RoomState): boolean {
  return room.players.every((p) => !!room.pending_schemes[p.id]);
}

function yardsToEndzone(game: GameState): number {
  const dir = game.possession_idx === 0 ? 1 : -1;
  return dir === 1 ? 100 - game.ball_yardline : game.ball_yardline;
}
