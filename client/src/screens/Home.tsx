import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="min-h-full flex items-center justify-center p-8">
      <div className="max-w-md w-full space-y-6">
        <h1 className="text-4xl font-bold text-accent">Gridiron Heads</h1>
        <p className="text-fg/80">
          2-player head-to-head football. Draft asymmetric position groups, then play simultaneous
          scheme picks with turn-based audibles. First to 3 (win by 2).
        </p>
        <div className="space-y-3 pt-4">
          <Link
            to="/create"
            className="block w-full text-center bg-accent text-bg font-bold py-3 rounded hover:opacity-90"
          >
            Create Game
          </Link>
          <Link
            to="/join"
            className="block w-full text-center border border-border text-fg font-bold py-3 rounded hover:bg-panel"
          >
            Join Game
          </Link>
        </div>
      </div>
    </div>
  );
}