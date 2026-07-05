import { useState, useEffect } from 'react';
import { EVENTS } from '../api/socket.js';
import Field from '../components/Field.js';
import SchemePicker from '../components/SchemePicker.js';
import AudiblePanel from '../components/AudiblePanel.js';
import ScorePanel from '../components/ScorePanel.js';
import PlayLog from '../components/PlayLog.js';
import type { SessionSnapshot } from '../hooks/useSession.js';
import type { Play } from '@gridiron/shared';

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
  const opponentId = players.find((p) => p.id !== meId)?.id;
  const opponentScheme = state.pending_schemes?.[opponentId ?? ''] ?? null;
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
    <div className="min-h-full p-3 md:p-4 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4">
        {/* Left: Field + Score */}
        <div className="lg:col-span-2 space-y-3">
          <ScorePanel scores={game.scores} myIdx={myIdx} players={players} />

          <div className="field-frame">
            <Field
              playResult={lastPlayResult}
              ballYardline={game.ball_yardline}
              isAnimating={isAnimating}
              onAnimationDone={handleAnimationDone}
            />
          </div>

          <div className="panel-flash flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-bold">
              <span className="chip !bg-sun !text-ink">
                {game.down === 1 ? '1st' : game.down === 2 ? '2nd' : game.down === 3 ? '3rd' : '4th'}
              </span>{' '}
              &amp; {game.distance} @ {game.ball_yardline}
            </span>
            <span className="text-xs font-bold">
              <span className={isOffense ? 'chip !bg-lime' : 'chip !bg-maroon !text-cream'}>
                {isOffense ? 'OFFENSE 🏈' : 'DEFENSE 🛡️'}
              </span>
            </span>
            {canReplay && !isAnimating && (
              <button
                onClick={handleReplay}
                className="btn-flash btn-cool text-sm"
              >
                ↻ Replay
              </button>
            )}
          </div>

          {lastPlayResult && !isAnimating && (
            <div className="panel-flash text-base font-bold text-center">
              <span className="sticker mr-2">PLAY!</span>
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
            <div className="panel-flash text-center space-y-2">
              <div className="panel-titlebar !mt-0"><span>Locked In!</span><span className="text-xs">Waiting…</span></div>
              <div className="text-xl font-bold">
                <span className="chip">{pendingMyScheme.parent}</span>{' '}
                <span className="chip">{pendingMyScheme.sub}</span>
              </div>
              <div className="text-sm text-ink/70">Waiting for opponent…</div>
            </div>
          )}

          {game.phase === 'ready_to_snap' && isOffense && (
            <div className="space-y-3">
              {opponentScheme && (
                <div className="panel-flash text-center"
                     style={{ background: '#c8102e', color: '#fff8dc' }}>
                  <div className="text-xs uppercase font-bold mb-1">Defense called:</div>
                  <div className="text-xl font-bold">
                    {opponentScheme.parent.toUpperCase()} {opponentScheme.sub.toUpperCase()}
                  </div>
                </div>
              )}
              <button
                onClick={() => send(EVENTS.SNAP)}
                className="btn-flash btn-xtra btn-go w-full"
              >
                ⚡ SNAP! ⚡
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
            <div className="panel-flash text-center animate-pulse">
              <div className="text-xl">🏈 Offense snapping…</div>
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
            <div className="panel-flash text-center animate-pulse">
              <div className="text-xl">🕒 Waiting for defense…</div>
            </div>
          )}

          {(game.phase === 'between_plays' || game.phase === 'play_anim') && (
            <button
              onClick={() => {
                setLastPlayResult(null);
                setCanReplay(false);
                send(EVENTS.NEXT_PLAY);
              }}
              className="btn-flash btn-primary w-full"
            >
              ⏭ Skip Wait
            </button>
          )}
          {game.phase === 'play_anim' && (
            <div className="text-center text-xs text-cream/80 animate-pulse">
              📺 Play animating…
            </div>
          )}
          {game.phase === 'between_plays' && (
            <div className="text-center text-xs text-cream/80">
              ⏱ Next play in ~2.5s
            </div>
          )}

          <PlayLog history={game.history || []} myIdx={myIdx} />
        </div>
      </div>
    </div>
  );
}
