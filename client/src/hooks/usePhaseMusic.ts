// usePhaseMusic — drives the BG music based on the current session state.
//
// Mount once at the SessionRouter level. Picks:
//   - draft theme while in Draft
//   - game theme during Game (tense theme on 3rd/4th down)
//   - victory / defeat sting when game ends (per-player perspective)
//   - silence in Lobby / CoinFlip
//
// Crossfades between tracks. The setTrack() call is idempotent so re-renders
// with the same state don't restart music.

import { useEffect, useRef } from 'react';
import { setTrack, type TrackName } from '../audio/music.js';
import type { SessionSnapshot } from './useSession.js';

export function usePhaseMusic(
  state: SessionSnapshot | null,
  meId: string | undefined,
) {
  // Track the last track we requested to avoid re-setting on every render
  const lastTrackRef = useRef<TrackName | null>(null);

  useEffect(() => {
    if (!state || !meId) return;
    let next: TrackName = null;

    if (state.game?.phase === 'ended') {
      const myIdx = state.players.findIndex((p) => p.id === meId);
      const winnerIdx = state.game.scores[0] > state.game.scores[1] ? 0 : 1;
      next = myIdx === winnerIdx ? 'victory' : 'defeat';
    } else if (state.game) {
      // Tense theme for 3rd/4th down only during the active phases
      const activePhase = state.game.phase === 'awaiting_schemes'
        || state.game.phase === 'ready_to_snap'
        || state.game.phase === 'awaiting_def_response';
      next = (activePhase && state.game.down >= 3) ? 'tense' : 'game';
    } else if (state.draft) {
      next = 'draft';
    } else {
      next = null;
    }

    if (next === lastTrackRef.current) return;
    lastTrackRef.current = next;
    setTrack(next, 600);
  }, [
    state?.game?.phase,
    state?.game?.down,
    state?.game?.scores?.[0],
    state?.game?.scores?.[1],
    state?.draft?.current_turn,
    state?.draft != null,
    meId,
  ]);
}