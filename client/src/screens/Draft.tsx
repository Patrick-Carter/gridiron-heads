import { EVENTS } from '../api/socket.js';
import { PICK_ORDER } from '@gridiron/shared';
import type { SessionSnapshot } from '../hooks/useSession.js';
import { modifierDescription } from '@gridiron/shared';

export default function Draft({
  state,
  meId,
  send,
}: {
  state: SessionSnapshot;
  meId: string;
  send: (e: string, p?: any) => void;
}) {
  const draft = state.draft!;
  const myTurn = draft.order[draft.turn] === meId;
  const currentGroup = PICK_ORDER[draft.turn % PICK_ORDER.length];
  const myTeam = draft.picks[meId];

  function pick(group: string, optionId: string) {
    send(EVENTS.DRAFT_PICK, { group, option_id: optionId });
  }

  return (
    <div className="min-h-full p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-accent">Draft</h2>
          <div className="text-fg/60">
            Pick {draft.turn + 1} of {draft.total} · {myTurn ? 'YOUR TURN' : "OPPONENT'S TURN"}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {PICK_ORDER.map((group) => {
            const pool = (draft.pool as any)[group] || [];
            const myPick = (myTeam as any)[group.toLowerCase()] as { id: string; name: string; skill?: number; modifier?: any } | null;
            return (
              <div
                key={group}
                className={`bg-panel border rounded p-3 space-y-2 ${
                  currentGroup === group ? 'border-accent' : 'border-border'
                }`}
              >
                <h3 className="text-sm font-bold text-fg/80">{group}</h3>
                {myPick ? (
                  <div className="text-ok text-sm">
                    ✓ {myPick.name}
                    {myPick.skill != null && <span className="text-fg/40"> ({myPick.skill})</span>}
                    {myPick.modifier && (
                      <div className="text-xs text-fg/60 mt-1">
                        {modifierDescription(myPick.modifier)}
                      </div>
                    )}
                  </div>
                ) : currentGroup === group && myTurn ? (
                  <div className="space-y-1">
                    {pool.map((opt: any) => (
                      <button
                        key={opt.id}
                        onClick={() => pick(group, opt.id)}
                        className="block w-full text-left text-xs bg-bg hover:bg-border rounded px-2 py-1"
                      >
                        <div>{opt.name}</div>
                        {opt.skill != null && (
                          <div className="text-fg/40">skill {opt.skill}</div>
                        )}
                        {opt.modifier && (
                          <div className="text-accent text-[10px] mt-0.5">
                            {modifierDescription(opt.modifier)}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-fg/40 text-xs">{pool.length} options</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="text-fg/40 text-xs">
          Draft pool is shared — first to pick removes the option for both.
        </div>
      </div>
    </div>
  );
}