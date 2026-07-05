// Gridiron Heads — shared game types
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
  | 'ended';

export interface GameState {
  session_id: string;
  phase: GamePhase;
  scores: [number, number]; // half-points allowed (D9)
  down: 1 | 2 | 3 | 4;
  distance: number;
  ball_yardline: number; // 0..100
  possession_idx: 0 | 1;
  teams: [TeamState, TeamState];
  audibles_used: [number, number];
  fake_audibles_used: [number, number];
  history: PlayResult[];
  last_play_seed: number | null;
}

export type ScoringEvent = 'td' | 'fg' | 'safety' | null;

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