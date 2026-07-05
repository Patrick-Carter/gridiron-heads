// Draft generator — alternating picks, 2 options per skill group, 25% gap cap.
import type {
  PositionGroup,
  PositionOption,
  QBOption,
  TeamState,
} from './types.js';
import { drawQBs } from './qb_pool.js';

const SKILL_GROUPS: PositionGroup[] = ['D_LINE', 'O_LINE', 'OFF_SKILL', 'DEF_SKILL', 'KICKER'];

/** Skill value in [50, 100]. */
function rollSkill(rng: () => number): number {
  return 50 + Math.floor(rng() * 51); // 50..100 inclusive
}

/** Generate a pair of skill options within 25% gap. */
function pairWithCap(
  rng: () => number,
  group: PositionGroup,
): [PositionOption, PositionOption] {
  for (let attempt = 0; attempt < 100; attempt++) {
    const a = rollSkill(rng);
    const b = rollSkill(rng);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi === 0 || (hi - lo) / hi <= 0.25) {
      const nameA = `${group}_Alpha_${a}`;
      const nameB = `${group}_Bravo_${b}`;
      return [
        { id: `${group}_A_${a}_${attempt}`, group, skill: a, name: nameA },
        { id: `${group}_B_${b}_${attempt}`, group, skill: b, name: nameB },
      ];
    }
  }
  throw new Error(`could not satisfy 25% cap for ${group} after 100 attempts`);
}

export type DraftPool = Record<PositionGroup, (PositionOption | QBOption)[]>;

export function generateDraft(rng: () => number): DraftPool {
  const pool = {} as DraftPool;
  for (const g of SKILL_GROUPS) {
    pool[g] = pairWithCap(rng, g);
  }
  pool.QB = drawQBs(rng, 3);
  return pool;
}

export const PICK_ORDER: PositionGroup[] = [
  'QB',
  'D_LINE',
  'O_LINE',
  'OFF_SKILL',
  'DEF_SKILL',
  'KICKER',
];
export const PICKS_PER_TEAM = PICK_ORDER.length; // 6
export const TOTAL_PICKS = PICKS_PER_TEAM * 2; // 12

/** How many picks have been made across both teams? */
export function totalPicksDone(draft: { picks: Record<string, TeamState> }): number {
  let n = 0;
  for (const team of Object.values(draft.picks)) {
    if (team.qb) n++;
    if (team.d_line) n++;
    if (team.o_line) n++;
    if (team.off_skill) n++;
    if (team.def_skill) n++;
    if (team.kicker) n++;
  }
  return n;
}

/** Remove a picked option from the pool (mutates). */
export function takeFromPool(
  pool: DraftPool,
  group: PositionGroup,
  optionId: string,
): PositionOption | QBOption | null {
  const arr = pool[group];
  const idx = arr.findIndex((o) => o.id === optionId);
  if (idx === -1) return null;
  const [taken] = arr.splice(idx, 1);
  return taken;
}

/** Groups a player has NOT yet picked. */
export function remainingGroups(
  team: TeamState,
): PositionGroup[] {
  const out: PositionGroup[] = [];
  if (!team.qb) out.push('QB');
  if (!team.d_line) out.push('D_LINE');
  if (!team.o_line) out.push('O_LINE');
  if (!team.off_skill) out.push('OFF_SKILL');
  if (!team.def_skill) out.push('DEF_SKILL');
  if (!team.kicker) out.push('KICKER');
  return out;
}