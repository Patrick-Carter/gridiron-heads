import { ACTIVE_SKILL_BY_ID, activeSkillForTeamGroup } from '@gridiron/shared';
import type {
  ActiveSkillId,
  GamePhase,
  Play,
  PositionGroup,
  TeamState,
} from '@gridiron/shared';
import { ActiveSkillChain, ActiveSkillDetails } from './ActiveSkillCard.js';
import type { ActiveCardChain } from './ActiveSkillCard.js';

const GROUP_LABELS: Record<PositionGroup, string> = {
  QB: 'QB',
  D_LINE: 'D-LINE',
  O_LINE: 'O-LINE',
  OFF_SKILL: 'OFF SKILL',
  DEF_SKILL: 'DEF SKILL',
  KICKER: 'KICKER',
};

function SkillChoice<G extends PositionGroup>({
  group,
  skillId,
  onChoose,
}: {
  group: G;
  skillId: ActiveSkillId;
  onChoose: (group: G) => void;
}) {
  return (
    <button
      type="button"
      className="block w-full text-left hover:-translate-y-0.5 transition-transform"
      onClick={() => onChoose(group)}
      aria-label={`Play ${GROUP_LABELS[group]} active skill`}
    >
      <div className="text-[10px] font-black text-cream mb-0.5">{GROUP_LABELS[group]}</div>
      <ActiveSkillDetails skillId={skillId} status="ready" compact />
    </button>
  );
}

export default function ActiveSkillControls({
  phase,
  isOffense,
  team,
  used,
  currentPlay,
  chain,
  onOffenseSkill,
  onOffensePass,
  onDefenseSkill,
  onDefensePass,
}: {
  phase: GamePhase;
  isOffense: boolean;
  team: TeamState;
  used: ActiveSkillId[];
  currentPlay: Play | null | undefined;
  chain: ActiveCardChain | null;
  onOffenseSkill: (group: PositionGroup) => void;
  onOffensePass: () => void;
  onDefenseSkill: (group: 'D_LINE' | 'DEF_SKILL') => void;
  onDefensePass: () => void;
}) {
  if (phase === 'ready_to_snap' && isOffense) {
    const groups: PositionGroup[] = currentPlay?.parent === 'punt' || currentPlay?.parent === 'fg'
      ? ['KICKER']
      : ['QB', 'O_LINE', 'OFF_SKILL'];
    const choices = groups.flatMap((group) => {
      const skillId = activeSkillForTeamGroup(team, group);
      return skillId && !used.includes(skillId) ? [{ group, skillId }] : [];
    });
    return (
      <div className="panel-flash !bg-board space-y-2" data-testid="offense-active-skills">
        <div className="panel-titlebar !mt-0"><span>Offense Priority</span><span className="text-xs">Play 1 or pass</span></div>
        {choices.length > 0 && (
          <div className={`grid gap-2 ${choices.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
            {choices.map(({ group, skillId }) => (
              <SkillChoice key={group} group={group} skillId={skillId} onChoose={onOffenseSkill} />
            ))}
          </div>
        )}
        <button type="button" className="btn-flash btn-ghost w-full" onClick={onOffensePass}>
          Pass Priority to Defense
        </button>
        <div className="text-[10px] text-cream/70 text-center">
          Use any audible before passing priority. Defense acts next either way.
        </div>
      </div>
    );
  }

  if (phase === 'awaiting_card_response' && chain) {
    if (isOffense) {
      return (
        <div className="space-y-2">
          <ActiveSkillChain chain={chain} complete={false} />
          <div className="panel-flash text-center font-black animate-pulse">Waiting for defensive counter…</div>
        </div>
      );
    }

    const groups = ['D_LINE', 'DEF_SKILL'] as const;
    const choices = groups.flatMap((group) => {
      const skillId = activeSkillForTeamGroup(team, group);
      return skillId && !used.includes(skillId) ? [{ group, skillId }] : [];
    });
    return (
      <div className="space-y-2" data-testid="defense-active-skills">
        <ActiveSkillChain chain={chain} complete={false} />
        <div className="panel-flash !bg-board space-y-2">
          <div className="panel-titlebar !mt-0"><span>Counter?</span><span className="text-xs">Defense</span></div>
          <div className="grid gap-2 sm:grid-cols-2">
            {choices.map(({ group, skillId }) => (
              <SkillChoice
                key={group}
                group={group}
                skillId={skillId}
                onChoose={onDefenseSkill}
              />
            ))}
          </div>
          <button type="button" className="btn-flash w-full" onClick={onDefensePass}>
            Pass · Keep Cards
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'card_chain_complete' && chain) {
    return (
      <ActiveSkillChain
        chain={chain}
        complete
        solo={!!chain.offense && ACTIVE_SKILL_BY_ID[chain.offense].role === 'special'}
      />
    );
  }

  return null;
}
