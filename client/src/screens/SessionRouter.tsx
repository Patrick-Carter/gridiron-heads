import { useParams } from 'react-router-dom';
import { useSession } from '../hooks/useSession.js';
import Lobby from './Lobby.js';
import CoinFlip from './CoinFlip.js';
import Draft from './Draft.js';
import Game from './Game.js';
import GameOver from './GameOver.js';

export default function SessionRouter() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <div>Missing session id</div>;
  const playerId = localStorage.getItem(`gridiron:player_id:${id}`);
  if (!playerId) {
    return (
      <div className="p-8 text-fg">
        <p>No player id found. <a className="text-accent" href="/">Start over</a></p>
      </div>
    );
  }
  return <SessionInner sessionId={id} playerId={playerId} />;
}

function SessionInner({ sessionId, playerId }: { sessionId: string; playerId: string }) {
  const { state, me, lastPlayResult, error, connected, send, setLastPlayResult } = useSession(
    sessionId,
    playerId,
  );

  if (!state) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="text-fg/60">Connecting… {error && <span className="text-err">({error})</span>}</div>
      </div>
    );
  }

  // Route based on state shape
  if (state.game?.phase === 'ended') {
    return (
      <GameOver
        state={state}
        meId={playerId}
        onRematch={() => send('session:ready')}
      />
    );
  }
  if (state.game) return <Game state={state} meId={playerId} send={send} lastPlayResult={lastPlayResult} setLastPlayResult={setLastPlayResult} />;
  if (state.draft) return <Draft state={state} meId={playerId} send={send} />;
  if (state.coin_result) return <CoinFlip state={state} meId={playerId} />;
  return <Lobby state={state} meId={playerId} send={send} />;
}