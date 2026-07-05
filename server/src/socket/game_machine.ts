// Game state machine — server-authoritative.
// Tracks all game state for a session and broadcasts transitions.

import {
  newGameState,
  generateDraft,
  takeFromPool,
  PICK_ORDER,
  TOTAL_PICKS,
  advanceAfterPlay,
  resolvePlay,
  attemptFieldGoal,
  addPoints,
  checkWinner,
  mulberry32,
} from '@gridiron/shared';
import type {
  GameState,
  Play,
  PlayResult,
  DraftState,
  TeamState,
  PositionGroup,
  PositionOption,
  QBOption,
} from '@gridiron/shared';

export interface RoomState {
  session_id: string;
  host_id: string; // player_id of session creator
  guest_id: string | null;
  players: { id: string; name: string; ready: boolean }[];
  coin_result: 'heads' | 'tails' | null;
  first_possession_id: string | null;
  draft: DraftState | null;
  game: GameState | null;
  /** Random draft seed (also used to generate deterministic draft). */
  draft_seed: number;
  /** Scheme picks not yet revealed: player_id → Play */
  pending_schemes: Record<string, Play>;
  /** Audible phases: 'awaiting_off' | 'awaiting_def' | 'none' */
  audible_state: 'none' | 'awaiting_off_audible' | 'awaiting_def_audible';
  /** Sub-options for current audible choice */
  current_play: Play | null;
  /** RNG instance for current play (pre-resolution) */
  current_play_rng_seed: number | null;
}

export function newRoom(
  session_id: string,
  host_id: string,
  host_name: string,
): RoomState {
  return {
    session_id,
    host_id,
    guest_id: null,
    players: [{ id: host_id, name: host_name, ready: false }],
    coin_result: null,
    first_possession_id: null,
    draft: null,
    game: null,
    draft_seed: Math.floor(Math.random() * 2 ** 32),
    pending_schemes: {},
    audible_state: 'none',
    current_play: null,
    current_play_rng_seed: null,
  };
}

export function addPlayer(
  room: RoomState,
  player_id: string,
  name: string,
): { ok: true } | { ok: false; reason: string } {
  if (room.players.length >= 2) return { ok: false, reason: 'session_full' };
  if (room.players.some((p) => p.id === player_id)) {
    return { ok: false, reason: 'already_joined' };
  }
  room.players.push({ id: player_id, name, ready: false });
  room.guest_id = player_id;
  return { ok: true };
}

export function setReady(room: RoomState, player_id: string): void {
  for (const p of room.players) {
    if (p.id === player_id) p.ready = true;
  }
}

/** All players ready? Only meaningful when 2 are present. */
export function allReady(room: RoomState): boolean {
  return room.players.length === 2 && room.players.every((p) => p.ready);
}

/** Flip the coin. heads = visitor (player who joined 2nd) goes first. */
export function flipCoin(room: RoomState): 'heads' | 'tails' {
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  room.coin_result = result;
  const guest = room.players.find((p) => p.id === room.guest_id);
  const host = room.players.find((p) => p.id === room.host_id);
  // "Visitor" = guest (joined 2nd). heads → guest first.
  if (result === 'heads') {
    room.first_possession_id = guest ? guest.id : host!.id;
  } else {
    room.first_possession_id = host ? host.id : guest!.id;
  }
  return result;
}

/** Start the draft with a freshly generated pool. */
export function startDraft(room: RoomState): void {
  const rng = mulberry32(room.draft_seed);
  const pool = generateDraft(rng);
  // Pick order: first_possession_id first, then other, alternating.
  // Total 12 picks. turn 0 → first_possession_id.
  const order: string[] = [];
  const first = room.first_possession_id!;
  const second = room.players.find((p) => p.id !== first)!.id;
  for (let i = 0; i < TOTAL_PICKS; i++) {
    order.push(i % 2 === 0 ? first : second);
  }
  room.draft = {
    turn: 0,
    picks: { [first]: emptyTeam(), [second]: emptyTeam() },
    pool: pool as any,
    order,
    first_possession_id: first,
  };
}

export function emptyTeam(): TeamState {
  return {
    qb: null,
    d_line: null,
    o_line: null,
    off_skill: null,
    def_skill: null,
    kicker: null,
  };
}

/** Pick from the draft pool. Returns the picked option or error. */
export function draftPick(
  room: RoomState,
  player_id: string,
  group: PositionGroup,
  option_id: string,
): { ok: true; picked: PositionOption | QBOption; turn: number } | { ok: false; reason: string } {
  if (!room.draft) return { ok: false, reason: 'no_draft' };
  if (room.draft.turn >= TOTAL_PICKS) return { ok: false, reason: 'draft_done' };
  const expectedPicker = room.draft.order[room.draft.turn];
  if (expectedPicker !== player_id) return { ok: false, reason: 'not_your_turn' };
  const expectedGroup = PICK_ORDER[room.draft.turn % PICK_ORDER.length];
  if (expectedGroup !== group) return { ok: false, reason: 'wrong_group' };
  const taken = takeFromPool(room.draft.pool, group, option_id);
  if (!taken) return { ok: false, reason: 'option_not_in_pool' };

  const team = room.draft.picks[player_id];
  assignToTeam(team, group, taken as PositionOption & QBOption);

  room.draft.turn++;
  return { ok: true, picked: taken as PositionOption | QBOption, turn: room.draft.turn };
}

export function assignToTeam(
  team: TeamState,
  group: PositionGroup,
  option: PositionOption | QBOption,
): void {
  if (group === 'QB') {
    team.qb = option as QBOption;
  } else if (group === 'D_LINE') {
    team.d_line = option as PositionOption;
  } else if (group === 'O_LINE') {
    team.o_line = option as PositionOption;
  } else if (group === 'OFF_SKILL') {
    team.off_skill = option as PositionOption;
  } else if (group === 'DEF_SKILL') {
    team.def_skill = option as PositionOption;
  } else if (group === 'KICKER') {
    team.kicker = option as PositionOption;
  }
}

/** Move from draft → game. Called when draft.turn === TOTAL_PICKS. */
export function startGame(room: RoomState): GameState {
  if (!room.draft) throw new Error('no draft');
  const [host_id, guest_id] = [room.host_id, room.guest_id!];
  // teams[0] = host, teams[1] = guest (by index in DB). The possession_idx
  // (0 or 1) tracks who has the ball; here possession_idx refers to player index.
  const teams: [TeamState, TeamState] = [
    room.draft.picks[host_id],
    room.draft.picks[guest_id],
  ];
  // First possession maps to one of the teams. If host is first_possession_id,
  // possession_idx=0; else 1.
  const possession_idx: 0 | 1 =
    room.first_possession_id === host_id ? 0 : 1;
  const game = newGameState(room.session_id, teams);
  game.possession_idx = possession_idx;
  room.game = game;
  return game;
}

/** Offense/defense team state given the current possession. */
export function offenseTeam(room: RoomState): TeamState {
  return room.game!.teams[room.game!.possession_idx];
}
export function defenseTeam(room: RoomState): TeamState {
  const def: 0 | 1 = room.game!.possession_idx === 0 ? 1 : 0;
  return room.game!.teams[def];
}

/** Both players have submitted a scheme pick → ready to snap. */
export function readyToSnap(room: RoomState): boolean {
  const players = room.players.map((p) => p.id);
  return players.every((pid) => !!room.pending_schemes[pid]);
}

/** Validate a sub choice. Audible rule (D6): only opposite sub. */
export function isValidAudibleSub(
  current: Play,
  target_sub: Play['sub'],
): boolean {
  const flip: Record<string, string> = {
    deep: 'short',
    short: 'deep',
    inside: 'outside',
    outside: 'inside',
  };
  return flip[current.sub] === target_sub;
}

/** Resolve a play given current scheme + audible state. Returns PlayResult. */
export function resolveCurrentPlay(room: RoomState, seed: number): {
  result: PlayResult;
  scoring_event: 'td' | 'fg' | 'safety' | null;
} {
  const game = room.game!;
  const offense = offenseTeam(room);
  const defense = defenseTeam(room);

  // Map player_id → team index for the pending_schemes
  const offIdx = game.possession_idx;
  const defIdx = offIdx === 0 ? 1 : 0;
  const off_player_id = room.players[offIdx].id;
  const def_player_id = room.players[defIdx].id;
  const off_play = room.pending_schemes[off_player_id];
  const def_play = room.pending_schemes[def_player_id];

  // Off audible: off_idx has audibles_used[offIdx] tracking
  const offAudibleUsed = game.audibles_used[offIdx] > 0 ? off_play : null;
  const offFakeUsed = game.fake_audibles_used[offIdx] > 0 ? null : null; // not tracked in pending_schemes

  // Determine off_audible / def_audible / off_fake_audible from game state
  // For simplicity in v1: audibles are tracked separately, not via pending_schemes.
  const off_audible: Play | null = (game as any)._pending_off_audible ?? null;
  const def_audible: Play | null = (game as any)._pending_def_audible ?? null;
  const off_fake_audible: boolean = !!(game as any)._pending_off_fake;

  const qb_off_mods = offense.qb ? [offense.qb.modifier] : [];
  const qb_def_mods = defense.qb ? [defense.qb.modifier] : [];

  // Special: FG attempt handled separately
  if (off_play.parent === 'fg') {
    const kicker = offense.kicker;
    const power = kicker?.skill ?? 70;
    const yards_to_endzone = 100 - game.ball_yardline;
    const fg = attemptFieldGoal({
      yards_to_endzone,
      kicker_power: power,
      seed,
      qb_modifiers: qb_off_mods,
    });
    const parent_match = off_play.parent === def_play.parent;
    const sub_match = off_play.sub === def_play.sub;
    const turnover = parent_match && sub_match && Math.random() < 0.25; // 25% block chance on perfect read
    const result: PlayResult = {
      down: game.down,
      distance: game.distance,
      yardline_before: game.ball_yardline,
      yardline_after: game.ball_yardline,
      off_call: off_play,
      def_call: def_play,
      off_audible: null,
      def_audible: null,
      off_fake_audible: false,
      parent_match,
      sub_match,
      turnover,
      yards: 0,
      scoring_event: fg.make ? 'fg' : null,
      seed,
      text_recap: fg.make
        ? `FIELD GOAL IS GOOD! (${fg.total} > ${yards_to_endzone})`
        : `FG missed (${fg.total} ≤ ${yards_to_endzone})`,
    };
    if (fg.make) {
      game.scores = addPoints(game.scores, game.possession_idx, 0.5);
      game.ball_yardline = 25;
      game.down = 1;
      game.distance = 10;
      game.possession_idx = game.possession_idx === 0 ? 1 : 0;
    } else {
      // miss = turnover at spot
      game.possession_idx = game.possession_idx === 0 ? 1 : 0;
      game.ball_yardline = 100 - yards_to_endzone;
      game.down = 1;
      game.distance = 10;
    }
    clearAudibles(game);
    clearSchemes(room);
    game.history.push(result);
    game.last_play_seed = seed;
    const winner = checkWinner(game.scores);
    if (winner !== null) game.phase = 'ended';
    else game.phase = 'between_plays';
    return { result, scoring_event: fg.make ? 'fg' : null };
  }

  // Punt handled: punt is its own play with no skill roll.
  if (off_play.parent === 'punt') {
    const parent_match = off_play.parent === def_play.parent;
    const sub_match = off_play.sub === def_play.sub;
    const turnover_chance =
      parent_match && sub_match ? 0.25 : parent_match ? 0.05 : 0;
    const turnover = Math.random() < turnover_chance;
    // Punt yardage: 30-50 yard kick
    const rng = mulberry32(seed);
    const punt_yards = 30 + Math.floor(rng() * 21);
    let yardline_after = game.ball_yardline + punt_yards;
    if (yardline_after >= 100) yardline_after = 100; // touchback -> opp 25 means yardline=75
    const result: PlayResult = {
      down: game.down,
      distance: game.distance,
      yardline_before: game.ball_yardline,
      yardline_after,
      off_call: off_play,
      def_call: def_play,
      off_audible: null,
      def_audible: null,
      off_fake_audible: false,
      parent_match,
      sub_match,
      turnover,
      yards: punt_yards,
      scoring_event: null,
      seed,
      text_recap: turnover
        ? `PUNT BLOCKED! Defense takes over.`
        : `Punt of ${punt_yards} yards.`,
    };
    if (turnover) {
      // Defense takes over at spot
      game.possession_idx = game.possession_idx === 0 ? 1 : 0;
      game.ball_yardline = yardline_after;
      game.down = 1;
      game.distance = 10;
    } else {
      // Receiving team takes at landing spot (mirror to opp side)
      game.possession_idx = game.possession_idx === 0 ? 1 : 0;
      game.ball_yardline = 100 - yardline_after;
      game.down = 1;
      game.distance = 10;
    }
    clearAudibles(game);
    clearSchemes(room);
    game.history.push(result);
    game.last_play_seed = seed;
    const winner = checkWinner(game.scores);
    if (winner !== null) game.phase = 'ended';
    else game.phase = 'between_plays';
    return { result, scoring_event: null };
  }

  // Run/Pass: standard resolvePlay
  const offSkill = offense.off_skill?.skill ?? 60;
  const defSkill = defense.def_skill?.skill ?? 60;
  const resolve = resolvePlay({
    off_skill: offSkill,
    def_skill: defSkill,
    off_play,
    def_play,
    off_audible,
    def_audible,
    off_fake_audible,
    qb_off_modifiers: qb_off_mods,
    qb_def_modifiers: qb_def_mods,
    seed,
  });
  const yardline_before = game.ball_yardline;
  const adv = advanceAfterPlay(game, resolve.yards);
  let scoring_event: 'td' | 'safety' | null = null;
  if (adv.touchdown) {
    game.scores = addPoints(game.scores, game.possession_idx, 1);
    scoring_event = 'td';
  } else if (adv.safety) {
    game.scores = addPoints(game.scores, game.possession_idx === 0 ? 1 : 0, 0.5);
    scoring_event = 'safety';
  }
  // Turnover on downs (no first down reached AND down=4 after)
  if (!resolve.turnover && resolve.yards < game.distance && game.down === 4) {
    // turnover on downs at spot
    game.possession_idx = game.possession_idx === 0 ? 1 : 0;
  } else if (resolve.turnover) {
    game.possession_idx = game.possession_idx === 0 ? 1 : 0;
  } else if (scoring_event) {
    // After TD or safety, opponent gets ball
    game.possession_idx = game.possession_idx === 0 ? 1 : 0;
    game.ball_yardline = 25;
    game.down = 1;
    game.distance = 10;
  } else if (adv.next.down === 1) {
    // 1st down achieved, stay
  }
  // For non-scoring non-turnover: state already updated by advanceAfterPlay.
  // For non-turnover 4th down: we just set possession above if needed.
  // Note: advanceAfterPlay already updated next.down/distance correctly.

  const result: PlayResult = {
    down: game.down,
    distance: game.distance,
    yardline_before,
    yardline_after: adv.next.ball_yardline,
    off_call: off_play,
    def_call: def_play,
    off_audible,
    def_audible,
    off_fake_audible,
    parent_match: resolve.parent_match,
    sub_match: resolve.sub_match,
    turnover: resolve.turnover,
    yards: resolve.yards,
    scoring_event,
    seed,
    text_recap: recapText(resolve, scoring_event),
  };
  clearAudibles(game);
  clearSchemes(room);
  game.history.push(result);
  game.last_play_seed = seed;
  const winner = checkWinner(game.scores);
  if (winner !== null) game.phase = 'ended';
  else game.phase = 'between_plays';
  return { result, scoring_event };
}

function recapText(r: ReturnType<typeof resolvePlay>, scoring: 'td' | 'safety' | null): string {
  if (scoring === 'td') return `TOUCHDOWN! ${r.yards} yards.`;
  if (scoring === 'safety') return `SAFETY! Loss of ${Math.abs(r.yards)} yards.`;
  if (r.turnover) return `TURNOVER! (parent+sub read correct)`;
  if (r.yards > 0) return `Gain of ${r.yards}.`;
  if (r.yards < 0) return `Loss of ${Math.abs(r.yards)}.`;
  return `No gain.`;
}

export function clearSchemes(room: RoomState): void {
  room.pending_schemes = {};
}

export function clearAudibles(game: GameState): void {
  (game as any)._pending_off_audible = null;
  (game as any)._pending_def_audible = null;
  (game as any)._pending_off_fake = false;
}

/** Build a snapshot for broadcasting. */
export function snapshot(room: RoomState): any {
  return {
    session_id: room.session_id,
    players: room.players,
    coin_result: room.coin_result,
    first_possession_id: room.first_possession_id,
    draft: room.draft && {
      turn: room.draft.turn,
      total: TOTAL_PICKS,
      order: room.draft.order,
      pool: room.draft.pool,
      picks: room.draft.picks,
      first_possession_id: room.draft.first_possession_id,
    },
    game: room.game,
    pending_schemes: room.pending_schemes,
  };
}