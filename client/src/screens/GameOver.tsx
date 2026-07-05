import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { SessionSnapshot } from '../hooks/useSession.js';
import FlashHeader from '../components/FlashHeader.js';
import { initAudio, playVictory, playDefeat, playCheer, playUiClick } from '../audio/synth.js';

export default function GameOver({
  state,
  meId,
  onRematch,
}: {
  state: SessionSnapshot;
  meId: string;
  onRematch: () => void;
}) {
  const game = state.game!;
  const players = state.players;
  const myIdx = players.findIndex((p) => p.id === meId);
  const winnerIdx = game.scores[0] > game.scores[1] ? 0 : 1;
  const iWon = winnerIdx === myIdx;

  // One-shot sting on mount: victory fanfare + cheer if I won, defeat sigh if not.
  useEffect(() => {
    initAudio();
    if (iWon) {
      playVictory();
      setTimeout(() => playCheer(1.5), 600);
    } else {
      playDefeat();
    }
  }, []);

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-4 md:p-8 relative">
      <FlashHeader
        title={iWon ? 'YOU WIN!' : 'GAME OVER'}
        kicker={iWon ? '🏆 Champion 🏆' : 'Final Whistle'}
        star={iWon ? '⭐' : '💀'}
      />

      <div className="panel-flash max-w-md w-full text-center space-y-4 mt-2">
        <div className="panel-titlebar !mt-0">
          <span>Final Score</span>
          <span className="text-xs">Best of 3</span>
        </div>

        <div className="text-xl">
          <span className="text-ink font-bold">{players[0].name}</span>{' '}
          <span className="chip !bg-lime">{game.scores[0].toFixed(1)}</span>{' '}
          <span className="text-ink/40 mx-1">vs</span>{' '}
          <span className="chip !bg-maroon !text-cream">{game.scores[1].toFixed(1)}</span>{' '}
          <span className="text-ink font-bold">{players[1].name}</span>
        </div>

        <div className="text-base font-bold">
          🏆 <span className="text-maroon">{players[winnerIdx].name}</span> wins with a {Math.abs(game.scores[0] - game.scores[1]).toFixed(1)}-point lead
        </div>

        {iWon && (
          <div className="text-center">
            <div className="flash-banner animate-shout">GO TEAM!</div>
          </div>
        )}

        <div className="space-y-2 pt-2">
          <button
            onClick={() => { initAudio(); onRematch(); }}
            className="btn-flash btn-xtra btn-primary w-full"
          >
            🔁 Rematch
          </button>
          <Link
            to="/"
            onClick={() => playUiClick()}
            className="btn-flash btn-grape w-full text-center"
          >
            🏠 Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
