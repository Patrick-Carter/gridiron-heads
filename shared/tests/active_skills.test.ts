import { describe, expect, it } from 'vitest';
import {
  ACTIVE_SKILL_BY_ID,
  PICK_ORDER,
  activeSkillsForGroup,
  attemptFieldGoal,
  generateDraft,
  mulberry32,
  resolvePlay,
} from '../src/index.js';
import type { ResolveInput } from '../src/play_resolver.js';

const basePlay: ResolveInput = {
  off_skill: 80,
  def_skill: 70,
  off_line_skill: 0,
  def_line_skill: 0,
  off_play: { parent: 'run', sub: 'inside' },
  def_play: { parent: 'pass', sub: 'deep' },
  distance: 10,
  yardline_before: 50,
  offense_direction: 1,
  seed: 1,
};

function resolve(overrides: Partial<ResolveInput> = {}) {
  return resolvePlay({ ...basePlay, ...overrides });
}

describe('active skills in generated drafts', () => {
  it('defines exactly six unique cards for every position group', () => {
    const allIds = PICK_ORDER.flatMap((group) => {
      const groupSkills = activeSkillsForGroup(group);
      expect(groupSkills).toHaveLength(6);
      expect(groupSkills.every((skill) => skill.group === group)).toBe(true);
      return groupSkills.map((skill) => skill.id);
    });
    expect(allIds).toHaveLength(36);
    expect(new Set(allIds).size).toBe(36);
  });

  it('assigns every visible option a valid card from its own group', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const pool = generateDraft(mulberry32(seed));
      for (const group of PICK_ORDER) {
        for (const option of pool[group]) {
          const skill = option.active_skill;
          expect(skill, `${group} option ${option.id}`).toBeDefined();
          if (!skill) throw new Error(`missing active skill for ${option.id}`);
          expect(ACTIVE_SKILL_BY_ID[skill]).toBeDefined();
          expect(ACTIVE_SKILL_BY_ID[skill].group).toBe(group);
          expect(activeSkillsForGroup(group).map((entry) => entry.id)).toContain(skill);
        }
      }
    }
  });

  it('never shows the same active card twice within a visible group', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const pool = generateDraft(mulberry32(seed));
      for (const group of PICK_ORDER) {
        const cards = pool[group].map((option) => option.active_skill);
        expect(new Set(cards).size, `${group}, seed ${seed}`).toBe(cards.length);
      }
    }
  });
});

describe('resolvePlay active-skill effects', () => {
  it('uses advantage for offense and line rolls', () => {
    const skillRng = mulberry32(17);
    const expectedOffAdvantage = Math.max(
      Math.floor(skillRng() * 81),
      Math.floor(skillRng() * 81),
    );
    const expectedDefRoll = Math.floor(skillRng() * 71);
    const fieldGeneral = resolve({ seed: 17, off_active_skill: 'field_general' });
    expect(fieldGeneral.off_roll).toBe(expectedOffAdvantage);
    expect(fieldGeneral.def_roll).toBe(expectedDefRoll);

    const lineRng = mulberry32(31);
    lineRng();
    lineRng();
    const expectedLineAdvantage = Math.max(
      Math.floor(lineRng() * 91),
      Math.floor(lineRng() * 91),
    );
    const pancake = resolve({
      seed: 31,
      off_line_skill: 90,
      def_line_skill: 0,
      off_active_skill: 'pancake_block',
    });
    expect(pancake.off_line_roll).toBe(expectedLineAdvantage);
  });

  it('applies turnover modifiers and offense protection last', () => {
    const input: Partial<ResolveInput> = {
      off_play: { parent: 'pass', sub: 'deep' },
      def_play: { parent: 'pass', sub: 'deep' },
      off_line_skill: 0,
      def_line_skill: 0,
      seed: 7,
    };
    const baseline = resolve(input);
    const ballHawk = resolve({ ...input, def_active_skill: 'ball_hawk' });
    const gunslinger = resolve({ ...input, off_active_skill: 'gunslinger' });
    const protectedFootball = resolve({
      ...input,
      off_active_skill: 'protect_football',
      def_active_skill: 'ball_hawk',
    });
    const sureHands = resolve({
      ...input,
      off_active_skill: 'sure_hands',
      def_active_skill: 'ball_hawk',
    });

    expect(ballHawk.turnover_chance).toBeCloseTo(baseline.turnover_chance + 0.25);
    expect(gunslinger.turnover_chance).toBeCloseTo(baseline.turnover_chance + 0.10);
    expect(protectedFootball.turnover_chance).toBe(0);
    expect(protectedFootball.turnover).toBe(false);
    expect(sureHands.turnover_chance).toBe(0);
    expect(sureHands.turnover).toBe(false);
  });

  it.each([
    ['breakaway_speed', 'run', 15],
    ['road_graders', 'run', 10],
    ['gunslinger', 'pass', 15],
  ] as const)('%s guarantees its minimum gain', (skill, parent, minimum) => {
    let verified = false;
    for (let seed = 1; seed <= 500 && !verified; seed++) {
      const sub = parent === 'run' ? 'inside' : 'deep';
      const baseline = resolve({ seed, off_play: { parent, sub }, off_active_skill: null });
      const boosted = resolve({ seed, off_play: { parent, sub }, off_active_skill: skill });
      if (!baseline.turnover && !boosted.turnover && baseline.yards < minimum) {
        expect(boosted.yards).toBe(minimum);
        verified = true;
      }
    }
    expect(verified).toBe(true);
  });

  it('applies the defensive gain cap before an offensive gain bonus', () => {
    let verified = false;
    for (let seed = 1; seed <= 500 && !verified; seed++) {
      const baseline = resolve({ seed });
      if (!baseline.turnover && baseline.yards > 8) {
        const result = resolve({
          seed,
          off_active_skill: 'breakaway_speed',
          def_active_skill: 'sure_tackling',
        });
        expect(result.yards).toBe(15);
        verified = true;
      }
    }
    expect(verified).toBe(true);
  });

  it('uses distance for Chain Mover and lets Matchup Nightmare win the skill matchup', () => {
    let chainMoverVerified = false;
    for (let seed = 1; seed <= 1_000 && !chainMoverVerified; seed++) {
      const baseline = resolve({ seed, distance: 10 });
      if (!baseline.turnover && baseline.yards >= 8 && baseline.yards < 10) {
        expect(resolve({ seed, distance: 10, off_active_skill: 'chain_mover' }).yards).toBe(10);
        chainMoverVerified = true;
      }
    }
    expect(chainMoverVerified).toBe(true);

    let matchupVerified = false;
    for (let seed = 1; seed <= 500 && !matchupVerified; seed++) {
      const input: Partial<ResolveInput> = {
        seed,
        off_skill: 1,
        def_skill: 100,
        off_play: { parent: 'run', sub: 'inside' },
        def_play: { parent: 'run', sub: 'outside' },
      };
      const baseline = resolve(input);
      const activated = resolve({ ...input, off_active_skill: 'matchup_nightmare' });
      if (!baseline.turnover && !activated.turnover && baseline.yards < 0) {
        expect(activated.yards).toBeGreaterThan(0);
        matchupVerified = true;
      }
    }
    expect(matchupVerified).toBe(true);
  });

  it('lets offense degrade correct calls and defense force situational correct calls', () => {
    const exact = {
      off_play: { parent: 'pass' as const, sub: 'deep' as const },
      def_play: { parent: 'pass' as const, sub: 'deep' as const },
    };
    const decoded = resolve({ ...exact, off_active_skill: 'coverage_decoder' });
    expect(decoded.parent_match).toBe(true);
    expect(decoded.sub_match).toBe(false);

    const misdirected = resolve({ ...exact, off_active_skill: 'misdirection' });
    expect(misdirected.parent_match).toBe(false);

    const forced = resolve({
      seed: 9,
      off_play: { parent: 'run', sub: 'inside' },
      def_play: { parent: 'pass', sub: 'deep' },
      def_active_skill: 'crash_a_gap',
    });
    expect(forced.effective_def_play).toEqual({ parent: 'run', sub: 'inside' });
    if (!forced.turnover) expect(forced.yards).toBe(-4);
  });

  it('lets defensive cards force sacks and run losses', () => {
    const sack = resolve({
      seed: 4,
      off_play: { parent: 'pass', sub: 'deep' },
      def_play: { parent: 'run', sub: 'inside' },
      off_active_skill: 'protect_football',
      def_active_skill: 'collapse_pocket',
    });
    expect(sack.turnover).toBe(false);
    expect(sack.yards).toBe(-5);

    const runLoss = resolve({
      seed: 6,
      off_play: { parent: 'run', sub: 'outside' },
      def_play: { parent: 'pass', sub: 'short' },
      off_active_skill: 'protect_football',
      def_active_skill: 'run_fits',
    });
    expect(runLoss.effective_def_play).toEqual({ parent: 'run', sub: 'outside' });
    expect(runLoss.turnover).toBe(false);
    expect(runLoss.yards).toBe(-2);
  });

  it('turns eligible negative plays into zero yards', () => {
    let verified = false;
    for (let seed = 1; seed <= 500 && !verified; seed++) {
      const input: Partial<ResolveInput> = {
        seed,
        off_skill: 1,
        def_skill: 100,
        off_play: { parent: 'pass', sub: 'deep' },
        def_play: { parent: 'pass', sub: 'short' },
      };
      const baseline = resolve(input);
      if (!baseline.turnover && baseline.yards < 0) {
        expect(resolve({ ...input, off_active_skill: 'escape_artist' }).yards).toBe(0);
        expect(resolve({ ...input, off_active_skill: 'clean_pocket' }).yards).toBe(0);
        verified = true;
      }
    }
    expect(verified).toBe(true);
  });
});

describe('attemptFieldGoal active skills', () => {
  it('accepts active_skill and applies Big Leg with the normal power cap', () => {
    expect(attemptFieldGoal({
      yards_to_endzone: 50,
      kicker_power: 60,
      seed: 1,
      active_skill: 'big_leg',
    }).power_used).toBe(80);
    expect(attemptFieldGoal({
      yards_to_endzone: 50,
      kicker_power: 95,
      seed: 1,
      active_skill: 'big_leg',
    }).power_used).toBe(100);
  });

  it('gives Ice Water power advantage and Friendly Upright bonus advantage', () => {
    const powerRng = mulberry32(19);
    const expectedPower = Math.max(
      Math.floor(powerRng() * 71),
      Math.floor(powerRng() * 71),
    );
    const expectedBonusAfterPower = Math.floor(powerRng() * 21);
    const iceWater = attemptFieldGoal({
      yards_to_endzone: 40,
      kicker_power: 70,
      seed: 19,
      active_skill: 'ice_water',
    });
    expect(iceWater.power_roll).toBe(expectedPower);
    expect(iceWater.bonus_roll).toBe(expectedBonusAfterPower);

    const bonusRng = mulberry32(29);
    const expectedRegularPower = Math.floor(bonusRng() * 71);
    const expectedBonus = Math.max(
      Math.floor(bonusRng() * 21),
      Math.floor(bonusRng() * 21),
    );
    const friendlyUpright = attemptFieldGoal({
      yards_to_endzone: 40,
      kicker_power: 70,
      seed: 29,
      active_skill: 'friendly_upright',
    });
    expect(friendlyUpright.power_roll).toBe(expectedRegularPower);
    expect(friendlyUpright.bonus_roll).toBe(expectedBonus);
    expect(friendlyUpright.make).toBe(friendlyUpright.total >= 40);
  });
});
