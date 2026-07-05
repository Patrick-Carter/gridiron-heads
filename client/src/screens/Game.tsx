import { useState, useEffect } from 'react';
import { EVENTS } from '../api/socket.js';
import Field from '../components/Field.js';
import SchemePicker from '../components/SchemePicker.js';
import AudiblePanel from '../components/AudiblePanel.js';
import ScorePanel from '../components/ScorePanel.js';
import PlayLog from '../components/PlayLog.js';
import RosterModal from '../components/RosterModal.js';
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

  // Roster overlay — null = closed; 0 = host's team; 1 = guest's team.
  const [rosterIdx, setRosterIdx] = useState<0 | 1 | null>(null);
  const rosterOpen = rosterIdx !== null;
  const rosterTeam = rosterIdx !== null ? game.teams[rosterIdx] : null;
  const rosterTeamName = rosterIdx !== null ? players[rosterIdx]?.name ?? '?' : '';

  return (
    <div className="min-h-full p-3 md:p-4 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4">
        {/* Left: Field + Score */}
        <div className="lg:col-span-2 space-y-3">
          <ScorePanel scores={game.scores} myIdx={myIdx} players={players} />

          {/* Roster trigger — click either name to open that team's full
              6-group roster. Lives above the field so it never competes with
              the picker / audibles panel on the right rail. */}
          <div className="panel-flash !py-2">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-ink/60">👇 Rosters</span>
              <button
                onClick={() => setRosterIdx(0)}
                data-testid="roster-trigger-0"
                className={`btn-flash ${myIdx === 0 ? 'btn-go' : 'btn-danger'} text-sm !min-h-0 py-1.5`}
              >
                {myIdx === 0 && '⭐ '}{players[0]?.name}{myIdx === 0 && ' (YOU)'}
              </button>
              <span className="text-ink/40 font-black text-xs">vs</span>
              <button
                onClick={() => setRosterIdx(1)}
                data-testid="roster-trigger-1"
                className={`btn-flash ${myIdx === 1 ? 'btn-go' : 'btn-danger'} text-sm !min-h-0 py-1.5`}
              >
                {myIdx === 1 && '⭐ '}{players[1]?.name}{myIdx === 1 && ' (YOU)'}
              </button>
            </div>
          </div>

          <div className="field-frame">
            <Field
              playResult={lastPlayResult}
              ballYardline={game.ball_yardline}
              offenseDirection={game.possession_idx === 0 ? 1 : -1}
              isAnimating={isAnimating}
              onAnimationDone={handleAnimationDone}
            />
          </div>

          <div className="panel-flash flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-bold">
              <span className="chip !bg-sun !text-ink">
                {game.down === 1 ? '1st' : game.down === 2 ? '2nd' : game.down === 3 ? '3rd' : '4th'}
              </span>{' '}
              &amp; {game.distance}
              {game.distance >= 10 && game.ball_yardline >= 10 && game.ball_yardline <= 90
                ? ` at the ${game.ball_yardline}`
                : ''}
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
            <div className="panel-flash text-base text-center space-y-2">
              <div className="panel-titlebar !mt-0"><span>Your Play</span><span className="text-xs">Recap</span></div>
              {/* Offense vs defense call summary (D029) */}
              <div className="flex items-center justify-center gap-2 text-base">
                <span className="chip !bg-lime">YOU: {lastPlayResult.off_call?.parent?.toUpperCase()} {lastPlayResult.off_call?.sub?.toUpperCase()}</span>
                <span className="text-ink/60 font-black">vs</span>
                <span className="chip !bg-maroon !text-cream">DEF: {lastPlayResult.def_call?.parent?.toUpperCase()} {lastPlayResult.def_call?.sub?.toUpperCase()}</span>
              </div>
              {(lastPlayResult.off_audible || lastPlayResult.off_fake_audible) && (
                <div className="text-xs font-bold text-maroon">
                  🗣 {lastPlayResult.off_fake_audible ? 'FAKE' : 'AUDIBLE →'} {lastPlayResult.off_audible?.sub?.toUpperCase?.() || ''}
                </div>
              )}
              <div className="text-sm font-bold">
                <span className="sticker mr-2">PLAY!</span>
                {lastPlayResult.text_recap}
              </div>
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
            <div className="panel-flash !bg-lime text-center space-y-2 animate-shout">
              <div className="panel-titlebar !mt-0"><span>YOU CALLED!</span><span className="text-xs">Locked</span></div>
              <div className="text-2xl font-black">
                <span className="chip">{pendingMyScheme.parent.toUpperCase()}</span>{' '}
                <span className="chip">{pendingMyScheme.sub.toUpperCase()}</span>
              </div>
              <div className="text-sm font-bold text-ink/80">
                ⏳ Waiting for opponent to lock in…
              </div>
            </div>
          )}

          {game.phase === 'ready_to_snap' && isOffense && (
            <div className="space-y-3">
              {opponentScheme && (
                <div className="panel-flash text-center space-y-2"
                     style={{ background: '#c8102e', color: '#fff8dc' }}>
                  <div className="panel-titlebar !mt-0" style={{ background: '#fde047', color: '#0a0a18', borderColor: '#0a0a18' }}>
                    <span>Snap Imminent!</span><span className="text-xs">Read set</span>
                  </div>
                  <div className="flex items-center justify-center gap-2 text-base flex-wrap">
                    <span className="chip !bg-lime !text-ink">YOU: {pendingMyScheme?.parent?.toUpperCase()} {pendingMyScheme?.sub?.toUpperCase()}</span>
                    <span className="font-black">vs</span>
                    <span className="chip !bg-cream !text-ink">DEF: {opponentScheme.parent.toUpperCase()} {opponentScheme.sub.toUpperCase()}</span>
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
            <div className="panel-flash text-center space-y-2 animate-pulse">
              <div className="panel-titlebar !mt-0"><span>Defense read set</span><span className="text-xs">Snap!</span></div>
              <div className="text-xs font-bold">YOU CALLED</div>
              <div className="text-2xl font-black">
                {pendingMyScheme && (
                  <>
                    <span className="chip !bg-maroon !text-cream">{pendingMyScheme.parent.toUpperCase()}</span>{' '}
                    <span className="chip !bg-maroon !text-cream">{pendingMyScheme.sub.toUpperCase()}</span>
                  </>
                )}
              </div>
              <div className="text-base">🏈 Offense snapping…</div>
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

      {/* Roster overlay — D031: click a player name to inspect their team's
          6-group roster. Dismiss with ESC / X / backdrop click, or flip to
          the other team with the swap button. */}
      <RosterModal
        open={rosterOpen}
        team={rosterTeam}
        teamName={rosterTeamName}
        ownerLabel={rosterIdx === myIdx ? 'YOU' : 'OPP'}
        myIdx={myIdx}
        focusIdx={(rosterIdx ?? 0) as 0 | 1}
        onClose={() => setRosterIdx(null)}
        onSwitch={(idx) => setRosterIdx(idx)}
      />
    </div>
  );
}
