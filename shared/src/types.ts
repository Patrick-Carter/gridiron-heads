// Browser Bowl — shared game types
// Both server (authoritative resolver) and client (mirror + UI) import these.

export type PlayParent = 'run' | 'pass' | 'punt' | 'fg';
export type PlaySub = 'inside' | 'outside' | 'deep' | 'short';
export interface Play {
  parent: PlayParent;
  sub: PlaySub;
}

export type PositionGroup = 'QB' | 'D_LINE' | 'O_LINE' | 'OFF_SKILL' | 'DEF_SKILL' | 'KICKER';

export interface PositionOption {
  id: string;
  group: PositionGroup;
  skill: number; // 50..100 for skill groups
  name: string;
}

export type QBStat =
  | 'off_skill_pct'
  | 'def_skill_pct'
  | 'turnover_chance_pct'
  | 'kicker_power_pct'
  | 'yards_pct'
  | 'fake_audible_refresh'
  | 'real_audible_refresh';

export type QBScope = 'all_plays' | 'pass' | 'run' | '4th_down' | 'fg' | 'punt';

export interface QBModifier {
  stat: QBStat;
  value: number; // positive only (buffs only per D26)
  scope: QBScope;
}

export interface QBOption {
  id: string;
  group: 'QB';
  name: string;
  modifier: QBModifier;
}

export interface TeamState {
  qb: QBOption | null;
  d_line: PositionOption | null;
  o_line: PositionOption | null;
  off_skill: PositionOption | null;
  def_skill: PositionOption | null;
  kicker: PositionOption | null;
}

export interface DraftPoolEntry {
  group: PositionGroup;
  options: PositionOption[]; // QB pool has 3
}

export interface DraftState {
  picks: Record<string, TeamState>; // player_id -> TeamState
  pool: Record<PositionGroup, (PositionOption | QBOption)[]>;
  /** Player IDs in alternating pick order (length = TOTAL_PICKS). Index = turn# */
  pick_order: string[];
  current_turn: number; // 0..TOTAL_PICKS-1
  first_possession_id: string;
}

export type GamePhase =
  | 'lobby'
  | 'coin'
  | 'draft'
  | 'pre_play'
  | 'awaiting_schemes'
  | 'awaiting_def_response'
  | 'ready_to_snap'
  | 'play_anim'
  | 'between_plays'
  | 'shootout_ready'
  | 'shootout_anim'
  | 'shootout_between'
  | 'ended';

export interface ShootoutAttempt {
  round: number;
  distance: number;
  player_idx: 0 | 1;
  made: boolean;
  power_roll: number;
  bonus_roll: number;
  total: number;
  power_used: number;
  seed: number;
}

export interface ShootoutState {
  round: number;
  distance: number;
  first_kicker_idx: 0 | 1;
  next_kicker_idx: 0 | 1;
  round_attempts: [ShootoutAttempt | null, ShootoutAttempt | null];
  attempts: ShootoutAttempt[];
}

export type MatchEndReason = 'regulation' | 'shootout' | 'concession';

export interface MatchOutcome {
  winner_idx: 0 | 1;
  reason: MatchEndReason;
  conceded_by_idx: 0 | 1 | null;
}

export interface GameState {
  session_id: string;
  phase: GamePhase;
  scores: [number, number]; // half-points allowed (D9)
  possessions_completed: [number, number];
  down: 1 | 2 | 3 | 4;
  distance: number;
  ball_yardline: number; // 0..100
  possession_idx: 0 | 1;
  teams: [TeamState, TeamState];
  audibles_used: [number, number];
  fake_audibles_used: [number, number];
  history: PlayResult[];
  last_play_seed: number | null;
  shootout: ShootoutState | null;
}

export type ScoringEvent = 'td' | 'fg' | 'safety' | null;

export type PlayOutcome =
  | 'run'
  | 'fumble'
  | 'pass_complete'
  | 'pass_incomplete'
  | 'pass_sack'
  | 'interception'
  | 'punt'
  | 'punt_blocked'
  | 'field_goal_good'
  | 'field_goal_missed'
  | 'field_goal_blocked';

export interface PlayResult {
  down: number;
  distance: number;
  yardline_before: number;
  yardline_after: number;
  off_call: Play;
  def_call: Play;
  off_audible: Play | null;
  def_audible: Play | null;
  off_fake_audible: boolean;
  parent_match: boolean;
  sub_match: boolean;
  turnover: boolean;
  yards: number;
  scoring_event: ScoringEvent;
  seed: number;
  text_recap: string;
  /** Direction of attack for the offense at the time of the play:
   *  +1 = attacking toward yardline 100 (right); -1 = attacking toward 0 (left). */
  offense_direction: 1 | -1;
  /** Calls after real audibles are applied. Optional for persisted pre-D results. */
  effective_off_call?: Play;
  effective_def_call?: Play;
  /** Exact football event used by the client play simulation. */
  play_outcome?: PlayOutcome;
  /** A failed fourth-down conversion, separate from the physical play outcome. */
  turnover_on_downs?: boolean;
  /** Present when this result is a score-settling shootout kick. */
  shootout_attempt?: ShootoutAttempt;

  // === Phase 0: roll-data plumbing (was discarded before — now exposed to client) ===
  /** Skill roll [0, off_skill_eff]. Higher = offense wins the play. Always present; 0 on punt/fg (no skill roll fired). On parent mismatch the roll is cosmetic — offense is auto-credited with the win. */
  off_roll: number;
  /** Skill roll [0, def_skill_eff]. Higher = defense wins the play. 0 on punt/fg. */
  def_roll: number;
  /** Effective off_skill after QB modifiers applied (the bound for off_roll). */
  off_skill_eff: number;
  /** Effective def_skill after QB modifiers applied (the bound for def_roll). */
  def_skill_eff: number;
  /** O-LINE roll [0, off_line_skill]. Per-play trench roll. 0 when punt/fg. */
  off_line_roll: number;
  /** D-LINE roll [0, def_line_skill]. Per-play trench roll. 0 when punt/fg. */
  def_line_roll: number;
  /** O_LINE skill bound for off_line_roll. */
  off_line_skill: number;
  /** D_LINE skill bound for def_line_roll. */
  def_line_skill: number;
  /** Which side won the line roll (null when gap was below LINE_ROLL_GAP_LEAN or punt/fg). */
  line_winner?: 'offense' | 'defense' | null;
  /** "lean" (gap 5..14) | "dominate" (gap >=15) | null. Drives yardage nudge / outcome flip. */
  line_regime?: 'lean' | 'dominate' | null;
  /** Per-play magnitude of line roll gap (winner_roll - loser_roll). 0 when skipped. */
  line_roll_gap?: number;
  /** FG: power roll [0, kicker_power_eff]. */
  fg_power_roll?: number;
  /** FG: bonus roll [0, 20]. Universal (no QB mod). */
  fg_bonus_roll?: number;
  /** FG: power_roll + bonus_roll. Compared to yards_to_endzone for make/miss. */
  fg_total?: number;
  /** FG: effective kicker power after QB modifiers (the bound for power_roll). */
  fg_power_eff?: number;
  /** Punt: net forward yardage after block/landing-spot caps. Used by the recap/HUD. */
  punt_roll?: number;
}

export function flipSubtype(p: Play): Play {
  const flip: Record<PlaySub, PlaySub> = {
    deep: 'short',
    short: 'deep',
    inside: 'outside',
    outside: 'inside',
  };
  return { parent: p.parent, sub: flip[p.sub] };
}

export const SUB_OPTIONS_BY_PARENT: Record<PlayParent, PlaySub[]> = {
  run: ['inside', 'outside'],
  pass: ['deep', 'short'],
  punt: [],
  fg: [],
};
