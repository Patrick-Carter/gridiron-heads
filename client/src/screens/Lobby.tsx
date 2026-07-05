import { useState } from 'react';
import { EVENTS } from '../api/socket.js';
import type { SessionSnapshot } from '../hooks/useSession.js';
import FlashHeader from '../components/FlashHeader.js';

export default function Lobby({
  state,
  meId,
  send,
}: {
  state: SessionSnapshot;
  meId: string;
  send: (event: string, payload?: any) => void;
}) {
  const me = state.players.find((p) => p.id === meId);
  const isFull = state.players.length === 2;
  const iAmReady = me?.ready ?? false;
  const hasCpu = state.players.some((p: any) => p.is_cpu === true);
  const [copied, setCopied] = useState(false);

  function copyShareUrl() {
    const url = `${window.location.origin}/join/${state.session_id}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="min-h-full p-4 md:p-8 max-w-2xl mx-auto relative">
      <FlashHeader title="THE LOCKER ROOM" kicker="Step 2 of 3" star="🏈" />

      {!hasCpu && (
        <div className="panel-flash space-y-4">
          <div className="panel-titlebar">
            <span>Share with your opponent!</span>
            <span className="text-xs">Lobby</span>
          </div>
          <div>
            <div className="text-sm font-bold mb-1">Session ID</div>
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
              <code className="input-flash !w-auto flex-1 text-center font-pixel tracking-wider">
                {state.session_id}
              </code>
              <button
                onClick={copyShareUrl}
                className="btn-flash btn-cool"
              >
                {copied ? 'Copied! ✓' : 'Copy Share URL'}
              </button>
            </div>
          </div>
        </div>
      )}

      {hasCpu && (
        <div className="panel-flash space-y-3 mt-4">
          <div className="panel-titlebar">
            <span>Match set!</span>
            <span className="text-xs">vs CPU Bot</span>
          </div>
          <div className="text-base text-center font-bold">
            🤖 Your opponent is the <span className="chip !bg-grape !text-cream">CPU Bot</span> — solo play.
          </div>
          <div className="text-xs text-center text-ink/70">
            The CPU drafts itself and runs the ball on its own turns. You just play your side.
          </div>
        </div>
      )}

      <div className="panel-flash space-y-3 mt-4">
        <div className="panel-titlebar">
          <span>Players ({state.players.length}/2)</span>
          <span className="text-xs">2 needed</span>
        </div>
        <ul className="space-y-2">
          {state.players.map((p) => {
            const isCpu = (p as any).is_cpu === true;
            return (
              <li
                key={p.id}
                className="flex items-center justify-between border-3 border-ink bg-cream px-3 py-2"
                style={{ borderWidth: 3, borderColor: '#0a0a18', background: '#fff8dc' }}
              >
                <span className="font-bold flex items-center gap-2">
                  {isCpu && <span className="sticker !text-xs">🤖 CPU</span>}
                  {p.name}{' '}
                  {p.id === meId && <span className="sticker">YOU</span>}
                </span>
                <span className={p.ready ? 'chip !bg-lime' : 'chip !bg-warn !text-ink'}>
                  {p.ready ? 'READY ✓' : '… waiting'}
                </span>
              </li>
            );
          })}
        </ul>
        {!isFull && (
          <div className="text-center font-bold text-maroon animate-pulse">
            Waiting for opponent to enter the locker room…
          </div>
        )}
      </div>

      {isFull && !iAmReady && (
        <button
          onClick={() => send(EVENTS.SESSION_READY)}
          className="btn-flash btn-xtra btn-go w-full mt-4"
        >
          I'm Ready! 🏈
        </button>
      )}
      {isFull && iAmReady && (
        <div className="text-center font-bold text-cream mt-4 animate-pulse">
          Waiting for opponent to ready up…
        </div>
      )}
    </div>
  );
}
