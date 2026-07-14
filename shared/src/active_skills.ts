import type {
  ActiveSkillDefinition,
  ActiveSkillId,
  PositionGroup,
  TeamState,
} from './types.js';

const skills = [
  { id: 'field_general', group: 'QB', name: 'Field General', description: 'Your OFF SKILL roll has advantage.', role: 'offense' },
  { id: 'protect_football', group: 'QB', name: 'Protect the Football', description: 'Turnover chance becomes 0 for this play.', role: 'offense' },
  { id: 'escape_artist', group: 'QB', name: 'Escape Artist', description: 'A non-turnover negative play becomes 0 yards.', role: 'offense' },
  { id: 'clutch_command', group: 'QB', name: 'Clutch Command', description: 'On 3rd or 4th down, a non-turnover play reaches the first down.', role: 'offense' },
  { id: 'gunslinger', group: 'QB', name: 'Gunslinger', description: 'A non-turnover pass gains at least 15 yards, but adds 10% turnover chance.', role: 'offense' },
  { id: 'coverage_decoder', group: 'QB', name: 'Coverage Decoder', description: 'A perfect defensive call is treated as a subtype miss.', role: 'offense' },

  { id: 'pancake_block', group: 'O_LINE', name: 'Pancake Block', description: 'Your O-LINE roll has advantage.', role: 'offense' },
  { id: 'max_protect', group: 'O_LINE', name: 'Max Protect', description: 'A defensive line dominate result is reduced to lean.', role: 'offense' },
  { id: 'road_graders', group: 'O_LINE', name: 'Road Graders', description: 'A non-turnover run gains at least 10 yards.', role: 'offense' },
  { id: 'clean_pocket', group: 'O_LINE', name: 'Clean Pocket', description: 'A non-turnover negative pass becomes 0 yards.', role: 'offense' },
  { id: 'pulling_guards', group: 'O_LINE', name: 'Pulling Guards', description: 'O-LINE has advantage on an outside run; a line win adds 5 yards.', role: 'offense' },
  { id: 'misdirection', group: 'O_LINE', name: 'Misdirection', description: 'The defense’s run/pass call is treated as wrong.', role: 'offense' },

  { id: 'route_technician', group: 'OFF_SKILL', name: 'Route Technician', description: 'Your OFF SKILL roll has advantage on a pass.', role: 'offense' },
  { id: 'cutback_artist', group: 'OFF_SKILL', name: 'Cutback Artist', description: 'Your OFF SKILL roll has advantage on a run.', role: 'offense' },
  { id: 'sure_hands', group: 'OFF_SKILL', name: 'Sure Hands', description: 'Turnover chance becomes 0 on a pass.', role: 'offense' },
  { id: 'breakaway_speed', group: 'OFF_SKILL', name: 'Breakaway Speed', description: 'A non-turnover play gains at least 15 yards.', role: 'offense' },
  { id: 'chain_mover', group: 'OFF_SKILL', name: 'Chain Mover', description: 'A positive gain 1 or 2 yards short reaches the first down.', role: 'offense' },
  { id: 'matchup_nightmare', group: 'OFF_SKILL', name: 'Matchup Nightmare', description: 'Automatically win the OFF SKILL matchup unless this card is negated.', role: 'offense' },

  { id: 'pin_ears_back', group: 'D_LINE', name: 'Pin Ears Back', description: 'D-LINE has advantage; a pass lost in the trenches loses at least 3 yards.', role: 'defense' },
  { id: 'crash_a_gap', group: 'D_LINE', name: 'Crash the A-Gap', description: 'Against an inside run, force the exact defensive call and a 4-yard loss.', role: 'defense' },
  { id: 'set_edge', group: 'D_LINE', name: 'Set the Edge', description: 'Against an outside run, force the exact defensive call and a 4-yard loss.', role: 'defense' },
  { id: 'collapse_pocket', group: 'D_LINE', name: 'Collapse the Pocket', description: 'A non-turnover pass becomes a 5-yard sack.', role: 'defense' },
  { id: 'strip_rush', group: 'D_LINE', name: 'Strip Rush', description: 'A correct run/pass read adds 20% turnover chance.', role: 'defense' },
  { id: 'line_stunt', group: 'D_LINE', name: 'Line Stunt', description: 'Suppress an O-LINE card.', role: 'defense' },

  { id: 'sure_tackling', group: 'DEF_SKILL', name: 'Sure Tackling', description: 'Before offense card bonuses, cap a positive gain at 5 yards.', role: 'defense' },
  { id: 'ball_hawk', group: 'DEF_SKILL', name: 'Ball Hawk', description: 'A correct pass read adds 25% turnover chance.', role: 'defense' },
  { id: 'press_coverage', group: 'DEF_SKILL', name: 'Press Coverage', description: 'Against a short pass, force the exact defensive call and no gain.', role: 'defense' },
  { id: 'two_high_shell', group: 'DEF_SKILL', name: 'Two-High Shell', description: 'Against a deep pass, force the exact defensive call and no gain.', role: 'defense' },
  { id: 'run_fits', group: 'DEF_SKILL', name: 'Run Fits', description: 'Against a run, force the exact defensive call and a 2-yard loss.', role: 'defense' },
  { id: 'film_study', group: 'DEF_SKILL', name: 'Film Study', description: 'Suppress a QB or OFF SKILL card.', role: 'defense' },

  { id: 'big_leg', group: 'KICKER', name: 'Big Leg', description: 'Add 20 effective field-goal power, capped at 100.', role: 'special' },
  { id: 'ice_water', group: 'KICKER', name: 'Ice Water', description: 'Field-goal power roll has advantage, including shootouts.', role: 'special' },
  { id: 'perfect_hold', group: 'KICKER', name: 'Perfect Hold', description: 'The field goal cannot be blocked.', role: 'special' },
  { id: 'friendly_upright', group: 'KICKER', name: 'Friendly Upright', description: 'Field-goal bonus has advantage, and a tie is good.', role: 'special' },
  { id: 'coffin_corner', group: 'KICKER', name: 'Coffin Corner', description: 'Add 10 net punt yards, capped at the receiving 5.', role: 'special' },
  { id: 'quick_punt', group: 'KICKER', name: 'Quick Punt', description: 'The punt cannot be blocked.', role: 'special' },
] as const satisfies readonly ActiveSkillDefinition[];

export const ACTIVE_SKILLS: readonly ActiveSkillDefinition[] = skills;

export const ACTIVE_SKILL_BY_ID = Object.fromEntries(
  skills.map((skill) => [skill.id, skill]),
) as Record<ActiveSkillId, ActiveSkillDefinition>;

export function activeSkillsForGroup(group: PositionGroup): ActiveSkillDefinition[] {
  return skills.filter((skill) => skill.group === group);
}

export function activeSkillForTeamGroup(team: TeamState, group: PositionGroup): ActiveSkillId | undefined {
  switch (group) {
    case 'QB': return team.qb?.active_skill;
    case 'D_LINE': return team.d_line?.active_skill;
    case 'O_LINE': return team.o_line?.active_skill;
    case 'OFF_SKILL': return team.off_skill?.active_skill;
    case 'DEF_SKILL': return team.def_skill?.active_skill;
    case 'KICKER': return team.kicker?.active_skill;
  }
}

export function activeSkillGroup(id: ActiveSkillId): PositionGroup {
  return ACTIVE_SKILL_BY_ID[id].group;
}
