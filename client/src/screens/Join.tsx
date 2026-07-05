import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { joinSession } from '../api/http.js';
import FlashHeader from '../components/FlashHeader.js';

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
      localStorage.setItem(`gridiron:auth_token:${sessionId.trim()}`, r.auth_token);
      localStorage.setItem(`gridiron:player_name:${sessionId.trim()}`, name.trim());
      navigate(`/session/${sessionId.trim()}`);
    } catch (err) {
      alert((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-4 md:p-8 relative">
      <FlashHeader title="JOIN GAME" kicker="Step 1 of 3" star="🤝" />
      <form
        onSubmit={handleSubmit}
        className="panel-flash max-w-md w-full space-y-4"
      >
        <div className="panel-titlebar">
          <span>Got an invite?</span>
          <span className="text-xs">Required</span>
        </div>
        <label className="block">
          <span className="block text-sm font-bold mb-1">Session ID</span>
          <input
            type="text"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="input-flash"
            placeholder="abc123xyz"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="block text-sm font-bold mb-1">Display name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-flash"
            maxLength={24}
            placeholder="e.g. Penalty Flag"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !sessionId.trim() || !name.trim()}
          className="btn-flash btn-xtra btn-cool w-full"
        >
          {busy ? 'Joining…' : 'Suit Up! →'}
        </button>
      </form>
    </div>
  );
}
