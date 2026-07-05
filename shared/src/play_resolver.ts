// Play resolver — skill roll + turnover check + yardage.
// Skill roll: each side rolls [0, skill]. Higher wins. Ties = 0 yards, no turnover.
import { mulberry32 } from './rng.js';
import type { Play, PlayParent, QBModifier } from './types.js';
import { flipSubtype } from './types.js';

export interface ResolveInput {
  off_skill: number;
  def_skill: number;
  off_play: Play;
  def_play: Play;
  off_audible?: Play | null;
  def_audible?: Play | null;
  off_fake_audible?: boolean;
  qb_off_modifiers?: QBModifier[];
  qb_def_modifiers?: QBModifier[];
  seed: number;
}

export interface ResolveOutput {
  effective_off_play: Play;
  effective_def_play: Play;
  parent_match: boolean;
  sub_match: boolean;
  off_roll: number;
  def_roll: number;
  turnover: boolean;
  turnover_chance: number;
  yards: number;
  seed: number;
}

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

  const off_roll = parent === 'punt' || parent === 'fg' ? 0 : Math.floor(rng() * (off_skill + 1));
  const def_roll = parent === 'punt' || parent === 'fg' ? 0 : Math.floor(rng() * (def_skill + 1));

  // Turnover chance
  let turnover_chance = 0;
  if (parent_match && sub_match) turnover_chance = 0.25;
  else if (parent_match) turnover_chance = 0.05;
  turnover_chance = applyTurnoverMod(turnover_chance, input.qb_off_modifiers, parent);

  const turnover = rng() < turnover_chance;

  // Yardage
  let yards = 0;
  if (!turnover) {
    if (parent === 'punt' || parent === 'fg') {
      // punt/fg yardage handled by caller (special-case per D11)
      yards = 0;
    } else if (off_roll > def_roll) {
      yards = 1 + Math.floor(rng() * 15); // 1..15
    } else if (def_roll > off_roll) {
      yards = -(1 + Math.floor(rng() * 4)); // -1..-4
    }
    yards = applyYardsPct(yards, input.qb_off_modifiers, parent);
  }

  return {
    effective_off_play,
    effective_def_play,
    parent_match,
    sub_match,
    off_roll,
    def_roll,
    turnover,
    turnover_chance,
    yards,
    seed: input.seed,
  };
}