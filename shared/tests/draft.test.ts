import { describe, it, expect } from 'vitest';
import {
  generateDraft,
  PICK_ORDER,
  PICKS_PER_TEAM,
  TOTAL_PICKS,
  SKILL_GROUP_GAP_CAP,
  LINE_GROUP_GAP_CAP,
} from '../src/draft.js';
import { mulberry32 } from '../src/rng.js';

describe('generateDraft', () => {
  it('produces 2 options per skill group + 3 QBs', () => {
    const rng = mulberry32(1);
    const pool = generateDraft(rng);
    expect(pool.D_LINE).toHaveLength(2);
    expect(pool.O_LINE).toHaveLength(2);
    expect(pool.OFF_SKILL).toHaveLength(2);
    expect(pool.DEF_SKILL).toHaveLength(2);
    expect(pool.KICKER).toHaveLength(2);
    expect(pool.QB).toHaveLength(3);
  });

  it('every skill pair satisfies its group\'s gap cap (skill 25%, line 15%)', () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = mulberry32(seed + 1);
      const pool = generateDraft(rng);
      for (const group of ['D_LINE', 'O_LINE', 'OFF_SKILL', 'DEF_SKILL', 'KICKER'] as const) {
        const [a, b] = pool[group] as Array<{ skill: number }>;
        const hi = Math.max(a.skill, b.skill);
        const lo = Math.min(a.skill, b.skill);
        const gap = (hi - lo) / hi;
        const cap = (group === 'D_LINE' || group === 'O_LINE')
          ? LINE_GROUP_GAP_CAP
          : SKILL_GROUP_GAP_CAP;
        expect(gap).toBeLessThanOrEqual(cap + 1e-9);
        expect(a.skill).toBeGreaterThanOrEqual(50);
        expect(b.skill).toBeLessThanOrEqual(100);
      }
    }
  });

  it('LINE groups use a tighter cap (15%) than SKILL groups (25%)', () => {
    // Sanity: the LINE cap should be stricter than the SKILL cap so the
    // head-to-head trench roll doesn't get dominated by a 25% gap.
    expect(LINE_GROUP_GAP_CAP).toBeLessThanOrEqual(SKILL_GROUP_GAP_CAP);
    // 15% is the chosen value — if you change it, update this assertion
    // AND the comment in draft.ts explaining why.
    expect(LINE_GROUP_GAP_CAP).toBe(0.15);
  });

  it('cross-team line gap is bounded: worst case within LINE_GROUP_GAP_CAP', () => {
    // Both players pull O_LINE / D_LINE from the SAME 2-option pool. Worst
    // case = one player takes hi, the other takes lo → gap = (hi - lo) / hi.
    // Because the pool itself is capped at LINE_GROUP_GAP_CAP, the cross-team
    // gap CANNOT exceed LINE_GROUP_GAP_CAP regardless of which player picks
    // which option. Verify across many seeds.
    let maxGap = 0;
    for (let seed = 0; seed < 500; seed++) {
      const rng = mulberry32(seed + 1);
      const pool = generateDraft(rng);
      for (const group of ['D_LINE', 'O_LINE'] as const) {
        const [a, b] = pool[group] as Array<{ skill: number }>;
        const hi = Math.max(a.skill, b.skill);
        const lo = Math.min(a.skill, b.skill);
        const gap = (hi - lo) / hi;
        if (gap > maxGap) maxGap = gap;
      }
    }
    expect(maxGap).toBeLessThanOrEqual(LINE_GROUP_GAP_CAP + 1e-9);
  });

  it('1000 generations → no throws', () => {
    for (let seed = 0; seed < 1000; seed++) {
      const rng = mulberry32(seed + 1);
      expect(() => generateDraft(rng)).not.toThrow();
    }
  });

  it('same seed → same pool (deterministic)', () => {
    const a = generateDraft(mulberry32(42));
    const b = generateDraft(mulberry32(42));
    expect(a.D_LINE[0].skill).toBe(b.D_LINE[0].skill);
    expect(a.QB[0].id).toBe(b.QB[0].id);
  });

  it('option ids are unique within a pool', () => {
    const pool = generateDraft(mulberry32(7));
    const ids: string[] = [];
    for (const group of Object.keys(pool)) {
      for (const opt of pool[group as keyof typeof pool]) {
        ids.push(opt.id);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every option has valid group + skill (skill groups) or modifier (QB)', () => {
    const pool = generateDraft(mulberry32(11));
    for (const group of ['D_LINE', 'O_LINE', 'OFF_SKILL', 'DEF_SKILL', 'KICKER'] as const) {
      for (const opt of pool[group]) {
        expect(opt.group).toBe(group);
        expect(opt.skill).toBeGreaterThanOrEqual(50);
        expect(opt.skill).toBeLessThanOrEqual(100);
      }
    }
    for (const qb of pool.QB) {
      expect(qb.group).toBe('QB');
      expect(qb.modifier.value).toBeGreaterThan(0);
    }
  });

  // D026 — drafted players get fun names (no more "D_LINE_Alpha_77")
  it('skill-group names are fun (no Alpha/Bravo, no trailing numeric)', () => {
    const pool = generateDraft(mulberry32(11));
    for (const group of ['D_LINE', 'O_LINE', 'OFF_SKILL', 'DEF_SKILL', 'KICKER'] as const) {
      for (const opt of pool[group]) {
        expect(opt.name).not.toMatch(/_Alpha_|_Bravo_/);
        expect(opt.name).not.toMatch(/_\d+$/);
        // Each name should be two words (First Last), like the QB pool.
        expect(opt.name.split(/\s+/).length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('draft is reproducible under a fixed seed (D026 migration)', () => {
    // Pre-fix the names would change every time a new rng() consumed
    // before the name pick. Now every name pick deterministically follows
    // the skill-pair roll on the same seed.
    const p1 = generateDraft(mulberry32(123));
    const p2 = generateDraft(mulberry32(123));
    for (const group of ['D_LINE', 'O_LINE', 'OFF_SKILL', 'DEF_SKILL', 'KICKER'] as const) {
      expect(p1[group].map((o) => o.name)).toEqual(p2[group].map((o) => o.name));
    }
    expect(p1.QB.map((o) => o.name)).toEqual(p2.QB.map((o) => o.name));
  });
});

describe('pick order constants', () => {
  it('PICK_ORDER has 6 entries: QB + 5 skill groups', () => {
    expect(PICK_ORDER).toHaveLength(6);
    expect(PICK_ORDER).toContain('QB');
    expect(PICK_ORDER).toContain('KICKER');
  });
  it('PICKS_PER_TEAM = 6, TOTAL_PICKS = 12', () => {
    expect(PICKS_PER_TEAM).toBe(6);
    expect(TOTAL_PICKS).toBe(12);
  });
});