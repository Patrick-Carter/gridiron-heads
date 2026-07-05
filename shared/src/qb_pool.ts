// QB pool — 22 buffs (per D26, never negative). Pool-of-22, draw-3 keeps games fresh.
import type { QBOption, QBModifier, QBScope } from './types.js';

interface QBDef {
  name: string;
  modifier: QBModifier;
}

export const QB_POOL: readonly QBDef[] = [
  { name: 'Ace Armstrong',    modifier: { stat: 'off_skill_pct',       value: 10, scope: 'pass' } },
  { name: 'Brick Bartowski',  modifier: { stat: 'turnover_chance_pct', value: 50, scope: 'all_plays' } },
  { name: 'Clutch Cassidy',   modifier: { stat: 'off_skill_pct',       value: 20, scope: '4th_down' } },
  { name: 'Diamond Dan',      modifier: { stat: 'kicker_power_pct',    value: 15, scope: 'fg' } },
  { name: 'Edge Edwards',     modifier: { stat: 'def_skill_pct',       value: 15, scope: 'all_plays' } },
  { name: 'Frosty Fletcher',  modifier: { stat: 'yards_pct',           value: 20, scope: 'run' } },
  { name: 'Gunner Gonzalez',  modifier: { stat: 'yards_pct',           value: 25, scope: 'pass' } },
  { name: 'Hawk Henderson',   modifier: { stat: 'turnover_chance_pct', value: 25, scope: 'pass' } },
  { name: 'Iron Ike',         modifier: { stat: 'off_skill_pct',       value: 10, scope: 'all_plays' } },
  { name: 'Jolt Jackson',     modifier: { stat: 'def_skill_pct',       value: 20, scope: 'pass' } },
  { name: 'King Karl',        modifier: { stat: 'fake_audible_refresh', value: 1, scope: 'all_plays' } },
  { name: 'Lucky Lou',        modifier: { stat: 'kicker_power_pct',    value: 10, scope: 'fg' } },
  { name: 'Midas Murphy',     modifier: { stat: 'yards_pct',           value: 15, scope: 'all_plays' } },
  { name: 'Nova Nakamura',    modifier: { stat: 'off_skill_pct',       value: 15, scope: 'run' } },
  { name: 'Onyx Owens',       modifier: { stat: 'def_skill_pct',       value: 10, scope: 'run' } },
  { name: 'Pivot Parker',     modifier: { stat: 'real_audible_refresh', value: 1, scope: 'all_plays' } },
  { name: 'Quake Quinn',      modifier: { stat: 'turnover_chance_pct', value: 30, scope: 'all_plays' } },
  { name: 'Rex Riverside',    modifier: { stat: 'off_skill_pct',       value: 25, scope: '4th_down' } },
  { name: 'Steel Stevens',    modifier: { stat: 'def_skill_pct',       value: 25, scope: '4th_down' } },
  { name: 'Titan Torres',     modifier: { stat: 'yards_pct',           value: 10, scope: 'all_plays' } },
  { name: 'Ultra Underwood',  modifier: { stat: 'off_skill_pct',       value: 20, scope: 'pass' } },
  { name: 'Volt Vasquez',     modifier: { stat: 'kicker_power_pct',    value: 20, scope: 'fg' } },
];

// Invariant: every QB has value > 0 (D26). Throws at module load if violated.
for (let i = 0; i < QB_POOL.length; i++) {
  if (QB_POOL[i].modifier.value <= 0) {
    throw new Error(
      `QB_POOL invariant violated at index ${i} (${QB_POOL[i].name}): buff-only rule`,
    );
  }
}

export function drawQBs(rng: () => number, n = 3): QBOption[] {
  const pool = [...QB_POOL];
  const drawn: QBOption[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    const def = pool.splice(idx, 1)[0];
    drawn.push({
      id: `QB_${def.name.replace(/\s+/g, '_')}`,
      group: 'QB',
      name: def.name,
      modifier: def.modifier,
    });
  }
  return drawn;
}

/** Human-readable modifier text for the draft UI. */
export function modifierDescription(m: QBModifier): string {
  const scope = scopeLabel(m.scope);
  const val = m.value;
  switch (m.stat) {
    case 'off_skill_pct':
      return `+${val}% offense skill on ${scope} plays`;
    case 'def_skill_pct':
      return `+${val}% defense skill on ${scope} plays`;
    case 'turnover_chance_pct':
      return `−${val}% turnover chance on ${scope} plays`;
    case 'kicker_power_pct':
      return `+${val}% kicker power on ${scope}`;
    case 'yards_pct':
      return `+${val}% yards on ${scope} plays`;
    case 'fake_audible_refresh':
      return `+${val} fake audible per game`;
    case 'real_audible_refresh':
      return `+${val} real audible per game`;
  }
}

function scopeLabel(s: QBScope): string {
  if (s === 'all_plays') return 'all';
  if (s === '4th_down') return '4th down';
  return s;
}