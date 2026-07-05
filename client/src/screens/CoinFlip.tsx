import type { SessionSnapshot } from '../hooks/useSession.js';

export default function CoinFlip({ state, meId }: { state: SessionSnapshot; meId: string }) {
  const result = state.coin_result;
  const iAmFirst = state.first_possession_id === meId;
  return (
    <div className="min-h-full flex items-center justify-center">
      <div className="text-center space-y-6">
        <div className="text-8xl">🪙</div>
        <div className="text-3xl font-bold text-accent">
          {result === 'heads' ? 'HEADS!' : 'TAILS!'}
        </div>
        <div className="text-xl text-fg">
          {iAmFirst ? 'You pick first.' : 'Opponent picks first.'}
        </div>
        <div className="text-fg/40 text-sm animate-pulse">Draft starting…</div>
      </div>
    </div>
  );
}