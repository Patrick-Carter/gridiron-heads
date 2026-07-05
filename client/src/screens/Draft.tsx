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
  const myTurn = draft.current_picker_id === meId;
  const opponentId = state.players.find((p) => p.id !== meId)!.id;
  const myTeam = draft.picks[meId];
  const oppTeam = draft.picks[opponentId];
  const currentPickerName = state.players.find((p) => p.id === draft.current_picker_id)?.name ?? '?';

  function pick(group: string, optionId: string) {
    send(EVENTS.DRAFT_PICK, { group, option_id: optionId });
  }

  // Helper: which groups has this player already taken?
  function pickedGroups(team: any): Set<string> {
    const s = new Set<string>();
    if (team.qb) s.add('QB');
    if (team.d_line) s.add('D_LINE');
    if (team.o_line) s.add('O_LINE');
    if (team.off_skill) s.add('OFF_SKILL');
    if (team.def_skill) s.add('DEF_SKILL');
    if (team.kicker) s.add('KICKER');
    return s;
  }
  const myPicked = pickedGroups(myTeam);
  const oppPicked = pickedGroups(oppTeam);

  return (
    <div className="min-h-full p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-accent">Draft</h2>
          <div className={`text-lg font-bold ${myTurn ? 'text-ok' : 'text-warn'}`}>
            {myTurn ? 'YOUR TURN' : `${currentPickerName}'s turn`}
          </div>
        </div>

        {/* Pick order bar — shows which pick of 12 we're on */}
        <div className="flex gap-1 text-xs">
          {draft.pick_order.map((pid: string, i: number) => {
            const isMine = pid === meId;
            const isCurrent = i === draft.current_turn;
            const isDone = i < draft.current_turn;
            return (
              <div
                key={i}
                className={`flex-1 text-center py-1 rounded ${
                  isCurrent
                    ? 'bg-accent text-bg font-bold'
                    : isDone
                    ? isMine
                      ? 'bg-ok/30 text-ok'
                      : 'bg-err/30 text-err'
                    : isMine
                    ? 'bg-panel border border-accent text-fg'
                    : 'bg-panel border border-border text-fg/60'
                }`}
              >
                {i + 1}
              </div>
            );
          })}
        </div>

        {/* All groups, visible to both — your pickable options stay enabled if it's your turn AND you haven't taken the group */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PICK_ORDER.map((group) => {
            const pool = (draft.pool as any)[group] || [];
            const myPickHere = (myTeam as any)[group.toLowerCase()];
            const oppPickHere = (oppTeam as any)[group.toLowerCase()];
            const iTookIt = myPicked.has(group);
            const oppTookIt = oppPicked.has(group);
            const canPick = myTurn && !iTookIt;
            return (
              <div
                key={group}
                className={`bg-panel border rounded p-3 space-y-2 ${
                  canPick ? 'border-accent' : 'border-border'
                }`}
              >
                <h3 className="text-sm font-bold text-fg/80 flex items-center justify-between">
                  <span>{group}</span>
                  <span className="text-xs text-fg/40">({pool.length} left)</span>
                </h3>

                {myPickHere && (
                  <div className="text-xs bg-ok/10 border border-ok/30 rounded p-2">
                    <div className="text-ok font-bold">YOU: {myPickHere.name}</div>
                    {myPickHere.skill != null && (
                      <div className="text-fg/60">skill {myPickHere.skill}</div>
                    )}
                    {myPickHere.modifier && (
                      <div className="text-accent text-[10px] mt-1">
                        {modifierDescription(myPickHere.modifier)}
                      </div>
                    )}
                  </div>
                )}
                {oppPickHere && (
                  <div className="text-xs bg-err/10 border border-err/30 rounded p-2">
                    <div className="text-err font-bold">OPP: {oppPickHere.name}</div>
                    {oppPickHere.skill != null && (
                      <div className="text-fg/60">skill {oppPickHere.skill}</div>
                    )}
                    {oppPickHere.modifier && (
                      <div className="text-accent text-[10px] mt-1">
                        {modifierDescription(oppPickHere.modifier)}
                      </div>
                    )}
                  </div>
                )}

                {!iTookIt && pool.length > 0 && (
                  <div className="space-y-1">
                    {pool.map((opt: any) => (
                      <button
                        key={opt.id}
                        disabled={!canPick}
                        onClick={() => pick(group, opt.id)}
                        className={`block w-full text-left text-xs rounded px-2 py-1 ${
                          canPick
                            ? 'bg-bg hover:bg-accent hover:text-bg border border-border'
                            : 'bg-bg/50 text-fg/40 border border-border cursor-not-allowed'
                        }`}
                      >
                        <div>{opt.name}</div>
                        {opt.skill != null && (
                          <div className="text-fg/40 text-[10px]">skill {opt.skill}</div>
                        )}
                        {opt.modifier && (
                          <div className="text-accent text-[10px] mt-0.5">
                            {modifierDescription(opt.modifier)}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {iTookIt && oppTookIt && (
                  <div className="text-fg/40 text-xs italic">Both picked — pool empty.</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="text-fg/40 text-xs">
          Pick {draft.current_turn + 1} of {draft.total} · alternating turns · any unpicked group.
        </div>
      </div>
    </div>
  );
}