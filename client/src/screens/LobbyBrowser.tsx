// Public lobby browser — lists public sessions that are open for joining,
// plus public games in progress with their live score. Polls every 4s.

import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  fetchLobby,
  joinSession,
  type LobbyOpenEntry,
  type LobbyLiveEntry,
} from '../api/http.js';
import FlashHeader from '../components/FlashHeader.js';

const POLL_MS = 4000;

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; open: LobbyOpenEntry[]; live: LobbyLiveEntry[]; generatedAt: number }
  | { kind: 'error'; message: string };

function formatAge(ms_ago: number): string {
  const sec = Math.max(0, Math.round(ms_ago / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

function phaseLabel(phase: LobbyLiveEntry['phase']): string {
  switch (phase) {
    case 'draft': return 'Drafting';
    case 'in_game': return 'In Game';
    case 'ended': return 'Final';
  }
}

export default function LobbyBrowser() {
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [name, setName] = useState('');
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const r = await fetchLobby();
      setState({ kind: 'ready', open: r.open, live: r.live, generatedAt: r.generated_at });
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Tick the "x seconds ago" labels every second without re-fetching.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function handleJoin(entry: LobbyOpenEntry) {
    if (!name.trim()) {
      alert('Pick a display name first.');
      return;
    }
    setJoiningId(entry.session_id);
    try {
      const r = await joinSession(entry.session_id, name.trim());
      localStorage.setItem(`gridiron:player_id:${entry.session_id}`, r.player_id);
      localStorage.setItem(`gridiron:auth_token:${entry.session_id}`, r.auth_token);
      localStorage.setItem(`gridiron:player_name:${entry.session_id}`, name.trim());
      navigate(`/session/${entry.session_id}`);
    } catch (err) {
      alert((err as Error).message);
      setJoiningId(null);
    }
  }

  const open = state.kind === 'ready' ? state.open : [];
  const live = state.kind === 'ready' ? state.live : [];
  const totalCount = open.length + live.length;

  return (
    <div className="min-h-full p-4 md:p-8 max-w-2xl mx-auto relative">
      <FlashHeader title="PUBLIC LOBBY" kicker="Find a game" star="📡" />

      <div className="panel-flash space-y-3">
        <div className="panel-titlebar">
          <span>Display name</span>
          <span className="text-xs">Required to join</span>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input-flash"
          maxLength={24}
          placeholder="e.g. Blitz McClutch"
          data-testid="lobby-name"
          autoFocus
        />
        <div className="text-xs text-ink/70 text-center">
          Saved locally — only used when you click <strong>Join</strong>.
        </div>
      </div>

      <div className="panel-flash space-y-3 mt-4">
        <div className="panel-titlebar">
          <span>Open Lobbies ({open.length})</span>
          <span className="text-xs">Waiting for opponent</span>
        </div>
        {state.kind === 'loading' && (
          <div className="text-center text-ink/60 py-4 animate-pulse">Scanning…</div>
        )}
        {state.kind === 'error' && (
          <div className="text-center text-err py-4">
            {state.message}{' '}
            <button onClick={load} className="btn-flash btn-cool !min-h-0 !py-1 !px-3 text-xs">
              Retry
            </button>
          </div>
        )}
        {state.kind === 'ready' && open.length === 0 && (
          <div className="text-center text-ink/60 py-4">
            No public games waiting right now.
            <div className="mt-2">
              <Link to="/create" className="btn-flash btn-primary !min-h-0 !py-1.5 !px-3 text-sm">
                Be the first →
              </Link>
            </div>
          </div>
        )}
        <ul className="space-y-2">
          {open.map((e) => {
            const joining = joiningId === e.session_id;
            return (
              <li
                key={e.session_id}
                data-testid={`lobby-open-${e.session_id}`}
                className="flex items-center justify-between border-3 border-ink bg-cream px-3 py-2 gap-3"
                style={{ borderWidth: 3, borderColor: '#0a0a18', background: '#fff8dc' }}
              >
                <div className="min-w-0">
                  <div className="font-bold truncate">
                    {e.host.name}{' '}
                    <span className="sticker !text-xs">HOST</span>
                  </div>
                  <div className="text-xs text-ink/70">
                    Code <code className="font-pixel">{e.session_id}</code> ·{' '}
                    opened {formatAge(now - e.created_at)}
                  </div>
                </div>
                <button
                  onClick={() => handleJoin(e)}
                  disabled={joining || !name.trim()}
                  data-testid={`lobby-join-${e.session_id}`}
                  className="btn-flash btn-go shrink-0 text-sm !min-h-0 py-2"
                >
                  {joining ? 'Joining…' : 'Join ⚡'}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="panel-flash space-y-3 mt-4">
        <div className="panel-titlebar">
          <span>Live Now ({live.length})</span>
          <span className="text-xs">Public scores</span>
        </div>
        {state.kind === 'ready' && live.length === 0 && (
          <div className="text-center text-ink/60 py-2">
            No public games in progress.
          </div>
        )}
        <ul className="space-y-2">
          {live.map((g) => {
            const [p1, p2] = g.players;
            const [s1, s2] = g.scores;
            const isFinal = g.phase === 'ended';
            const leaderIdx: 0 | 1 | null =
              isFinal && g.winner_idx !== undefined
                ? g.winner_idx
                : s1 === s2 ? null : s1 > s2 ? 0 : 1;
            return (
              <li
                key={g.session_id}
                data-testid={`lobby-live-${g.session_id}`}
                className="border-3 border-ink bg-cream px-3 py-2"
                style={{ borderWidth: 3, borderColor: '#0a0a18', background: '#fff8dc' }}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span
                    className={`chip !text-xs ${isFinal ? '!bg-warn !text-ink' : '!bg-cool !text-ink'}`}
                  >
                    {phaseLabel(g.phase)}
                  </span>
                  <span className="text-xs text-ink/60">
                    {formatAge(now - g.updated_at)}
                  </span>
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <ScoreColumn
                    name={p1?.name ?? '?'}
                    score={s1}
                    isLeader={leaderIdx === 0}
                    align="right"
                  />
                  <span className="font-black text-ink/60 text-sm">vs</span>
                  <ScoreColumn
                    name={p2?.name ?? '?'}
                    score={s2}
                    isLeader={leaderIdx === 1}
                    align="left"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="text-center text-xs text-cream/60 mt-4">
        {state.kind === 'ready' ? (
          <>
            {totalCount === 0
              ? 'Quiet night — start one yourself!'
              : `${totalCount} public game${totalCount === 1 ? '' : 's'} visible.`}{' '}
            Refreshes every {POLL_MS / 1000}s.
          </>
        ) : null}
      </div>

      <div className="text-center mt-3">
        <Link to="/" className="text-accent text-sm underline">
          ← back home
        </Link>
      </div>
    </div>
  );
}

function ScoreColumn({
  name,
  score,
  isLeader,
  align,
}: {
  name: string;
  score: number;
  isLeader: boolean;
  align: 'left' | 'right';
}) {
  return (
    <div className={`flex flex-col ${align === 'right' ? 'items-end' : 'items-start'}`}>
      <div className="text-xs font-bold text-ink/80 truncate max-w-full">
        {name}
        {isLeader && <span className="sticker !text-[10px] ml-1">★</span>}
      </div>
      <div className="text-2xl md:text-3xl font-black text-ink leading-none">
        {score.toFixed(1)}
      </div>
    </div>
  );
}
