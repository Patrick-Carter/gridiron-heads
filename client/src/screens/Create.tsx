import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSession } from '../api/http.js';
import FlashHeader from '../components/FlashHeader.js';

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
      localStorage.setItem(`gridiron:player_id:${r.session_id}`, r.player_id);
      localStorage.setItem(`gridiron:player_name:${r.session_id}`, name.trim());
      navigate(`/session/${r.session_id}`);
    } catch (err) {
      alert((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-4 md:p-8 relative">
      <FlashHeader title="CREATE GAME" kicker="Step 1 of 3" star="🏈" />
      <form
        onSubmit={handleSubmit}
        className="panel-flash max-w-md w-full space-y-4"
      >
        <div className="panel-titlebar">
          <span>Pick a name, champ</span>
          <span className="text-xs">Required</span>
        </div>
        <label className="block">
          <span className="block text-sm font-bold mb-1">Display name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-flash"
            maxLength={24}
            placeholder="e.g. Tom Terrific"
            autoFocus
          />
        </label>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="btn-flash btn-xtra btn-primary w-full"
        >
          {busy ? 'Creating…' : 'Hut! Hut! Hut! →'}
        </button>
        <div className="text-xs text-center text-ink/70">
          You'll get a share URL to send to your opponent.
        </div>
      </form>
    </div>
  );
}
