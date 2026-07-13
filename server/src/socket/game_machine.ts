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
  evaluateRegulation,
  shootoutDistance,
  mulberry32,
  flipPossession,
  offenseDirection,
  yardsToEndzone,
  kickoffYardline,
  SUB_OPTIONS_BY_PARENT,
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
  MatchOutcome,
  ShootoutAttempt,
} from '@gridiron/shared';

export interface RoomState {
  session_id: string;
  host_id: string; // player_id of session creator
  guest_id: string | null;
  players: { id: string; name: string; ready: boolean; is_cpu?: boolean }[];
  coin_result: 'heads' | 'tails' | null;
  first_possession_id: string | null;
  draft: DraftState | null;
  game: GameState | null;
  /** Authoritative terminal result. Kept at room level so draft concessions work. */
  outcome: MatchOutcome | null;
  /** Decisive kick result waiting for its animation to finish. */
  pending_outcome: MatchOutcome | null;
  /** Random draft seed (also used to generate deterministic draft). */
  draft_seed: number;
  /** Scheme picks not yet revealed: player_id → Play */
  pending_schemes: Record<string, Play>;
  /** Audible phases: 'awaiting_off' | 'awaiting_def' | 'none' */
  audible_state: 'none' | 'awaiting_off_audible' | 'awaiting_def_audible';
  /** Sub-options for current audible choice */
  current_play: Play | null;
  /** Monotonic token used to invalidate stale auto-advance timers. */
  play_generation: number;
  /** Player id of the CPU opponent, when this is a vs-CPU room. null otherwise. */
  cpu_player_id: string | null;
  /** Last time any socket interacted with this room. Used by the in-memory
   *  reaper to drop abandoned rooms. */
  last_activity_at: number;
}

export function newRoom(
  session_id: string,
  host_id: string,
  host_name: string,
  opts: { cpu_player_id?: string | null; cpu_name?: string } = {},
): RoomState {
  const cpuId = opts.cpu_player_id ?? null;
  const players: RoomState['players'] = [{ id: host_id, name: host_name, ready: false }];
  if (cpuId) {
    players.push({ id: cpuId, name: opts.cpu_name ?? 'CPU Bot', ready: true, is_cpu: true });
  }
  return {
    session_id,
    host_id,
    guest_id: cpuId, // CPU also fills the guest slot for index consistency
    players,
    coin_result: null,
    first_possession_id: null,
    draft: null,
    game: null,
    outcome: null,
    pending_outcome: null,
    draft_seed: Math.floor(Math.random() * 2 ** 32),
    pending_schemes: {},
    audible_state: 'none',
    current_play: null,
    play_generation: 0,
    cpu_player_id: cpuId,
    last_activity_at: Date.now(),
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
  // New offense starts at their own 25 — dir-aware absolute spot.
  // dir=+1 (team 0) → absolute 25; dir=-1 (team 1) → absolute 75.
  game.ball_yardline = kickoffYardline(offenseDirection(game));
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

/** Validate untrusted socket play payloads. Punt/FG retain a placeholder
 * subtype in the current Play shape, but that value has no gameplay meaning. */
export function isValidPlay(value: unknown): value is Play {
  if (!value || typeof value !== 'object') return false;
  const { parent, sub } = value as Partial<Play>;
  if (parent !== 'run' && parent !== 'pass' && parent !== 'punt' && parent !== 'fg') return false;
  if (sub !== 'inside' && sub !== 'outside' && sub !== 'deep' && sub !== 'short') return false;
  if (parent === 'punt' || parent === 'fg') return true;
  return SUB_OPTIONS_BY_PARENT[parent].includes(sub);
}

export function audibleLimit(team: TeamState, kind: 'real' | 'fake'): number {
  const stat = kind === 'real' ? 'real_audible_refresh' : 'fake_audible_refresh';
  const modifier = team.qb?.modifier;
  return 1 + (modifier?.stat === stat ? modifier.value : 0);
}

export function endMatch(
  room: RoomState,
  winner_idx: 0 | 1,
  reason: MatchOutcome['reason'],
  conceded_by_idx: 0 | 1 | null = null,
): void {
  if (room.outcome) return;
  room.pending_outcome = null;
  room.outcome = { winner_idx, reason, conceded_by_idx };
  room.play_generation++;
  clearSchemes(room);
  if (room.game) {
    clearAudibles(room.game);
    room.game.phase = 'ended';
  }
  room.players.forEach((player) => { player.ready = !!player.is_cpu; });
}

export function concedeMatch(
  room: RoomState,
  player_id: string,
): { ok: true } | { ok: false; reason: string } {
  if (room.outcome) return { ok: false, reason: 'match_ended' };
  if (room.pending_outcome) return { ok: false, reason: 'match_finishing' };
  if (!room.draft) return { ok: false, reason: 'match_not_started' };
  const player_idx = room.players.findIndex((player) => player.id === player_id);
  if (player_idx !== 0 && player_idx !== 1) return { ok: false, reason: 'unknown_player' };
  if (room.players[player_idx].is_cpu) return { ok: false, reason: 'cpu_id_reserved' };
  const conceded_by_idx = player_idx as 0 | 1;
  endMatch(room, conceded_by_idx === 0 ? 1 : 0, 'concession', conceded_by_idx);
  return { ok: true };
}

function setShootoutSpot(game: GameState, kicker_idx: 0 | 1): void {
  const distance = game.shootout!.distance;
  game.possession_idx = kicker_idx;
  game.ball_yardline = kicker_idx === 0 ? 100 - distance : distance;
  game.down = 1;
  game.distance = distance;
}

function startShootout(room: RoomState): void {
  const game = room.game!;
  const first_kicker_idx: 0 | 1 = room.players[0].id === room.first_possession_id ? 0 : 1;
  game.shootout = {
    round: 1,
    distance: shootoutDistance(1),
    first_kicker_idx,
    next_kicker_idx: first_kicker_idx,
    round_attempts: [null, null],
    attempts: [],
  };
  clearSchemes(room);
  clearAudibles(game);
  setShootoutSpot(game, first_kicker_idx);
}

function completeRegulationPossession(room: RoomState, offense_idx: 0 | 1): void {
  const game = room.game!;
  game.possessions_completed[offense_idx]++;
  const outcome = evaluateRegulation(game.scores, game.possessions_completed);
  if (outcome.status === 'winner') {
    endMatch(room, outcome.winner_idx, 'regulation');
  } else if (outcome.status === 'shootout') {
    startShootout(room);
    game.phase = 'between_plays';
  } else {
    game.phase = 'between_plays';
  }
}

export function nextActionPhase(game: GameState): 'awaiting_schemes' | 'shootout_ready' {
  return game.shootout ? 'shootout_ready' : 'awaiting_schemes';
}

export function resolveShootoutKick(
  room: RoomState,
  player_idx: 0 | 1,
  seed: number,
): { ok: true; result: PlayResult } | { ok: false; reason: string } {
  const game = room.game;
  if (!game || !game.shootout) return { ok: false, reason: 'no_shootout' };
  if (room.outcome || game.phase === 'ended') return { ok: false, reason: 'match_ended' };
  if (game.phase !== 'shootout_ready') return { ok: false, reason: 'shootout_not_ready' };
  if (game.shootout.next_kicker_idx !== player_idx) return { ok: false, reason: 'not_your_kick' };

  const shootout = game.shootout;
  const team = game.teams[player_idx];
  const qb_modifiers = team.qb ? [team.qb.modifier] : [];
  const fg = attemptFieldGoal({
    yards_to_endzone: shootout.distance,
    kicker_power: team.kicker?.skill ?? 70,
    seed,
    qb_modifiers,
  });
  const attempt: ShootoutAttempt = {
    round: shootout.round,
    distance: shootout.distance,
    player_idx,
    made: fg.make,
    power_roll: fg.power_roll,
    bonus_roll: fg.bonus_roll,
    total: fg.total,
    power_used: fg.power_used,
    seed,
  };
  if (fg.make) game.scores = addPoints(game.scores, player_idx, 0.5);

  const kickCall: Play = { parent: 'fg', sub: 'inside' };
  const offense_direction: 1 | -1 = player_idx === 0 ? 1 : -1;
  const result: PlayResult = {
    down: 1,
    distance: shootout.distance,
    yardline_before: game.ball_yardline,
    yardline_after: game.ball_yardline,
    off_call: kickCall,
    def_call: kickCall,
    off_audible: null,
    def_audible: null,
    off_fake_audible: false,
    parent_match: false,
    sub_match: false,
    turnover: false,
    yards: 0,
    scoring_event: fg.make ? 'fg' : null,
    seed,
    offense_direction,
    effective_off_call: kickCall,
    effective_def_call: kickCall,
    play_outcome: fg.make ? 'field_goal_good' : 'field_goal_missed',
    turnover_on_downs: false,
    shootout_attempt: attempt,
    text_recap: fg.make
      ? `SHOOTOUT KICK IS GOOD! (${fg.total} > ${shootout.distance})`
      : `Shootout kick missed (${fg.total} ≤ ${shootout.distance})`,
    off_roll: 0,
    def_roll: 0,
    off_skill_eff: 0,
    def_skill_eff: 0,
    off_line_roll: 0,
    def_line_roll: 0,
    off_line_skill: 0,
    def_line_skill: 0,
    line_winner: null,
    line_regime: null,
    line_roll_gap: 0,
    fg_power_roll: fg.power_roll,
    fg_bonus_roll: fg.bonus_roll,
    fg_total: fg.total,
    fg_power_eff: fg.power_used,
  };
  shootout.round_attempts[player_idx] = attempt;
  shootout.attempts.push(attempt);
  game.history.push(result);
  game.last_play_seed = seed;

  const first = shootout.round_attempts[shootout.first_kicker_idx];
  const second_idx: 0 | 1 = shootout.first_kicker_idx === 0 ? 1 : 0;
  const second = shootout.round_attempts[second_idx];
  if (!first || !second) {
    shootout.next_kicker_idx = second_idx;
    setShootoutSpot(game, second_idx);
    game.phase = 'shootout_between';
    return { ok: true, result };
  }

  if (first.made !== second.made) {
    room.pending_outcome = {
      winner_idx: first.made ? first.player_idx : second.player_idx,
      reason: 'shootout',
      conceded_by_idx: null,
    };
    game.phase = 'shootout_between';
    return { ok: true, result };
  }

  shootout.round++;
  shootout.distance = shootoutDistance(shootout.round);
  shootout.first_kicker_idx = second_idx;
  shootout.next_kicker_idx = second_idx;
  shootout.round_attempts = [null, null];
  setShootoutSpot(game, second_idx);
  game.phase = 'shootout_between';
  return { ok: true, result };
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
  if (!off_play || !def_play) throw new Error('missing scheme');

  const down_before = game.down;
  const distance_before = game.distance;
  const yardline_before = game.ball_yardline;

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
    const sub_match = parent_match; // special teams have no meaningful subtype
    const blocked = parent_match && mulberry32((seed ^ 0x4647424c) >>> 0)() < 0.25;
    const made = fg.make && !blocked;
    const result: PlayResult = {
      down: down_before,
      distance: distance_before,
      yardline_before,
      yardline_after: game.ball_yardline,
      off_call: off_play,
      def_call: def_play,
      off_audible: null,
      def_audible: null,
      off_fake_audible: false,
      parent_match,
      sub_match,
      turnover: true,
      yards: 0,
      scoring_event: made ? 'fg' : null,
      seed,
      offense_direction,
      effective_off_call: off_play,
      effective_def_call: def_play,
      play_outcome: blocked
        ? 'field_goal_blocked'
        : made
          ? 'field_goal_good'
          : 'field_goal_missed',
      turnover_on_downs: false,
      text_recap: blocked
        ? 'FIELD GOAL BLOCKED! Defense takes over.'
        : made
          ? `FIELD GOAL IS GOOD! (${fg.total} > ${ytg})`
          : `FG missed (${fg.total} ≤ ${ytg})`,
      // Skill + line rolls are 0 on FG (no roll fires). The FG-specific fields
      // below populate the FG matchup rect.
      off_roll: 0,
      def_roll: 0,
      off_skill_eff: 0,
      def_skill_eff: 0,
      off_line_roll: 0,
      def_line_roll: 0,
      off_line_skill: 0,
      def_line_skill: 0,
      line_winner: null,
      line_regime: null,
      line_roll_gap: 0,
      // Phase 0: surface the FG roll values for the canvas HUD
      fg_power_roll: fg.power_roll,
      fg_bonus_roll: fg.bonus_roll,
      fg_total: fg.total,
      fg_power_eff: fg.power_used,
    };
    if (made) {
      game.scores = addPoints(game.scores, game.possession_idx, 0.5);
      // Flip first so offenseDirection(game) reflects the NEW offense, then
      // place the ball at their own 25 (dir-aware absolute spot).
      Object.assign(game, flipPossession(game));
      game.ball_yardline = kickoffYardline(offenseDirection(game));
    } else {
      // Miss → opposing team at the LOS (same absolute spot), fresh 1st & 10.
      game.ball_yardline = game.ball_yardline;
      Object.assign(game, flipPossession(game));
    }
    clearAudibles(game);
    clearSchemes(room);
    game.history.push(result);
    game.last_play_seed = seed;
    completeRegulationPossession(room, offIdx);
    return { result, scoring_event: made ? 'fg' : null };
  }

  // Punt handled: punt is its own play with no skill roll.
  if (off_play.parent === 'punt') {
    const parent_match = off_play.parent === def_play.parent;
    const sub_match = parent_match; // special teams have no meaningful subtype
    const blocked = parent_match && mulberry32((seed ^ 0x50554e54) >>> 0)() < 0.25;
    // Punt yardage: 30-50 yard kick (FORWARD in the offense's direction).
    const rng = mulberry32(seed);
    const punt_yards = 30 + Math.floor(rng() * 21);
    const off_dir = offenseDirection(game);
    // Move ball forward from LOS in the offense's direction; clamp to field.
    const receivingFive = off_dir === 1 ? 95 : 5;
    let yardline_after = blocked
      ? game.ball_yardline
      : game.ball_yardline + punt_yards * off_dir;
    if (!blocked) {
      yardline_after = off_dir === 1
        ? Math.min(receivingFive, yardline_after)
        : Math.max(receivingFive, yardline_after);
    }
    const net_punt_yards = Math.abs(yardline_after - game.ball_yardline);
    const result: PlayResult = {
      down: down_before,
      distance: distance_before,
      yardline_before,
      yardline_after,
      off_call: off_play,
      def_call: def_play,
      off_audible: null,
      def_audible: null,
      off_fake_audible: false,
      parent_match,
      sub_match,
      turnover: true,
      yards: net_punt_yards,
      scoring_event: null,
      seed,
      offense_direction: off_dir,
      effective_off_call: off_play,
      effective_def_call: def_play,
      play_outcome: blocked ? 'punt_blocked' : 'punt',
      turnover_on_downs: false,
      text_recap: blocked
        ? `PUNT BLOCKED! Defense takes over.`
        : `Punt of ${net_punt_yards} yards.`,
      // Skill + line rolls are 0 on punt (no skill or line roll fires).
      off_roll: 0,
      def_roll: 0,
      off_skill_eff: 0,
      def_skill_eff: 0,
      off_line_roll: 0,
      def_line_roll: 0,
      off_line_skill: 0,
      def_line_skill: 0,
      line_winner: null,
      line_regime: null,
      line_roll_gap: 0,
      // Phase 0: surface the punt roll for the canvas HUD
      punt_roll: net_punt_yards,
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
    completeRegulationPossession(room, offIdx);
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
    yardline_before,
    offense_direction,
    down: down_before,
  });
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
  let turnover_on_downs = false;

  if (adv.touchdown) {
      // TD → +1 to offense. New offense takes ball at their own 25
      // (touchback-style; dir-aware absolute spot: 25 if they attack right,
      // 75 if they attack left) and attacks the OPPOSITE end zone.
      game.scores = addPoints(game.scores, game.possession_idx, 1);
      scoring_event = 'td';
      next_possession = game.possession_idx === 0 ? 1 : 0;
      next_yardline = kickoffYardline(next_possession === 0 ? 1 : -1);
      next_down = 1;
      next_distance = 10;
      change_of_possession = true;
    } else if (adv.safety) {
      // Safety → +0.5 to defense. Defense gets ball at their own 25
      // (free kick style; dir-aware absolute spot) and attacks the OPPOSITE
      // end zone.
      game.scores = addPoints(game.scores, game.possession_idx === 0 ? 1 : 0, 0.5);
      scoring_event = 'safety';
      next_possession = game.possession_idx === 0 ? 1 : 0;
      next_yardline = kickoffYardline(next_possession === 0 ? 1 : -1);
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
      turnover_on_downs = true;
    } else {
      // Normal play: keep offense, apply advanceAfterPlay's down/distance/yardline
      // (next_down/next_distance/next_yardline already set above)
    }

  game.ball_yardline = next_yardline;
  game.down = next_down;
  game.distance = next_distance;
  game.possession_idx = next_possession;
  // New offense gets a fresh 1 real + 1 fake audible per drive. Reset only
  // when possession actually flipped — same-team plays preserve the counter.
  if (change_of_possession) {
    game.audibles_used[next_possession] = 0;
    game.fake_audibles_used[next_possession] = 0;
  }

  const result: PlayResult = {
    down: down_before,
    distance: distance_before,
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
    effective_off_call: resolve.effective_off_play,
    effective_def_call: resolve.effective_def_play,
    play_outcome: resolve.turnover
      ? resolve.effective_off_play.parent === 'pass' ? 'interception' : 'fumble'
      : resolve.effective_off_play.parent === 'pass'
        ? resolve.yards < 0
          ? 'pass_sack'
          : resolve.yards === 0
            ? 'pass_incomplete'
            : 'pass_complete'
        : 'run',
    turnover_on_downs,
    text_recap: turnover_on_downs
      ? `TURNOVER ON DOWNS! ${resolve.yards > 0 ? `Gain of ${resolve.yards}.` : resolve.yards < 0 ? `Loss of ${Math.abs(resolve.yards)}.` : 'No gain.'}`
      : recapText(resolve, scoring_event),
    // Phase 0: surface every per-play roll so the client HUD can show
    // what each position group rolled for its skill check
    off_roll: resolve.off_roll,
    def_roll: resolve.def_roll,
    off_skill_eff: resolve.off_skill_eff,
    def_skill_eff: resolve.def_skill_eff,
    off_line_roll: resolve.off_line_roll,
    def_line_roll: resolve.def_line_roll,
    off_line_skill: resolve.off_line_skill,
    def_line_skill: resolve.def_line_skill,
    line_winner: resolve.line_winner,
    line_regime: resolve.line_regime,
    line_roll_gap: resolve.line_roll_gap,
  };
  clearAudibles(game);
  clearSchemes(room);
  game.history.push(result);
  game.last_play_seed = seed;
  if (change_of_possession) completeRegulationPossession(room, offIdx);
  else game.phase = 'between_plays';
  return { result, scoring_event };
}

function recapText(
  r: ReturnType<typeof resolvePlay>,
  scoring: 'td' | 'safety' | null,
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
  const revealSchemes = Object.keys(room.pending_schemes).length === 2
    || room.game?.phase !== 'awaiting_schemes';
  const pending_schemes = revealSchemes
    ? room.pending_schemes
    : Object.fromEntries(Object.keys(room.pending_schemes).map((id) => [id, null]));
  let game: Record<string, unknown> | null = null;
  if (room.game) {
    const {
      _pending_off_audible: _offAudible,
      _pending_def_audible: _defAudible,
      _pending_off_fake: _offFake,
      ...publicGame
    } = room.game as GameState & Record<string, unknown>;
    game = publicGame;
  }
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
    game,
    outcome: room.outcome,
    pending_schemes,
  };
}
