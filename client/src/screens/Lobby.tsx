import { useState } from 'react';
import { EVENTS } from '../api/socket.js';
import type { SessionSnapshot } from '../hooks/useSession.js';

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
  const [copied, setCopied] = useState(false);

  function copyShareUrl() {
    const url = `${window.location.origin}/join/${state.session_id}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="min-h-full p-8 max-w-2xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-accent">Lobby</h2>
      <div className="bg-panel border border-border rounded p-4 space-y-2">
        <div className="text-fg/60 text-sm">Session ID</div>
        <div className="flex gap-2 items-center">
          <code className="bg-bg border border-border px-2 py-1 rounded text-fg">
            {state.session_id}
          </code>
          <button
            onClick={copyShareUrl}
            className="text-sm px-3 py-1 border border-border rounded hover:bg-bg"
          >
            {copied ? 'Copied!' : 'Copy share URL'}
          </button>
        </div>
      </div>

      <div className="bg-panel border border-border rounded p-4 space-y-3">
        <h3 className="text-lg font-bold">Players ({state.players.length}/2)</h3>
        <ul className="space-y-2">
          {state.players.map((p) => (
            <li key={p.id} className="flex items-center justify-between">
              <span className="text-fg">{p.name} {p.id === meId && <span className="text-fg/40">(you)</span>}</span>
              <span className={p.ready ? 'text-ok' : 'text-fg/40'}>{p.ready ? '✓ Ready' : '…'}</span>
            </li>
          ))}
        </ul>
        {!isFull && (
          <div className="text-warn animate-pulse">Waiting for opponent…</div>
        )}
      </div>

      {isFull && !iAmReady && (
        <button
          onClick={() => send(EVENTS.SESSION_READY)}
          className="w-full bg-accent text-bg font-bold py-3 rounded hover:opacity-90"
        >
          Ready
        </button>
      )}
      {isFull && iAmReady && (
        <div className="text-center text-fg/60">
          Waiting for opponent to ready up…
        </div>
      )}
    </div>
  );
}