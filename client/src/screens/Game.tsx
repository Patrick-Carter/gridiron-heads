import { useState, useEffect } from 'react';
import { EVENTS } from '../api/socket.js';
import Field from '../components/Field.js';
import SchemePicker from '../components/SchemePicker.js';
import AudiblePanel from '../components/AudiblePanel.js';
import ScorePanel from '../components/ScorePanel.js';
import PlayLog from '../components/PlayLog.js';
import type { SessionSnapshot } from '../hooks/useSession.js';
import type { Play, PlayParent, PlaySub } from '@gridiron/shared';

export default function Game({
  state,
  meId,
  send,
  lastPlayResult,
  setLastPlayResult,
}: {
  state: SessionSnapshot;
  meId: string;
  send: (e: string, p?: any) => void;
  lastPlayResult: any | null;
  setLastPlayResult: (r: any | null) => void;
}) {
  const game = state.game!;
  const players = state.players;
  const myIdx = players.findIndex((p) => p.id === meId) as 0 | 1;
  const isOffense = myIdx === game.possession_idx;
  const [isAnimating, setIsAnimating] = useState(false);
  const [canReplay, setCanReplay] = useState(false);

  // Trigger animation when a new play result arrives
  useEffect(() => {
    if (lastPlayResult) {
      setIsAnimating(true);
      setCanReplay(true);
    }
  }, [lastPlayResult?.seed]);

  function handleAnimationDone() {
    setIsAnimating(false);
  }

  function handleReplay() {
    if (lastPlayResult) {
      setIsAnimating(true);
    }
  }

  const pendingMyScheme = state.pending_schemes?.[meId];

  return (
    <div className="min-h-full p-4 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Field + Score */}
        <div className="lg:col-span-2 space-y-3">
          <ScorePanel scores={game.scores} myIdx={myIdx} players={players} />
          <Field
            playResult={lastPlayResult}
            ballYardline={game.ball_yardline}
            possessionIdx={game.possession_idx}
            isAnimating={isAnimating}
            onAnimationDone={handleAnimationDone}
          />
          <div className="bg-panel border border-border rounded p-3 text-sm flex items-center justify-between">
            <div>
              {game.down === 1 ? '1st' : game.down === 2 ? '2nd' : game.down === 3 ? '3rd' : '4th'} & {game.distance} at {game.ball_yardline}
            </div>
            <div className="text-fg/60">
              Phase: {game.phase} · {isOffense ? 'OFFENSE' : 'DEFENSE'}
            </div>
            {canReplay && !isAnimating && (
              <button
                onClick={handleReplay}
                className="text-xs px-2 py-1 border border-border rounded hover:bg-bg"
              >
                Replay last play
              </button>
            )}
          </div>
          {lastPlayResult && !isAnimating && (
            <div className="bg-panel border border-border rounded p-3 text-sm">
              {lastPlayResult.text_recap}
            </div>
          )}
        </div>

        {/* Right: Controls + Log */}
        <div className="space-y-3">
          {game.phase === 'awaiting_schemes' && !pendingMyScheme && (
            <SchemePicker
              onPick={(parent, sub) => send(EVENTS.SCHEME_PICK, { parent, sub })}
            />
          )}
          {game.phase === 'awaiting_schemes' && pendingMyScheme && (
            <div className="bg-panel border border-border rounded p-4 text-center text-fg/60">
              Locked in: <span className="text-accent font-bold">{pendingMyScheme.parent} {pendingMyScheme.sub}</span>
              <div className="text-xs mt-2">Waiting for opponent…</div>
            </div>
          )}
          {game.phase === 'ready_to_snap' && isOffense && (
            <div className="space-y-3">
              <button
                onClick={() => send(EVENTS.SNAP)}
                className="w-full bg-ok text-bg font-bold py-3 rounded hover:opacity-90"
              >
                SNAP
              </button>
              <AudiblePanel
                role="offense"
                phase={game.phase}
                currentPlay={pendingMyScheme}
                audiblesUsed={game.audibles_used?.[myIdx]}
                fakeAudiblesUsed={game.fake_audibles_used?.[myIdx]}
                onAudible={(sub) => send(EVENTS.AUDIBLE, { target_sub: sub })}
                onFakeAudible={() => send(EVENTS.FAKE_AUDIBLE)}
              />
            </div>
          )}
          {game.phase === 'ready_to_snap' && !isOffense && (
            <div className="bg-panel border border-border rounded p-4 text-center text-fg/60">
              Offense snapping…
            </div>
          )}
          {game.phase === 'awaiting_def_response' && !isOffense && (
            <AudiblePanel
              role="defense"
              phase={game.phase}
              currentPlay={pendingMyScheme}
              onDefAudible={(sub) => send(EVENTS.DEF_AUDIBLE, { target_sub: sub })}
              onDefStay={() => send(EVENTS.DEF_STAY)}
            />
          )}
          {game.phase === 'awaiting_def_response' && isOffense && (
            <div className="bg-panel border border-border rounded p-4 text-center text-fg/60">
              Waiting for defense…
            </div>
          )}
          {(game.phase === 'between_plays' || game.phase === 'play_anim') && (
            <button
              onClick={() => {
                setLastPlayResult(null);
                setCanReplay(false);
                send(EVENTS.NEXT_PLAY);
              }}
              className="w-full bg-accent text-bg font-bold py-3 rounded hover:opacity-90"
            >
              Next Play
            </button>
          )}
          <PlayLog history={game.history || []} myIdx={myIdx} />
        </div>
      </div>
    </div>
  );
}