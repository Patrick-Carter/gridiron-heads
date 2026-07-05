import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSession } from '../api/http.js';

export default function Create() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await createSession(name.trim());
      // persist player_id so Lobby can use it after refresh
      localStorage.setItem(`gridiron:player_id:${r.session_id}`, r.player_id);
      localStorage.setItem(`gridiron:player_name:${r.session_id}`, name.trim());
      navigate(`/session/${r.session_id}`);
    } catch (err) {
      alert((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-8">
      <form onSubmit={handleSubmit} className="max-w-md w-full space-y-4">
        <h2 className="text-2xl font-bold text-accent">Create Game</h2>
        <label className="block">
          <span className="text-fg/80 text-sm">Display name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full bg-panel border border-border rounded px-3 py-2 text-fg focus:outline-none focus:border-accent"
            maxLength={24}
            autoFocus
          />
        </label>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="w-full bg-accent text-bg font-bold py-3 rounded hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
      </form>
    </div>
  );
}