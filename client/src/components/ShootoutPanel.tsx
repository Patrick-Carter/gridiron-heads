import type { ActiveSkillId, ShootoutState } from '@gridiron/shared';
import { ActiveSkillChain, ActiveSkillDetails } from './ActiveSkillCard.js';
import type { ActiveCardChain } from './ActiveSkillCard.js';

const FG_ACTIVE_SKILLS = new Set<ActiveSkillId>([
  'big_leg',
  'ice_water',
  'friendly_upright',
]);

export default function ShootoutPanel({
  shootout,
  players,
  myIdx,
  ready,
  onKick,
  kickerActiveSkill = null,
  kickerActiveSkillUsed = false,
  activeCardChain = null,
  onActiveSkill,
}: {
  shootout: ShootoutState;
  players: { name: string }[];
  myIdx: 0 | 1;
  ready: boolean;
  onKick: () => void;
  kickerActiveSkill?: ActiveSkillId | null;
  kickerActiveSkillUsed?: boolean;
  activeCardChain?: ActiveCardChain | null;
  onActiveSkill?: () => void;
}) {
  const myKick = shootout.next_kicker_idx === myIdx;
  const canPlayKickerCard = ready
    && myKick
    && !!kickerActiveSkill
    && FG_ACTIVE_SKILLS.has(kickerActiveSkill)
    && !kickerActiveSkillUsed
    && !activeCardChain;
  return (
    <div className="panel-flash text-center space-y-3" data-testid="shootout-panel">
      <div className="panel-titlebar !mt-0">
        <span>FG Shootout</span>
        <span className="text-xs">Round {shootout.round}</span>
      </div>
      <div className="text-4xl font-black tabular-nums">
        {shootout.distance} <span className="text-base">YARDS</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        {[0, 1].map((idx) => {
          const attempt = shootout.round_attempts[idx];
          return (
            <div key={idx} className="border-2 border-ink bg-cream p-2">
              <div className="font-black truncate">{players[idx]?.name ?? '?'}</div>
              <div className="text-xl font-black">
                {attempt ? (attempt.made ? 'MAKE' : 'MISS') : 'WAITING'}
              </div>
            </div>
          );
        })}
      </div>
      {activeCardChain && <ActiveSkillChain chain={activeCardChain} complete solo />}
      {canPlayKickerCard && kickerActiveSkill && (
        <button
          type="button"
          className="block w-full text-left hover:-translate-y-0.5 transition-transform"
          onClick={onActiveSkill}
          aria-label="Play kicker active skill"
        >
          <div className="text-[10px] font-black mb-0.5">OPTIONAL QUICK COUNTER</div>
          <ActiveSkillDetails skillId={kickerActiveSkill} status="ready" compact />
        </button>
      )}
      {ready && myKick && (
        <button type="button" className="btn-flash btn-xtra btn-go w-full" onClick={onKick}>
          Kick {shootout.distance}-Yard FG
        </button>
      )}
      {ready && !myKick && (
        <div className="font-bold animate-pulse">
          Waiting for {players[shootout.next_kicker_idx]?.name ?? 'opponent'} to kick...
        </div>
      )}
      {!ready && <div className="font-bold animate-pulse">Kick in progress...</div>}
    </div>
  );
}
