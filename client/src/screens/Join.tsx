import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { joinSession } from '../api/http.js';

export default function Join() {
  const params = useParams();
  const [sessionId, setSessionId] = useState(params.sessionId ?? '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId.trim() || !name.trim()) return;
    setBusy(true);
    try {
      const r = await joinSession(sessionId.trim(), name.trim());
      localStorage.setItem(`gridiron:player_id:${sessionId.trim()}`, r.player_id);
      navigate(`/session/${sessionId.trim()}`);
    } catch (err) {
      alert((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-8">
      <form onSubmit={handleSubmit} className="max-w-md w-full space-y-4">
        <h2 className="text-2xl font-bold text-accent">Join Game</h2>
        <label className="block">
          <span className="text-fg/80 text-sm">Session ID</span>
          <input
            type="text"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="mt-1 block w-full bg-panel border border-border rounded px-3 py-2 text-fg focus:outline-none focus:border-accent"
            maxLength={24}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="text-fg/80 text-sm">Display name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full bg-panel border border-border rounded px-3 py-2 text-fg focus:outline-none focus:border-accent"
            maxLength={24}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !sessionId.trim() || !name.trim()}
          className="w-full bg-accent text-bg font-bold py-3 rounded hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Joining…' : 'Join'}
        </button>
      </form>
    </div>
  );
}