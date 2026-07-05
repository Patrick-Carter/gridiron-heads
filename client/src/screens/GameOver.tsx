import { Link } from 'react-router-dom';
import type { SessionSnapshot } from '../hooks/useSession.js';

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
  return (
    <div className="min-h-full flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="text-6xl">{iWon ? '🏆' : '😞'}</div>
        <h2 className="text-4xl font-bold text-accent">
          {iWon ? 'You Win!' : 'You Lose.'}
        </h2>
        <div className="bg-panel border border-border rounded p-6 space-y-2">
          <div className="text-2xl">
            <span className="text-accent">{game.scores[0].toFixed(1)}</span>
            <span className="text-fg/40 mx-3">vs</span>
            <span className="text-accent">{game.scores[1].toFixed(1)}</span>
          </div>
          <div className="text-fg/60 text-sm">
            {players[winnerIdx].name} wins (≥3 with 2-point lead)
          </div>
        </div>
        <div className="space-y-2">
          <button
            onClick={onRematch}
            className="w-full bg-accent text-bg font-bold py-3 rounded hover:opacity-90"
          >
            Rematch
          </button>
          <Link
            to="/"
            className="block w-full text-center border border-border text-fg py-3 rounded hover:bg-panel"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}