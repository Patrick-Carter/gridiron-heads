import type { SessionSnapshot } from '../hooks/useSession.js';
import FlashHeader from '../components/FlashHeader.js';

export default function CoinFlip({ state, meId }: { state: SessionSnapshot; meId: string }) {
  const result = state.coin_result;
  const iAmFirst = state.first_possession_id === meId;
  return (
    <div className="min-h-full flex flex-col items-center justify-center p-4 relative">
      <FlashHeader
        title={result === 'heads' ? 'HEADS!' : 'TAILS!'}
        kicker="Coin Toss"
        star="🪙"
      />
      <div className="panel-flash max-w-sm w-full text-center mt-4 space-y-3">
        <div className="text-7xl animate-wobble">🪙</div>
        <div className="text-2xl font-bold">
          {iAmFirst ? (
            <>
              <span className="chip !bg-lime">YOU PICK FIRST</span>
            </>
          ) : (
            <>
              <span className="chip !bg-maroon !text-cream">OPPONENT PICKS FIRST</span>
            </>
          )}
        </div>
        <div className="text-sm text-ink/70">
          The draft begins in a moment…
        </div>
        <div className="text-xs text-ink/50 animate-pulse">
          (Loading next screen…)
        </div>
      </div>
    </div>
  );
}
