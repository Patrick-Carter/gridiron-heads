// Game state machine — server-authoritative.
// Tracks all game state for a session and broadcasts transitions.

import {
  newGameState,
  generateDraft,
  takeFromPool,
  TOTAL_PICKS,
  advanceAfterPlay,
  resolvePlay,
  attemptFieldGoal,
  addPoints,
  checkWinner,
  mulberry32,
  flipPossession,
  offenseDirection,
  yardsToEndzone,
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

/** Start the draft with a freshly generated pool. Alternating picks: first_possession
 *  picks 1, 3, 5, ...; other player picks 2, 4, 6, ... On each pick, the picker
 *  may choose any group they haven't yet picked. */
export function startDraft(room: RoomState): void {
  const rng = mulberry32(room.draft_seed);
  const pool = generateDraft(rng);
  const first = room.first_possession_id!;
  const second = room.players.find((p) => p.id !== first)!.id;
  const pick_order: string[] = [];
  for (let i = 0; i < TOTAL_PICKS; i++) {
    pick_order.push(i % 2 === 0 ? first : second);
  }
  room.draft = {
    picks: { [first]: emptyTeam(), [second]: emptyTeam() },
    pool: pool as any,
    pick_order,
    current_turn: 0,
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

/** Alternating-turn draft pick. Picker is whoever's turn it is; they may pick ANY
 *  group they haven't already taken. */
export function draftPick(
  room: RoomState,
  player_id: string,
  group: PositionGroup,
  option_id: string,
): { ok: true; picked: PositionOption | QBOption } | { ok: false; reason: string } {
  if (!room.draft) return { ok: false, reason: 'no_draft' };
  if (room.draft.current_turn >= TOTAL_PICKS) return { ok: false, reason: 'draft_done' };
  const expectedPicker = room.draft.pick_order[room.draft.current_turn];
  if (expectedPicker !== player_id) return { ok: false, reason: 'not_your_turn' };
  const team = room.draft.picks[player_id];
  if (!team) return { ok: false, reason: 'unknown_player' };
  if (groupAlreadyPicked(team, group)) return { ok: false, reason: 'group_already_picked' };
  const taken = takeFromPool(room.draft.pool, group, option_id);
  if (!taken) return { ok: false, reason: 'option_not_in_pool' };

  assignToTeam(team, group, taken as PositionOption & QBOption);
  room.draft.current_turn++;
  return { ok: true, picked: taken as PositionOption | QBOption };
}

function groupAlreadyPicked(team: TeamState, group: PositionGroup): boolean {
  switch (group) {
    case 'QB': return team.qb !== null;
    case 'D_LINE': return team.d_line !== null;
    case 'O_LINE': return team.o_line !== null;
    case 'OFF_SKILL': return team.off_skill !== null;
    case 'DEF_SKILL': return team.def_skill !== null;
    case 'KICKER': return team.kicker !== null;
  }
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
  // Always: ball at yardline 25, offense attacks right. Team identity only flips
  // possession_idx; the visual field is identical for both teams.
  game.ball_yardline = 25;
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
    const ytg = yardsToEndzone(game); // direction-aware
    const offense_direction = offenseDirection(game);
    const fg = attemptFieldGoal({
      yards_to_endzone: ytg,
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
      offense_direction,
      text_recap: fg.make
        ? `FIELD GOAL IS GOOD! (${fg.total} > ${ytg})`
        : `FG missed (${fg.total} ≤ ${ytg})`,
    };
    if (fg.make) {
      game.scores = addPoints(game.scores, game.possession_idx, 0.5);
      // New offense takes ball at absolute yardline 25; they attack the
      // OPPOSITE end zone — flipPossession handles that and resets to 1st & 10.
      game.ball_yardline = 25;
      Object.assign(game, flipPossession(game));
    } else {
      // Miss → opposing team at the LOS (same absolute spot), fresh 1st & 10.
      game.ball_yardline = game.ball_yardline;
      Object.assign(game, flipPossession(game));
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
    // Punt yardage: 30-50 yard kick (FORWARD in the offense's direction).
    const rng = mulberry32(seed);
    const punt_yards = 30 + Math.floor(rng() * 21);
    const off_dir = offenseDirection(game);
    // Move ball forward from LOS in the offense's direction; clamp to field.
    let yardline_after = game.ball_yardline + punt_yards * off_dir;
    yardline_after = Math.max(0, Math.min(100, yardline_after));
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
      offense_direction: off_dir,
      text_recap: turnover
        ? `PUNT BLOCKED! Defense takes over.`
        : `Punt of ${punt_yards} yards.`,
    };
    // Either way, receiving team gets the ball at the absolute landing spot
    // with a fresh 1st & 10 and attacks the OPPOSITE end zone. The yardline
    // stays as-is (no 100 - x mirroring); the direction flip is what changes
    // who has to drive how far.
    game.ball_yardline = yardline_after;
    Object.assign(game, flipPossession(game));
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
  const offLineSkill = offense.o_line?.skill ?? 60;
  const defLineSkill = defense.d_line?.skill ?? 60;
  // Direction is per-possession: team 0 → +1 (toward 100), team 1 → -1 (toward 0).
  const offense_direction = offenseDirection(game);
  const resolve = resolvePlay({
    off_skill: offSkill,
    def_skill: defSkill,
    off_line_skill: offLineSkill,
    def_line_skill: defLineSkill,
    off_play,
    def_play,
    off_audible,
    def_audible,
    off_fake_audible,
    qb_off_modifiers: qb_off_mods,
    qb_def_modifiers: qb_def_mods,
    seed,
    yardline_before: game.ball_yardline,
    offense_direction,
  });
  const yardline_before = game.ball_yardline;
  const adv = advanceAfterPlay(game, resolve.yards);
  let scoring_event: 'td' | 'safety' | null = null;

  // Compute new possession + yardline + downs BEFORE mutating the game object.
  // Default: same offense keeps ball, advance down/distance/yardline from advanceAfterPlay.
  let next_possession: 0 | 1 = game.possession_idx;
  let next_yardline = adv.next.ball_yardline;
  let next_down: 1 | 2 | 3 | 4 = adv.next.down;
  let next_distance = adv.next.distance;
  // Whether the ball changed hands (TO, score, turnover-on-downs)
  let change_of_possession = false;

  if (adv.touchdown) {
      // TD → +1 to offense. New offense takes ball at absolute yardline 25
      // (touchback-style for both teams) and attacks the OPPOSITE end zone.
      game.scores = addPoints(game.scores, game.possession_idx, 1);
      scoring_event = 'td';
      next_yardline = 25;
      next_possession = game.possession_idx === 0 ? 1 : 0;
      next_down = 1;
      next_distance = 10;
      change_of_possession = true;
    } else if (adv.safety) {
      // Safety → +0.5 to defense. Defense gets ball at absolute yardline 25
      // (free kick style — same start spot for both teams) and attacks the
      // OPPOSITE end zone.
      game.scores = addPoints(game.scores, game.possession_idx === 0 ? 1 : 0, 0.5);
      scoring_event = 'safety';
      next_possession = game.possession_idx === 0 ? 1 : 0;
      next_yardline = 25;
      next_down = 1;
      next_distance = 10;
      change_of_possession = true;
    } else if (resolve.turnover) {
      // Defensive read was correct → ball flips at the post-play LOS. The new
      // offense attacks the OTHER end zone — possession flip alone is enough;
      // ball_yardline stays at the current spot (which the resolver already
      // advanced correctly). Fresh 1st & 10.
      next_yardline = adv.next.ball_yardline;
      next_possession = game.possession_idx === 0 ? 1 : 0;
      next_down = 1;
      next_distance = 10;
      change_of_possession = true;
    } else if (game.down === 4 && resolve.yards < game.distance) {
      // Turnover on downs: failed to convert on 4th. New offense takes ball
      // at the LOS (post-play yardline) with a fresh 1st & 10, attacks the
      // OPPOSITE end zone.
      next_yardline = adv.next.ball_yardline;
      next_possession = game.possession_idx === 0 ? 1 : 0;
      next_down = 1;
      next_distance = 10;
      change_of_possession = true;
    } else {
      // Normal play: keep offense, apply advanceAfterPlay's down/distance/yardline
      // (next_down/next_distance/next_yardline already set above)
    }

  game.ball_yardline = next_yardline;
  game.down = next_down;
  game.distance = next_distance;
  game.possession_idx = next_possession;

  const result: PlayResult = {
    down: game.down,
    distance: game.distance,
    yardline_before,
    yardline_after: game.ball_yardline,
    off_call: off_play,
    def_call: def_play,
    off_audible,
    def_audible,
    off_fake_audible,
    parent_match: resolve.parent_match,
    sub_match: resolve.sub_match,
    turnover: resolve.turnover || change_of_possession,
    yards: resolve.yards,
    scoring_event,
    seed,
    offense_direction,
    text_recap: recapText(resolve, scoring_event, game.down, game.distance),
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

function recapText(
  r: ReturnType<typeof resolvePlay>,
  scoring: 'td' | 'safety' | null,
  next_down: 1 | 2 | 3 | 4,
  next_distance: number,
): string {
  if (scoring === 'td') return `TOUCHDOWN! ${r.yards} yards.`;
  if (scoring === 'safety') return `SAFETY! Loss of ${Math.abs(r.yards)} yards.`;
  // Turnover rolled — line play recap doesn't override it (fumble narrative).
  if (r.turnover) return `TURNOVER! (defense read it)`;
  // Line dominated the outcome — frame it as a line play.
  if (r.line_regime === 'dominate') {
    if (r.line_winner === 'offense') {
      return r.yards > 0
        ? `LINE OPENS THE HOLE! Gain of ${r.yards}.`
        : `LINE STILL LOSES ${Math.abs(r.yards)} despite winning the trench.`;
    }
    return r.yards < 0
      ? `BLOWN UP BY THE LINE! Loss of ${Math.abs(r.yards)}.`
      : `LINE OWNED THE TRENCH but gave up ${r.yards}.`;
  }
  if (r.line_regime === 'lean') {
    const side = r.line_winner === 'offense' ? 'O-line' : 'D-line';
    const verb = r.line_winner === 'offense'
      ? (r.yards > 0 ? `pushes for ${r.yards}` : `holds to ${r.yards}`)
      : `stops for ${r.yards}`;
    return `${side} ${verb}.`;
  }
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
      picks: room.draft.picks,
      pool: room.draft.pool,
      first_possession_id: room.draft.first_possession_id,
      pick_order: room.draft.pick_order,
      current_turn: room.draft.current_turn,
      current_picker_id: room.draft.pick_order[room.draft.current_turn] ?? null,
      total: TOTAL_PICKS,
      done: room.draft.current_turn,
    },
    game: room.game,
    pending_schemes: room.pending_schemes,
  };
}