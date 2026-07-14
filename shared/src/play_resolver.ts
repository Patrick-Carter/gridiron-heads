// Play resolver — skill roll + line roll + turnover check + yardage.
// Skill roll: each side rolls [0, skill]. Higher wins. Ties = 0 yards, no turnover.
// Line roll (D-LINE / O-LINE): when the skill gap crosses LINE_GAP_LEAN, the
// trenches decide the play — a LEAN gap nudges yardage, a DOMINATE gap flips
// the outcome outright (blow-up or stuff). Below the threshold the line is
// ignored (no rng calls — common plays stay seed-stable).
import { mulberry32 } from './rng.js';
import type { ActiveSkillId, Play, PlayParent, QBModifier } from './types.js';
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
  /** Current down. Optional so existing callers retain their prior behavior;
   *  required for `4th_down` QB modifiers to activate. */
  down?: 1 | 2 | 3 | 4;
  distance?: number;
  off_active_skill?: ActiveSkillId | null;
  def_active_skill?: ActiveSkillId | null;
}

export interface ResolveOutput {
  effective_off_play: Play;
  effective_def_play: Play;
  parent_match: boolean;
  sub_match: boolean;
  /** Skill roll [0, off_skill_eff]. 0 when punt/fg or parent mismatch (offense auto-wins, no roll). */
  off_roll: number;
  /** Skill roll [0, def_skill_eff]. 0 when punt/fg or parent mismatch. */
  def_roll: number;
  /** Effective off_skill after QB modifiers (the bound for off_roll). 0 when punt/fg. */
  off_skill_eff: number;
  /** Effective def_skill after QB modifiers (the bound for def_roll). 0 when punt/fg. */
  def_skill_eff: number;
  /** O-LINE roll [0, off_line_skill]. 0 when punt/fg or gap was 0 (ties = skipped line roll). */
  off_line_roll: number;
  /** D-LINE roll [0, def_line_skill]. 0 when punt/fg or gap was 0. */
  def_line_roll: number;
  /** O_LINE skill used (input value or default 60). 0 when punt/fg. */
  off_line_skill: number;
  /** D_LINE skill used (input value or default 60). 0 when punt/fg. */
  def_line_skill: number;
  /** Which side the line roll picked as winner, if the line roll fired.
   *  null when the gap was below LINE_ROLL_GAP_LEAN (line roll skipped entirely). */
  line_winner: 'offense' | 'defense' | null;
  /** Magnitude of the line roll gap (winner_roll - loser_roll). 0 when skipped. */
  line_roll_gap: number;
  /** "lean" (gap 5..14, yardage nudged) | "dominate" (gap >=15, outcome flipped) | null. */
  line_regime: 'lean' | 'dominate' | null;
  turnover: boolean;
  turnover_chance: number;
  yards: number;
  seed: number;
}

// === Line roll (D-LINE / O-LINE mechanic) ==============================
// The line rolls every play on run/pass (same pattern as OFF_SKILL /
// DEF_SKILL / KICKER). The PER-PLAY ROLL GAP decides the regime — not the
// draft-time skill gap. A bad-draft line can still catch a break per play
// (roll high while the good-draft line rolls low); a great-draft line can
// still lose a play. The trenches are per-play, not per-game.
export const LINE_ROLL_GAP_LEAN = 5;     // roll gap for "lean" (yardage nudge)
export const LINE_ROLL_GAP_DOMINATE = 15; // roll gap for "dominate" (flip outcome)
// ======================================================================

function modifierApplies(m: QBModifier, parent: PlayParent, down: ResolveInput['down']): boolean {
  return m.scope === 'all_plays' || m.scope === parent || (m.scope === '4th_down' && down === 4);
}

function applySkillPct(
  base: number,
  mods: QBModifier[] | undefined,
  parent: PlayParent,
  down: ResolveInput['down'],
  stat: 'off_skill_pct' | 'def_skill_pct',
): number {
  if (!mods) return base;
  let v = base;
  for (const m of mods) {
    if (modifierApplies(m, parent, down) && m.stat === stat) {
      v = v * (1 + m.value / 100);
    }
  }
  return Math.max(1, Math.min(100, v));
}

function applyYardsPct(
  yards: number,
  mods: QBModifier[] | undefined,
  parent: PlayParent,
  down: ResolveInput['down'],
): number {
  // yards_pct is a buff: it improves gains but never magnifies a loss.
  if (!mods || yards <= 0) return yards;
  let mult = 1;
  for (const m of mods) {
    if (!modifierApplies(m, parent, down)) continue;
    if (m.stat === 'yards_pct') mult *= 1 + m.value / 100;
  }
  if (mult === 1) return yards;
  return Math.max(1, Math.round(yards * mult));
}

function applyTurnoverMod(
  baseChance: number,
  mods: QBModifier[] | undefined,
  parent: PlayParent,
  down: ResolveInput['down'],
): number {
  if (!mods) return baseChance;
  let c = baseChance;
  for (const m of mods) {
    if (!modifierApplies(m, parent, down)) continue;
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
  let effective_def_play: Play =
    input.def_audible && defense_can_audible ? flipSubtype(input.def_play) : input.def_play;
  const parent = effective_off_play.parent;
  const offCard = input.off_active_skill ?? null;
  const defCard = input.def_active_skill ?? null;

  // Defensive read cards resolve first and move the defense into the exact
  // call for their situation. Offensive deception cards can then degrade that
  // read unless the defense used a card that suppressed them in the chain.
  if ((defCard === 'crash_a_gap' && parent === 'run' && effective_off_play.sub === 'inside')
    || (defCard === 'set_edge' && parent === 'run' && effective_off_play.sub === 'outside')
    || (defCard === 'press_coverage' && parent === 'pass' && effective_off_play.sub === 'short')
    || (defCard === 'two_high_shell' && parent === 'pass' && effective_off_play.sub === 'deep')
    || (defCard === 'run_fits' && parent === 'run')) {
    effective_def_play = { ...effective_off_play };
  }
  let parent_match = effective_off_play.parent === effective_def_play.parent;
  let sub_match = effective_off_play.sub === effective_def_play.sub;
  if (offCard === 'coverage_decoder' && parent_match && sub_match) sub_match = false;
  if (offCard === 'misdirection' && parent_match) {
    parent_match = false;
    sub_match = false;
  }

  // Skill roll (skip for punt/fg — handled separately or punt-specific logic)
  let off_skill = input.off_skill;
  let def_skill = input.def_skill;
  if (parent === 'run' || parent === 'pass') {
    off_skill = applySkillPct(off_skill, input.qb_off_modifiers, parent, input.down, 'off_skill_pct');
    def_skill = applySkillPct(def_skill, input.qb_def_modifiers, parent, input.down, 'def_skill_pct');
  }

  // Skill roll. When the defense guesses the wrong parent, the offense auto-wins
  // the skill roll — defense is out of position and shouldn't be able to stop the play.
  // The skill values still scale the yardage (via yards_pct below). When parent matches,
  // it's a fair roll: higher skill wins, ties = 0 yards, no turnover.
  //
  // Rolls are always fired (even on parent mismatch) so the client HUD can show
  // two real numbers every play. On parent mismatch the rolled values are
  // cosmetic only — the win flag below is forced and yardage is gated by the
  // existing tier system. The verdict line still flags "DEFENSE MISREAD".
  let offense_wins = false;
  let defense_wins = false;
  let off_roll = 0;
  let def_roll = 0;
  if (parent === 'punt' || parent === 'fg') {
    offense_wins = false;
    defense_wins = false;
  } else {
    const offAdvantage = offCard === 'field_general'
      || (offCard === 'route_technician' && parent === 'pass')
      || (offCard === 'cutback_artist' && parent === 'run');
    off_roll = Math.floor(rng() * (off_skill + 1));
    if (offAdvantage) off_roll = Math.max(off_roll, Math.floor(rng() * (off_skill + 1)));
    def_roll = Math.floor(rng() * (def_skill + 1));
    if (!parent_match) {
      offense_wins = true;
    } else {
      if (off_roll > def_roll) offense_wins = true;
      else if (def_roll > off_roll) defense_wins = true;
    }
    if (offCard === 'matchup_nightmare') {
      offense_wins = true;
      defense_wins = false;
    }
  }

  // === Line roll (D-LINE / O-LINE mechanic) =================================
  // Roll every play on run/pass — same pattern as the skill rolls. The
  // PER-PLAY roll gap (not the draft-time skill gap) decides the regime so
  // a bad-draft team isn't permanently locked out. Both sides roll
  // [0, line_skill]; ties and small roll gaps fall through to the existing
  // parent/sub math with no narrative mention.
  let line_winner: 'offense' | 'defense' | null = null;
  let line_roll_gap = 0;
  let line_regime: 'lean' | 'dominate' | null = null;
  let line_dominated_offense = false;
  let line_dominated_defense = false;
  let off_line_roll = 0;
  let def_line_roll = 0;
  let off_line_skill_eff = 0;
  let def_line_skill_eff = 0;

  if (parent === 'run' || parent === 'pass') {
    off_line_skill_eff = input.off_line_skill ?? 60;
    def_line_skill_eff = input.def_line_skill ?? 60;
    off_line_roll = Math.floor(rng() * (off_line_skill_eff + 1));
    if (offCard === 'pancake_block'
      || (offCard === 'pulling_guards' && parent === 'run' && effective_off_play.sub === 'outside')) {
      off_line_roll = Math.max(off_line_roll, Math.floor(rng() * (off_line_skill_eff + 1)));
    }
    def_line_roll = Math.floor(rng() * (def_line_skill_eff + 1));
    if (defCard === 'pin_ears_back') {
      def_line_roll = Math.max(def_line_roll, Math.floor(rng() * (def_line_skill_eff + 1)));
    }
    if (off_line_roll !== def_line_roll) {
      const offense_line_won = off_line_roll > def_line_roll;
      line_winner = offense_line_won ? 'offense' : 'defense';
      line_roll_gap = Math.abs(off_line_roll - def_line_roll);
      if (line_roll_gap >= LINE_ROLL_GAP_DOMINATE) {
        line_regime = 'dominate';
        line_dominated_offense = offense_line_won;
        line_dominated_defense = !offense_line_won;
      } else if (line_roll_gap >= LINE_ROLL_GAP_LEAN) {
        line_regime = 'lean';
      }
      // roll_gap < LINE_ROLL_GAP_LEAN → line_winner/line_roll_gap still set,
      // line_regime stays null. The yardage tiers and recap treat this the
      // same as no line roll — common plays don't get a "lean" nudge.
    }
  }
  if (offCard === 'max_protect' && line_dominated_defense) {
    line_dominated_defense = false;
    line_regime = 'lean';
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
  // An unresolved skill-roll tie is explicitly a dead play with no turnover.
  // A DOMINATE line result is exempt because it has changed the winner.
  const skill_roll_tied = (parent === 'run' || parent === 'pass')
    && parent_match
    && off_roll === def_roll;
  if (skill_roll_tied && !line_dominated_offense && !line_dominated_defense) {
    turnover_chance = 0;
  }
  turnover_chance = applyTurnoverMod(
    turnover_chance,
    input.qb_off_modifiers,
    parent,
    input.down,
  );
  if (defCard === 'strip_rush' && parent_match) turnover_chance += 0.20;
  if (defCard === 'ball_hawk' && parent === 'pass' && parent_match) turnover_chance += 0.25;
  if (offCard === 'gunslinger' && parent === 'pass') turnover_chance += 0.10;
  if (offCard === 'protect_football' || (offCard === 'sure_hands' && parent === 'pass')) {
    turnover_chance = 0;
  }
  turnover_chance = Math.max(0, Math.min(1, turnover_chance));

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
    yards = applyYardsPct(yards, input.qb_off_modifiers, parent, input.down);
    // Quick Counter resolves the defensive response first, then the offense
    // card. That ordering is visible when a cap and a gain bonus collide.
    if (defCard === 'sure_tackling' && yards > 5) yards = 5;
    if (defCard === 'collapse_pocket' && parent === 'pass') yards = -5;
    if (defCard === 'crash_a_gap' && parent === 'run' && effective_off_play.sub === 'inside') yards = -4;
    if (defCard === 'set_edge' && parent === 'run' && effective_off_play.sub === 'outside') yards = -4;
    if (defCard === 'press_coverage' && parent === 'pass' && effective_off_play.sub === 'short') yards = Math.min(0, yards);
    if (defCard === 'two_high_shell' && parent === 'pass' && effective_off_play.sub === 'deep') yards = Math.min(0, yards);
    if (defCard === 'run_fits' && parent === 'run') yards = -2;
    if (defCard === 'pin_ears_back' && parent === 'pass' && line_winner === 'defense') yards = Math.min(-3, yards);

    if (offCard === 'gunslinger' && parent === 'pass') yards = Math.max(15, yards);
    if (offCard === 'road_graders' && parent === 'run') yards = Math.max(10, yards);
    if (offCard === 'pulling_guards' && parent === 'run'
      && effective_off_play.sub === 'outside' && line_winner === 'offense') yards += 5;
    if (offCard === 'breakaway_speed') yards = Math.max(15, yards);
    if (offCard === 'clutch_command' && (input.down === 3 || input.down === 4)
      && input.distance != null) yards = Math.max(input.distance, yards);
    if (offCard === 'chain_mover' && yards > 0 && input.distance != null
      && yards < input.distance && input.distance - yards <= 2) yards = input.distance;
    if ((offCard === 'escape_artist'
      || (offCard === 'clean_pocket' && parent === 'pass')) && yards < 0) yards = 0;
    // Cap yards at the remaining distance to the OFFENSE'S goal line so a play
    // can't produce an impossible gain (e.g., +20 from the 75-yard line when
    // attacking toward 100 → 25yds remaining; same for -1 direction at the 25
    // → only 25yds to attack the OPPOSITE end zone). The excess should have
    // been a TD; we trim down to a 1st & goal at the 1.
    if (yards > 0 && typeof input.yardline_before === 'number') {
      const dir = input.offense_direction ?? 1;
      const maxGain = dir === 1 ? 100 - input.yardline_before : input.yardline_before;
      if (yards > maxGain) yards = maxGain;
    } else if (yards < 0 && typeof input.yardline_before === 'number') {
      // Cap losses at the distance to the OFFENSE'S OWN goal line.
      // +1 offense at yardline 25 → can lose at most 25yds (own end zone = safety).
      // -1 offense at yardline 75 → can lose at most 25yds (own end zone = safety).
      const dir = input.offense_direction ?? 1;
      const ownGoalYardline = dir === 1 ? 0 : 100;
      const maxLoss = Math.abs(input.yardline_before - ownGoalYardline);
      if (-yards > maxLoss) yards = maxLoss === 0 ? 0 : -maxLoss;
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
    off_roll,
    def_roll,
    off_skill_eff: off_skill,
    def_skill_eff: def_skill,
    off_line_roll,
    def_line_roll,
    off_line_skill: off_line_skill_eff,
    def_line_skill: def_line_skill_eff,
    line_winner,
    line_roll_gap,
    line_regime,
    turnover,
    turnover_chance,
    yards,
    seed: input.seed,
  };
}
