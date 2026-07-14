import { useState, useEffect, useRef } from 'react';
import { EVENTS } from '../api/socket.js';
import Field from '../components/Field.js';
import SchemePicker from '../components/SchemePicker.js';
import AudiblePanel from '../components/AudiblePanel.js';
import ScorePanel from '../components/ScorePanel.js';

import RosterModal from '../components/RosterModal.js';
import ResultsPanel from '../components/ResultsPanel.js';
import HistoryPanel from '../components/HistoryPanel.js';
import TdConfetti from '../components/TdConfetti.js';
import ConcedeControl from '../components/ConcedeControl.js';
import ShootoutPanel from '../components/ShootoutPanel.js';
import ActiveSkillControls from '../components/ActiveSkillControls.js';
import {
  initAudio,
  playSnap,
  playThud,
  playBlock,
  playHandoff,
  playPassRelease,
  playCatch,
  playBallBounce,
  playLooseBall,
  playWhistle,
  playTdSiren,
  playFgBell,
  playFgMiss,
  playTurnover,
  playPossessionChange,
  playDownChange,
  playPointScored,
  playIncomplete,
  playKickoff,
} from '../audio/synth.js';
import {
  isBigPlay,
  playCrowdReaction,
  playCrowdRoar,
  startCrowdAmbience,
  stopCrowdAmbience,
} from '../audio/crowd.js';
import type { PlayEffect } from '../components/playAnimation.js';
import type { SessionSnapshot } from '../hooks/useSession.js';
import { activeSkillForTeamGroup } from '@gridiron/shared';
import type { Play, PlayResult, ShootoutState } from '@gridiron/shared';

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
  lastPlayResult: PlayResult | null;
  setLastPlayResult: (r: PlayResult | null) => void;
}) {
  const game = state.game!;
  const players = state.players;
  const myIdx = players.findIndex((p) => p.id === meId) as 0 | 1;
  const isOffense = myIdx === game.possession_idx;
  const isShootout = game.phase.startsWith('shootout_');
  let displayShootout: ShootoutState | null = isShootout ? game.shootout : null;
  const animatedAttempt = (game.phase === 'shootout_anim' || game.phase === 'shootout_between')
    ? lastPlayResult?.shootout_attempt
    : null;
  if (displayShootout && animatedAttempt) {
    const roundAttempts: ShootoutState['round_attempts'] = [null, null];
    for (const attempt of displayShootout.attempts) {
      if (attempt.round === animatedAttempt.round) roundAttempts[attempt.player_idx] = attempt;
    }
    displayShootout = {
      ...displayShootout,
      round: animatedAttempt.round,
      distance: animatedAttempt.distance,
      round_attempts: roundAttempts,
    };
  }
  const opponentId = players.find((p) => p.id !== meId)?.id;
  const opponentScheme = state.pending_schemes?.[opponentId ?? ''] ?? null;
  const [isAnimating, setIsAnimating] = useState(false);
  /** Live animation progress (0..1). Updated by Field via onProgress callback.
   *  Drives the RollReveal HUD's flip-in reveal timing. */
  const [animProgress, setAnimProgress] = useState<number>(0);
  /** Use a ref for the progress setter so we don't re-render Field every frame. */
  const animProgressRef = useRef(0);
  /** Increments each time a TD/FG/safety play resolves → triggers confetti rain. */
  const [confettiKey, setConfettiKey] = useState<number>(0);

  // Trigger the animation when a new play result arrives. Audio is driven by
  // the animation event track below so every hit lands on the visual action.
  useEffect(() => {
    if (lastPlayResult) {
      animProgressRef.current = 0;
      setAnimProgress(0);
      setIsAnimating(true);
    }
  }, [lastPlayResult?.seed]);

  // A low stadium bed runs only while the game is mounted. The click handler
  // retries after App unlocks AudioContext for direct-link browser loads.
  useEffect(() => {
    startCrowdAmbience();
    return stopCrowdAmbience;
  }, []);

  function finishPlayAudio(r: PlayResult) {
    if (r.scoring_event === 'td') {
      playTdSiren();
      playPointScored();
      playCrowdRoar(1.5);
      setConfettiKey((k) => k + 1);
    } else if (r.scoring_event === 'fg') {
      playFgBell();
      playPointScored();
      playCrowdRoar(1.15);
      setConfettiKey((k) => k + 1);
    } else if (r.scoring_event === 'safety') {
      playTurnover();
      playCrowdRoar(1.1);
      setConfettiKey((k) => k + 1);
    } else if (r.play_outcome === 'field_goal_blocked') {
      playFgMiss();
      playTurnover();
      playCrowdRoar(0.9);
    } else if (r.play_outcome === 'field_goal_missed') {
      playFgMiss();
      playCrowdReaction(0.45);
    } else if (r.turnover) {
      playTurnover();
      playCrowdRoar(1);
    } else if (isBigPlay(r)) {
      playCrowdRoar(Math.min(1.35, Math.max(0.75, r.yards / 18)));
    } else if (r.yards > 0) {
      playCrowdReaction(Math.min(0.7, 0.28 + r.yards / 30));
    }
  }

  function handlePlayEffect(effect: PlayEffect) {
    const result = lastPlayResult;
    if (!result) return;
    switch (effect.type) {
      case 'snap':
        playSnap();
        break;
      case 'handoff':
        playHandoff();
        break;
      case 'block':
        playBlock(effect.intensity, effect.tick);
        break;
      case 'throw':
        playPassRelease();
        break;
      case 'catch':
        playCatch(effect.intensity);
        playCrowdReaction(result.turnover ? 0.75 : 0.48);
        break;
      case 'kick':
        playKickoff();
        break;
      case 'impact':
        playThud(Math.max(0.65, effect.intensity));
        playCrowdReaction(Math.max(0.3, effect.intensity * 0.55));
        break;
      case 'loose_ball':
        playLooseBall();
        break;
      case 'bounce':
        playBallBounce(effect.intensity);
        break;
      case 'whistle':
        if (result.play_outcome === 'pass_incomplete') playIncomplete();
        else playWhistle();
        finishPlayAudio(result);
        break;
    }
  }

  // Track possession + down changes for audio cues.
  const prevPossessionRef = useRef(game.possession_idx);
  const prevDownRef = useRef(game.down);
  useEffect(() => {
    if (prevPossessionRef.current !== game.possession_idx) {
      playPossessionChange();
      prevPossessionRef.current = game.possession_idx;
    }
  }, [game.possession_idx]);
  useEffect(() => {
    if (prevDownRef.current !== game.down) {
      playDownChange();
      prevDownRef.current = game.down;
    }
  }, [game.down]);

  function handleAnimationDone() {
    setIsAnimating(false);
  }

  const pendingMyScheme = state.pending_schemes?.[meId];
  const hasPendingMyScheme = Object.prototype.hasOwnProperty.call(
    state.pending_schemes ?? {},
    meId,
  );
  const qbModifier = game.teams[myIdx].qb?.modifier;
  const realAudibleLimit = 1 + (qbModifier?.stat === 'real_audible_refresh' ? qbModifier.value : 0);
  const fakeAudibleLimit = 1 + (qbModifier?.stat === 'fake_audible_refresh' ? qbModifier.value : 0);
  const myActiveSkillsUsed = game.active_skills_used?.[myIdx] ?? [];
  const activeCardChain = state.active_card_chain ?? null;
  const kickerActiveSkill = activeSkillForTeamGroup(game.teams[myIdx], 'KICKER') ?? null;

  // Roster overlay — null = closed; 0 = host's team; 1 = guest's team.
  const [rosterIdx, setRosterIdx] = useState<0 | 1 | null>(null);
  const rosterOpen = rosterIdx !== null;
  const rosterTeam = rosterIdx !== null ? game.teams[rosterIdx] : null;
  const rosterTeamName = rosterIdx !== null ? players[rosterIdx]?.name ?? '?' : '';

  return (
    <div
      className="min-h-full p-3 md:p-4 max-w-6xl mx-auto space-y-3 md:space-y-4"
      onClick={startCrowdAmbience}
    >
      <ScorePanel
        scores={game.scores}
        possessionsCompleted={game.possessions_completed}
        shootout={displayShootout}
        myIdx={myIdx}
        players={players}
        possessionIdx={game.possession_idx}
        down={game.down}
        distance={game.distance}
        ballYardline={game.ball_yardline}
        offenseDirection={game.possession_idx === 0 ? 1 : -1}
        onOpenRoster={setRosterIdx}
      />

      <div className="field-frame">
        <Field
          playResult={lastPlayResult}
          ballYardline={game.ball_yardline}
          offenseDirection={game.possession_idx === 0 ? 1 : -1}
          possessionIdx={game.possession_idx}
          isAnimating={isAnimating}
          onAnimationDone={handleAnimationDone}
          onEffect={handlePlayEffect}
          homeName={players[0]?.name ?? 'HOME'}
          awayName={players[1]?.name ?? 'AWAY'}
          homeScore={game.scores[0]}
          awayScore={game.scores[1]}
          down={game.down}
          distance={game.distance}
          onProgress={(p) => {
            // Throttle React updates: only commit state every ~30ms
            const now = performance.now();
            if (now - (animProgressRef as any)._lastCommit > 30 || p >= 1) {
              animProgressRef.current = p;
              setAnimProgress(p);
              (animProgressRef as any)._lastCommit = now;
            }
          }}
        />
      </div>

      {/* Below canvas: 2-col on md+, stacked on mobile. Left column is the
          phase-based play call panel (SchemePicker / Snap / audibles). Right
          column is the results + rolls matchup rectangles. On mobile, the
          play call panel comes first, then the results, per layout spec. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        {/* Left: phase-based play call controls */}
        <div className="space-y-3">
          {isShootout && displayShootout && (
            <ShootoutPanel
              shootout={displayShootout}
              players={players}
              myIdx={myIdx}
              ready={game.phase === 'shootout_ready'}
              onKick={() => { initAudio(); send(EVENTS.SHOOTOUT_KICK); }}
              kickerActiveSkill={kickerActiveSkill}
              kickerActiveSkillUsed={!!kickerActiveSkill && myActiveSkillsUsed.includes(kickerActiveSkill)}
              activeCardChain={activeCardChain}
              onActiveSkill={() => send(EVENTS.ACTIVE_SKILL, { group: 'KICKER' })}
            />
          )}
          {game.phase === 'awaiting_schemes' && !hasPendingMyScheme && (
            <SchemePicker
              onPick={(parent, sub) => send(EVENTS.SCHEME_PICK, { parent, sub })}
            />
          )}
          {game.phase === 'awaiting_schemes' && hasPendingMyScheme && (
            <div className="panel-flash !bg-lime text-center space-y-2 animate-shout">
              <div className="panel-titlebar !mt-0"><span>YOU CALLED!</span><span className="text-xs">Locked</span></div>
              <div className="text-2xl font-black">
                {pendingMyScheme
                  ? <><span className="chip">{pendingMyScheme.parent.toUpperCase()}</span>{' '}<span className="chip">{pendingMyScheme.sub.toUpperCase()}</span></>
                  : <span className="chip">PLAY LOCKED</span>}
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
              <AudiblePanel
                role="offense"
                phase={game.phase}
                currentPlay={pendingMyScheme}
                audiblesUsed={game.audibles_used?.[myIdx]}
                fakeAudiblesUsed={game.fake_audibles_used?.[myIdx]}
                realAudibleLimit={realAudibleLimit}
                fakeAudibleLimit={fakeAudibleLimit}
                onAudible={(sub) => send(EVENTS.AUDIBLE, { target_sub: sub })}
                onFakeAudible={() => send(EVENTS.FAKE_AUDIBLE)}
              />
              <ActiveSkillControls
                phase={game.phase}
                isOffense
                team={game.teams[myIdx]}
                used={myActiveSkillsUsed}
                currentPlay={pendingMyScheme}
                chain={activeCardChain}
                onOffenseSkill={(group) => send(EVENTS.ACTIVE_SKILL, { group })}
                onOffensePass={() => send(EVENTS.ACTIVE_SKILL_PASS)}
                onDefenseSkill={(group) => send(EVENTS.DEF_ACTIVE_SKILL, { group })}
                onDefensePass={() => send(EVENTS.DEF_ACTIVE_PASS)}
              />
            </div>
          )}

          {game.phase === 'ready_to_snap' && !isOffense && (
            <div className="panel-flash text-center space-y-2 animate-pulse">
              <div className="panel-titlebar !mt-0"><span>Defense read set</span><span className="text-xs">Priority</span></div>
              <div className="flex items-center justify-center gap-2 text-sm flex-wrap">
                <span className="chip !bg-maroon !text-cream">
                  DEF (you): {pendingMyScheme ? `${pendingMyScheme.parent.toUpperCase()} ${pendingMyScheme.sub.toUpperCase()}` : '—'}
                </span>
                <span className="text-ink/60 font-black">vs</span>
                <span className="chip !bg-lime !text-ink">
                  OFF: {opponentScheme ? `${opponentScheme.parent.toUpperCase()} ${opponentScheme.sub.toUpperCase()}` : '—'}
                </span>
              </div>
              <div className="text-base">Offense is choosing a card or passing priority…</div>
            </div>
          )}

          {(game.phase === 'awaiting_card_response' || game.phase === 'card_chain_complete') && (
            <div className="space-y-3">
              <ActiveSkillControls
                phase={game.phase}
                isOffense={isOffense}
                team={game.teams[myIdx]}
                used={myActiveSkillsUsed}
                currentPlay={pendingMyScheme}
                chain={activeCardChain}
                onOffenseSkill={(group) => send(EVENTS.ACTIVE_SKILL, { group })}
                onOffensePass={() => send(EVENTS.ACTIVE_SKILL_PASS)}
                onDefenseSkill={(group) => send(EVENTS.DEF_ACTIVE_SKILL, { group })}
                onDefensePass={() => send(EVENTS.DEF_ACTIVE_PASS)}
              />
              {game.phase === 'card_chain_complete' && isOffense && (
                <button
                  onClick={() => { initAudio(); send(EVENTS.SNAP); }}
                  className="btn-flash btn-xtra btn-go w-full"
                >
                  ⚡ SNAP! ⚡
                </button>
              )}
              {game.phase === 'card_chain_complete' && !isOffense && (
                <div className="panel-flash text-center font-black animate-pulse">
                  Quick Counter locked · offense snapping…
                </div>
              )}
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

          {(game.phase === 'between_plays' || game.phase === 'play_anim'
            || game.phase === 'shootout_between' || game.phase === 'shootout_anim') && (
            <button
              onClick={() => {
                setLastPlayResult(null);
                send(EVENTS.NEXT_PLAY);
              }}
              className="btn-flash btn-primary w-full"
            >
              ⏭ Skip Wait
            </button>
          )}
          {(game.phase === 'play_anim' || game.phase === 'shootout_anim') && (
            <div className="text-center text-xs text-cream/80 animate-pulse">
              📺 Play animating…
            </div>
          )}
          {(game.phase === 'between_plays' || game.phase === 'shootout_between') && (
            <div className="text-center text-xs text-cream/80">
              ⏱ Next play in ~2.5s
            </div>
          )}
        </div>

        {/* Right: results + rolls (matchup rectangles + verdict + result card) */}
        <div>
          <ResultsPanel
            playResult={lastPlayResult}
            progress={isAnimating ? animProgress : null}
          />
        </div>
      </div>

      {/* History — scrollable list of recent plays, full width. */}
      <HistoryPanel
        playResult={lastPlayResult}
        history={game.history || []}
      />

      <div className="max-w-sm mx-auto w-full">
        <ConcedeControl onConcede={() => send(EVENTS.CONCEDE)} />
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
        activeSkillsUsed={game.active_skills_used}
        activeCardChain={activeCardChain}
      />

      {/* Phase 7: confetti rain on scoring plays */}
      <TdConfetti triggerKey={confettiKey} />
    </div>
  );
}
