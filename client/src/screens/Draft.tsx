import { useEffect, useRef } from 'react';
import { EVENTS } from '../api/socket.js';
import { PICK_ORDER } from '@gridiron/shared';
import type { SessionSnapshot } from '../hooks/useSession.js';
import { modifierDescription } from '@gridiron/shared';
import FlashHeader from '../components/FlashHeader.js';
import { initAudio, playDraftPick } from '../audio/synth.js';

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
  const opponentIsCpu = (state.players.find((p) => p.id !== meId) as any)?.is_cpu === true;
  const myTeam = draft.picks[meId];
  const oppTeam = draft.picks[opponentId];
  const currentPickerName = state.players.find((p) => p.id === draft.current_picker_id)?.name ?? '?';
  const currentPickerIsCpu = (state.players.find((p) => p.id === draft.current_picker_id) as any)?.is_cpu === true;

  // Draft pick chime — fires every time current_turn advances (i.e. someone,
  // including the CPU, just registered a pick).
  const prevTurnRef = useRef(draft.current_turn);
  useEffect(() => {
    if (draft.current_turn !== prevTurnRef.current) {
      playDraftPick();
      prevTurnRef.current = draft.current_turn;
    }
  }, [draft.current_turn]);

  function pick(group: string, optionId: string) {
    initAudio();
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
    <div className="min-h-full p-4 md:p-6 relative">
      <FlashHeader title="THE DRAFT" kicker={`Pick ${draft.current_turn + 1} of ${draft.total}`} star="🏈" />

      <div className="max-w-6xl mx-auto space-y-4">
        {/* Turn banner */}
        <div className={`panel-flash text-center ${myTurn ? 'animate-shout' : ''}`}>
          <div className="panel-titlebar !mt-0">
            <span>{myTurn ? 'YOUR MOVE' : `${currentPickerName.toUpperCase()}'S MOVE`}</span>
            <span className="text-xs">{draft.current_turn + 1}/{draft.total}</span>
          </div>
          <div className="text-base md:text-lg font-bold">
            {myTurn ? (
              <span className="chip !bg-lime">PICK ANY GROUP BELOW!</span>
            ) : currentPickerIsCpu ? (
              <span>🤖 CPU Bot is thinking…</span>
            ) : (
              <span>Hang tight — they're deciding…</span>
            )}
          </div>
        </div>

        {/* Pick order bar */}
        <div className="flex gap-1 text-xs">
          {draft.pick_order.map((pid: string, i: number) => {
            const isMine = pid === meId;
            const isCurrent = i === draft.current_turn;
            const isDone = i < draft.current_turn;
            return (
              <div
                key={i}
                className={`flex-1 text-center py-1 border-2 ${
                  isCurrent
                    ? 'bg-sun text-ink font-bold animate-pulse'
                    : isDone
                    ? isMine
                      ? 'bg-lime text-ink'
                      : 'bg-maroon text-cream'
                    : isMine
                    ? 'bg-cream text-ink'
                    : 'bg-board text-cream/70'
                }`}
                style={{ borderColor: '#0a0a18' }}
              >
                {i + 1}
              </div>
            );
          })}
        </div>

        {/* All groups */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
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
                className={`panel-flash !p-3 space-y-2 ${canPick ? 'animate-shout' : ''}`}
                style={canPick ? { borderColor: '#ffd400' } : undefined}
              >
                <div className="flex items-center justify-between">
                  <span className="chip">{group.replace('_', ' ')}</span>
                  <span className="text-xs font-bold">{pool.length} left</span>
                </div>

                {myPickHere && (
                  <div className="border-3 border-ink bg-lime/30 p-2 text-xs"
                       style={{ borderWidth: 3, borderColor: '#0a0a18', background: '#c8ff0033' }}>
                    <div className="font-bold text-ink">YOU: {myPickHere.name}</div>
                    {myPickHere.skill != null && (
                      <div className="text-ink/70">skill {myPickHere.skill}</div>
                    )}
                    {myPickHere.modifier && (
                      <div className="text-maroon text-[10px] mt-1">
                        ✦ {modifierDescription(myPickHere.modifier)}
                      </div>
                    )}
                  </div>
                )}
                {oppPickHere && (
                  <div className="border-3 border-ink bg-maroon/15 p-2 text-xs"
                       style={{ borderWidth: 3, borderColor: '#0a0a18', background: '#c8102e22' }}>
                    <div className="font-bold text-maroon flex items-center gap-1">
                      {opponentIsCpu && <span className="sticker !text-[10px]">🤖</span>}
                      OPP: {oppPickHere.name}
                    </div>
                    {oppPickHere.skill != null && (
                      <div className="text-ink/70">skill {oppPickHere.skill}</div>
                    )}
                    {oppPickHere.modifier && (
                      <div className="text-maroon text-[10px] mt-1">
                        ✦ {modifierDescription(oppPickHere.modifier)}
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
                        className={`block w-full text-left text-xs border-2 px-2 py-2 ${
                          canPick
                            ? 'bg-cream hover:bg-sun text-ink font-bold'
                            : 'bg-cream/40 text-ink/40 cursor-not-allowed'
                        }`}
                        style={{ borderColor: '#0a0a18' }}
                      >
                        <div className="font-bold">{opt.name}</div>
                        {opt.skill != null && (
                          <div className="text-[10px] opacity-70">skill {opt.skill}</div>
                        )}
                        {opt.modifier && (
                          <div className="text-maroon text-[10px] mt-0.5">
                            ✦ {modifierDescription(opt.modifier)}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {iTookIt && oppTookIt && (
                  <div className="text-ink/50 text-xs italic text-center">Both picked — pool empty.</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
