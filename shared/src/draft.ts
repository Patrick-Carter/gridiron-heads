// Draft generator — alternating picks, 2 options per skill group, 25% gap cap.
import type {
  PositionGroup,
  PositionOption,
  QBOption,
  TeamState,
} from './types.js';
import { drawQBs } from './qb_pool.js';
import { pickName } from './name_pools.js';

const SKILL_GROUPS: PositionGroup[] = ['D_LINE', 'O_LINE', 'OFF_SKILL', 'DEF_SKILL', 'KICKER'];

/** Skill value in [50, 100]. */
function rollSkill(rng: () => number): number {
  return 50 + Math.floor(rng() * 51); // 50..100 inclusive
}

/** Slug for an option id; spaces→underscores so it stays filesystem/url-safe.
 *  Includes the attempt counter so the same name picked twice in a draft
 *  (rare, since the pool is consumed index-by-index, but possible) gets
 *  distinct ids. */
function nameSlug(name: string, group: PositionGroup, attempt: number): string {
  return `${group}_${name.replace(/\s+/g, '_')}_${attempt}`;
}

/** Generate a pair of skill options within 25% gap. Names come from the
 *  group-specific fun-name pool (D026) — drawn deterministically so the
 *  draft_seed fully determines who shows up. */
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
      // Two distractor rng() calls so the names are tied to the slot, not
      // the skill pair — keeps draft seed reproducible even if the skill
      // pair regenerates across iterations of the outer loop.
      const nameA = pickName(rng, group);
      const nameB = pickName(rng, group);
      return [
        { id: nameSlug(nameA, group, attempt * 2),     group, skill: a, name: nameA },
        { id: nameSlug(nameB, group, attempt * 2 + 1), group, skill: b, name: nameB },
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