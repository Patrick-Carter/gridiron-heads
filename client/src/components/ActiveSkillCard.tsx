import { ACTIVE_SKILL_BY_ID } from '@gridiron/shared';
import type { ActiveSkillId } from '@gridiron/shared';

export type ActiveSkillStatus = 'ready' | 'used' | 'played' | 'suppressed';

const STATUS_LABEL: Record<ActiveSkillStatus, string> = {
  ready: 'READY',
  used: 'USED',
  played: 'PLAYED',
  suppressed: 'SUPPRESSED',
};

const STATUS_CLASS: Record<ActiveSkillStatus, string> = {
  ready: '!bg-lime !text-ink',
  used: '!bg-ink/20 !text-ink/60',
  played: '!bg-sun !text-ink',
  suppressed: '!bg-maroon !text-cream',
};

export function ActiveSkillDetails({
  skillId,
  status,
  compact = false,
}: {
  skillId: ActiveSkillId;
  status?: ActiveSkillStatus;
  compact?: boolean;
}) {
  const skill = ACTIVE_SKILL_BY_ID[skillId];

  return (
    <div
      className={`border-2 border-ink bg-sun/20 text-ink ${compact ? 'p-1.5' : 'p-2'}`}
      data-testid={`active-skill-${skillId}`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-black leading-tight">{skill.name}</span>
        <span className={`chip text-[9px] ${status ? STATUS_CLASS[status] : '!bg-sun !text-ink'}`}>
          {status ? STATUS_LABEL[status] : 'ACTIVE · 1 GAME'}
        </span>
      </div>
      <div className={`${compact ? 'text-[10px]' : 'text-xs'} font-medium leading-snug mt-0.5`}>
        {skill.description}
      </div>
      {status && (
        <div className="text-[9px] font-black text-ink/55 mt-0.5">ACTIVE · 1 GAME</div>
      )}
    </div>
  );
}

export function ActiveSkillChip({
  skillId,
  side,
  suppressed = false,
}: {
  skillId: ActiveSkillId;
  side?: 'OFF' | 'DEF';
  suppressed?: boolean;
}) {
  const skill = ACTIVE_SKILL_BY_ID[skillId];
  return (
    <span
      className={`chip text-[10px] ${suppressed ? '!bg-maroon !text-cream line-through' : side === 'DEF' ? '!bg-grape !text-cream' : '!bg-sun !text-ink'}`}
      title={skill.description}
      data-testid={`active-skill-chip-${skillId}`}
    >
      {side ? `${side}: ` : ''}{skill.name}{suppressed ? ' · SUPPRESSED' : ''}
    </span>
  );
}

export interface ActiveCardChain {
  offense: ActiveSkillId | null;
  defense: ActiveSkillId | null;
  suppressed: ActiveSkillId | null;
}

export function ActiveSkillChain({
  chain,
  complete,
  solo = false,
}: {
  chain: ActiveCardChain;
  complete: boolean;
  solo?: boolean;
}) {
  return (
    <div className="border-2 border-ink bg-cream p-2 text-center" data-testid="active-card-chain">
      <div className="text-[10px] font-black text-ink/60 mb-1">QUICK COUNTER</div>
      <div className="flex items-center justify-center gap-1.5 flex-wrap">
        {chain.offense ? (
          <ActiveSkillChip
            skillId={chain.offense}
            side="OFF"
            suppressed={chain.suppressed === chain.offense}
          />
        ) : (
          <span className="chip !bg-cream !text-ink text-[10px]">OFF: PASS</span>
        )}
        {!solo && (
          <>
            <span className="font-black text-ink/50">vs</span>
            {chain.defense ? (
              <ActiveSkillChip
                skillId={chain.defense}
                side="DEF"
                suppressed={chain.suppressed === chain.defense}
              />
            ) : (
              <span className="chip !bg-cream !text-ink text-[10px]">
                DEF: {complete ? 'PASS' : 'DECIDING…'}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
