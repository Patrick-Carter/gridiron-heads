import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSession } from '../api/http.js';
import FlashHeader from '../components/FlashHeader.js';

type Mode = 'cpu' | 'friend';

export default function Create() {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<Mode>('cpu');
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await createSession(name.trim(), mode === 'cpu', isPublic);
      localStorage.setItem(`gridiron:player_id:${r.session_id}`, r.player_id);
      localStorage.setItem(`gridiron:auth_token:${r.session_id}`, r.auth_token);
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

        {/* Mode picker — two big chunky buttons so it reads at a glance. */}
        <div>
          <span className="block text-sm font-bold mb-1">Opponent</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('cpu')}
              data-testid="mode-cpu"
              className={`btn-flash btn-xtra ${mode === 'cpu' ? 'btn-primary' : 'btn-ghost'}`}
            >
              🤖 vs CPU
            </button>
            <button
              type="button"
              onClick={() => setMode('friend')}
              data-testid="mode-friend"
              className={`btn-flash btn-xtra ${mode === 'friend' ? 'btn-cool' : 'btn-ghost'}`}
            >
              🤝 vs Friend
            </button>
          </div>
          <div className="text-xs text-ink/70 mt-2 text-center">
            {mode === 'cpu'
              ? 'You\'ll face the CPU Bot 🤖 — solo play, no waiting.'
              : 'You\'ll get a share URL to send to your friend.'}
          </div>
        </div>

        {/* Public toggle — friend mode only. A public game is listed in the
            shared lobby so anyone can find + join it (and watch the score
            once it starts). vs-CPU games don't have an opponent to attract
            so the toggle is hidden. */}
        {mode === 'friend' && (
          <div>
            <label className="flex items-start gap-2 cursor-pointer select-none border-3 border-ink bg-cream p-2"
                   style={{ borderWidth: 3, borderColor: '#0a0a18', background: '#fff8dc' }}>
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                data-testid="public-toggle"
                className="mt-1 h-5 w-5 accent-lime cursor-pointer"
              />
              <div>
                <div className="text-sm font-bold">
                  📡 List in public lobby
                </div>
                <div className="text-xs text-ink/70 mt-0.5">
                  Anyone can find and join this game. Once it starts, the live
                  score is visible to other browsers too.
                </div>
              </div>
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="btn-flash btn-xtra btn-primary w-full"
        >
          {busy ? 'Creating…' : 'Hut! Hut! Hut! →'}
        </button>
      </form>
    </div>
  );
}