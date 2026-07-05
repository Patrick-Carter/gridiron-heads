// Play resolver — skill roll + line roll + turnover check + yardage.
// Skill roll: each side rolls [0, skill]. Higher wins. Ties = 0 yards, no turnover.
// Line roll (D-LINE / O-LINE): when the skill gap crosses LINE_GAP_LEAN, the
// trenches decide the play — a LEAN gap nudges yardage, a DOMINATE gap flips
// the outcome outright (blow-up or stuff). Below the threshold the line is
// ignored (no rng calls — common plays stay seed-stable).
import { mulberry32 } from './rng.js';
import type { Play, PlayParent, QBModifier } from './types.js';
import { flipSubtype } from './types.js';

export interface ResolveInput {
  off_skill: number;
  def_skill: number;
  off_play: Play;
  def_play: Play;
  off_audible?: Play | null;       // if used
  def_audible?: Play | null;       // if used (only allowed after off audible/fake)
  off_fake_audible?: boolean;
  qb_off_modifiers?: QBModifier[];  // applied to off_skill roll
  qb_def_modifiers?: QBModifier[];  // applied to def_skill roll
  /** O_LINE skill (50..100). Used by the line roll. Optional — default 60
   *  matches the server's fallback for null d_line/o_line. */
  off_line_skill?: number;
  /** D_LINE skill (50..100). */
  def_line_skill?: number;
  seed: number;
  /** Ball yardline before the play (0..100). Used to cap yards at the remaining
   *  distance to the goal line so a +20 gain from the 75 doesn't leave the ball
   *  at 95 with the recap reading "Gain of 20" when only 25 yards were possible.
   *  ABSOLUTE field position — the resolver also needs `offense_direction` to
   *  know which end zone is the offense's target. */
  yardline_before?: number;
  /** Direction the offense is attacking: +1 toward yardline 100, -1 toward 0.
   *  Defaults to +1 for backwards compatibility with callers that don't yet
   *  pass it (test fixtures). */
  offense_direction?: 1 | -1;
}

export interface ResolveOutput {
  effective_off_play: Play;
  effective_def_play: Play;
  parent_match: boolean;
  sub_match: boolean;
  off_roll: number;
  def_roll: number;
  /** Which side the line roll picked as winner, if the line roll fired.
   *  null when the gap was below LINE_GAP_LEAN (line roll skipped entirely). */
  line_winner: 'offense' | 'defense' | null;
  /** Magnitude of the line roll gap (winner_roll - loser_roll). 0 when skipped. */
  line_roll_gap: number;
  /** "lean" (gap 20..39, yardage nudged) | "dominate" (gap >=40, outcome flipped) | null. */
  line_regime: 'lean' | 'dominate' | null;
  turnover: boolean;
  turnover_chance: number;
  yards: number;
  seed: number;
}

// === Line roll knobs (D-LINE / O-LINE mechanic) ==============================
/** Minimum skill gap to trigger ANY line roll. Below this the trenches stay
 *  out of the rng stream so common plays don't shift downstream seed rolls. */
export const LINE_GAP_LEAN = 20;
/** Gap at which the line roll FLIPS the outcome (blow-up / stuff) instead of
 *  just nudging yardage. */
export const LINE_GAP_DOMINATE = 40;
// =============================================================================

function applyPctMods(
  base: number,
  mods: QBModifier[] | undefined,
  parent: PlayParent,
): number {
  if (!mods) return base;
  let v = base;
  for (const m of mods) {
    if (m.scope !== parent && m.scope !== 'all_plays') continue;
    if (m.stat === 'off_skill_pct' || m.stat === 'def_skill_pct') {
      v = v * (1 + m.value / 100);
    }
  }
  return Math.max(1, Math.min(100, v));
}

function applyYardsPct(yards: number, mods: QBModifier[] | undefined, parent: PlayParent): number {
  if (!mods || yards === 0) return yards;
  let mult = 1;
  for (const m of mods) {
    if (m.scope !== parent && m.scope !== 'all_plays') continue;
    if (m.stat === 'yards_pct') mult *= 1 + m.value / 100;
  }
  if (mult === 1) return yards;
  // Apply multiplicative scaling, then round outward (preserve direction sign).
  return yards > 0 ? Math.max(1, Math.round(yards * mult)) : Math.min(-1, Math.round(yards * mult));
}

function applyTurnoverMod(
  baseChance: number,
  mods: QBModifier[] | undefined,
  parent: PlayParent,
): number {
  if (!mods) return baseChance;
  let c = baseChance;
  for (const m of mods) {
    if (m.scope !== parent && m.scope !== 'all_plays') continue;
    if (m.stat === 'turnover_chance_pct') c = c * (1 - m.value / 100);
  }
  return Math.max(0, Math.min(1, c));
}

export function resolvePlay(input: ResolveInput): ResolveOutput {
  const rng = mulberry32(input.seed);

  // Audible handling
  const effective_off_play: Play = input.off_audible
    ? flipSubtype(input.off_play)
    : input.off_play;
  const defense_can_audible = !!input.off_audible || !!input.off_fake_audible;
  const effective_def_play: Play =
    input.def_audible && defense_can_audible ? flipSubtype(input.def_play) : input.def_play;

  const parent_match = effective_off_play.parent === effective_def_play.parent;
  const sub_match = effective_off_play.sub === effective_def_play.sub;

  // Skill roll (skip for punt/fg — handled separately or punt-specific logic)
  const parent = effective_off_play.parent;
  let off_skill = input.off_skill;
  let def_skill = input.def_skill;
  if (parent === 'run' || parent === 'pass') {
    off_skill = applyPctMods(off_skill, input.qb_off_modifiers, parent);
    def_skill = applyPctMods(def_skill, input.qb_def_modifiers, parent);
  }

  // Skill roll. When the defense guesses the wrong parent, the offense auto-wins
  // the skill roll — defense is out of position and shouldn't be able to stop the play.
  // The skill values still scale the yardage (via yards_pct below). When parent matches,
  // it's a fair roll: higher skill wins, ties = 0 yards, no turnover.
  let offense_wins = false;
  let defense_wins = false;
  if (parent === 'punt' || parent === 'fg') {
    offense_wins = false;
    defense_wins = false;
  } else if (!parent_match) {
    offense_wins = true;
  } else {
    const off_roll = Math.floor(rng() * (off_skill + 1));
    const def_roll = Math.floor(rng() * (def_skill + 1));
    if (off_roll > def_roll) offense_wins = true;
    else if (def_roll > off_roll) defense_wins = true;
  }

  // === Line roll (D-LINE / O-LINE mechanic) =================================
  // Only consumes rng when the skill gap crosses LINE_GAP_LEAN. Below that the
  // trenches are dormant — common plays stay seed-stable for the downstream
  // tests / replays.
  let line_winner: 'offense' | 'defense' | null = null;
  let line_roll_gap = 0;
  let line_regime: 'lean' | 'dominate' | null = null;
  // Track whether the line DOMINATED and forced a specific outcome — used
  // downstream by the yardage tiers + recap text.
  let line_dominated_offense = false; // offense dominates line → defense suffers
  let line_dominated_defense = false; // defense dominates line → offense suffers

  if (parent === 'run' || parent === 'pass') {
    const off_line_skill = input.off_line_skill ?? 60;
    const def_line_skill = input.def_line_skill ?? 60;
    const skill_gap = Math.abs(off_line_skill - def_line_skill);
    if (skill_gap >= LINE_GAP_LEAN) {
      const off_line_roll = Math.floor(rng() * (off_line_skill + 1));
      const def_line_roll = Math.floor(rng() * (def_line_skill + 1));
      // Tie → no effect (gap stays zero, line is dormant this play).
      if (off_line_roll !== def_line_roll) {
        const offense_line_won = off_line_roll > def_line_roll;
        line_winner = offense_line_won ? 'offense' : 'defense';
        line_roll_gap = Math.abs(off_line_roll - def_line_roll);
        line_regime = skill_gap >= LINE_GAP_DOMINATE ? 'dominate' : 'lean';
        line_dominated_offense = offense_line_won && line_regime === 'dominate';
        line_dominated_defense = !offense_line_won && line_regime === 'dominate';
      }
    }
  }
  // ===========================================================================

  // Apply DOMINATE flips to offense_wins / defense_wins BEFORE yardage tiers.
  // A dominate-offense line turns the play into "offense wins" regardless of
  // the parent-match / skill-roll outcome — the line opened a hole. A
  // dominate-defense line forces the play into "defense wins" — stuff behind
  // the LOS. LEAN doesn't flip winners; it just nudges yardage downstream.
  if (line_dominated_offense) {
    offense_wins = true;
    defense_wins = false;
  } else if (line_dominated_defense) {
    offense_wins = false;
    defense_wins = true;
  }

  // Turnover chance. When the defense DOMINATES the line (stuff behind the LOS
  // + fumble risk), we bump turnover odds even when the skill read wasn't
  // perfect — a blown-up run often ends with the ball on the ground.
  let turnover_chance = 0;
  if (parent_match && sub_match) turnover_chance = 0.25;
  else if (parent_match) turnover_chance = 0.05;
  if (line_dominated_defense && !line_dominated_offense) {
    // Stuff play → +15% fumble chance on top of base.
    turnover_chance = Math.min(1, turnover_chance + 0.15);
  }
  turnover_chance = applyTurnoverMod(turnover_chance, input.qb_off_modifiers, parent);

  const turnover = rng() < turnover_chance;

  // Yardage
  let yards = 0;
  if (!turnover) {
    if (parent === 'punt' || parent === 'fg') {
      // punt/fg yardage handled by caller (special-case per D11)
      yards = 0;
    } else if (offense_wins) {
      // === Offense wins the skill roll (or line flipped it for offense) ===
      // Full mismatch → big yards (defense out of position)
      // Parent-match sub-mismatch → smaller yards (defense had the right idea, wrong detail)
      // Match → normal fair yards
      // Line DOMINATED for the OFFENSE → blow-up tier (5..15), always — the
      // line opened a hole regardless of how well the defense read the play.
      let minGain: number, maxGain: number;
      if (line_dominated_offense) {
        minGain = 5;
        maxGain = 15;
      } else if (!parent_match) {
        minGain = 5;
        maxGain = 25;
      } else if (!sub_match) {
        // Defense correctly identified run/pass but wrong direction/depth — limited gain
        minGain = 1;
        maxGain = 8;
      } else {
        // Perfect read by defense — small gain
        minGain = 1;
        maxGain = 10;
      }
      // LEAN regime → small yardage nudge (+3) when offense owns the line.
      if (line_regime === 'lean' && line_winner === 'offense') {
        maxGain += 3;
      }
      yards = minGain + Math.floor(rng() * (maxGain - minGain + 1));
    } else if (defense_wins) {
      // === Defense wins the skill roll (or line flipped it for defense) ===
      // Defense stops the play. On full mismatch this shouldn't happen, but if it does
      // (e.g. QB mod flipped the skill), still cap the loss.
      // Parent-match sub-mismatch: defense stops hard (-1..-4)
      // Full mismatch: minimal loss (-1..-2)
      // Line DOMINATED for the DEFENSE → blown-up play: bigger loss, no skill-roll escape hatch.
      let maxLoss: number;
      if (line_dominated_defense) {
        maxLoss = 6; // blown up at the LOS
      } else {
        maxLoss = parent_match ? 4 : 2;
      }
      yards = -(1 + Math.floor(rng() * maxLoss));
      // LEAN regime → small yardage nudge (-2) when defense owns the line.
      if (line_regime === 'lean' && line_winner === 'defense' && !line_dominated_defense) {
        yards -= 2;
      }
    }
    yards = applyYardsPct(yards, input.qb_off_modifiers, parent);
    // Cap yards at the remaining distance to the OFFENSE'S goal line so a play
    // can't produce an impossible gain (e.g., +20 from the 75-yard line when
    // attacking toward 100 → 25yds remaining; same for -1 direction at the 25
    // → only 25yds to attack the OPPOSITE end zone). The excess should have
    // been a TD; we trim down to a 1st & goal at the 1.
    if (yards > 0 && typeof input.yardline_before === 'number') {
      const dir = input.offense_direction ?? 1;
      const maxGain = dir === 1 ? 100 - input.yardline_before : input.yardline_before;
      if (yards > maxGain) yards = Math.max(1, maxGain);
    } else if (yards < 0 && typeof input.yardline_before === 'number') {
      // Cap losses at the distance to the OFFENSE'S OWN goal line.
      // +1 offense at yardline 25 → can lose at most 25yds (own end zone = safety).
      // -1 offense at yardline 75 → can lose at most 25yds (own end zone = safety).
      const dir = input.offense_direction ?? 1;
      const ownGoalYardline = dir === 1 ? 0 : 100;
      const maxLoss = Math.abs(input.yardline_before - ownGoalYardline);
      if (-yards > maxLoss) yards = -Math.max(1, maxLoss);
    }
  } else if (line_dominated_offense) {
    // Turnover rolled AND offense owned the line — turnover text already
    // covers it; nothing more to do here.
  }

  return {
    effective_off_play,
    effective_def_play,
    parent_match,
    sub_match,
    off_roll: 0,
    def_roll: 0,
    line_winner,
    line_roll_gap,
    line_regime,
    turnover,
    turnover_chance,
    yards,
    seed: input.seed,
  };
}