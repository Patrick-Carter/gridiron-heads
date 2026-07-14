// Field goal resolver — 2-roll mechanic (D23).
// power_roll: [0, power_used] (scaled by QB modifier, clamped [1,100])
// bonus_roll: [0, 20] — universal, no scaling
// make iff power_roll + bonus_roll > yards_to_endzone
import { mulberry32 } from './rng.js';
import type { ActiveSkillId, QBModifier } from './types.js';

export interface FGAttempt {
  yards_to_endzone: number;
  kicker_power: number; // 50..100
  seed: number;
  qb_modifiers?: QBModifier[];
  active_skill?: ActiveSkillId | null;
}

export interface FGResult {
  make: boolean;
  power_roll: number;
  bonus_roll: number;
  total: number;
  power_used: number;
  seed: number;
}

export function attemptFieldGoal({
  yards_to_endzone,
  kicker_power,
  seed,
  qb_modifiers = [],
  active_skill = null,
}: FGAttempt): FGResult {
  let power = kicker_power;
  for (const m of qb_modifiers) {
    if ((m.scope === 'fg' || m.scope === 'all_plays') && m.stat === 'kicker_power_pct') {
      power = Math.round(power * (1 + m.value / 100));
    }
  }
  if (active_skill === 'big_leg') power += 20;
  power = Math.max(1, Math.min(100, power));

  const rng = mulberry32(seed);
  let power_roll = Math.floor(rng() * (power + 1)); // [0, power]
  if (active_skill === 'ice_water') {
    power_roll = Math.max(power_roll, Math.floor(rng() * (power + 1)));
  }
  let bonus_roll = Math.floor(rng() * 21); // [0, 20]
  if (active_skill === 'friendly_upright') {
    bonus_roll = Math.max(bonus_roll, Math.floor(rng() * 21));
  }
  const total = power_roll + bonus_roll;
  const make = active_skill === 'friendly_upright'
    ? total >= yards_to_endzone
    : total > yards_to_endzone;

  return {
    make,
    power_roll,
    bonus_roll,
    total,
    power_used: power,
    seed,
  };
}
