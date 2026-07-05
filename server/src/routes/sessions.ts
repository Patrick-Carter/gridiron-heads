import { Router } from 'express';
import { nanoid } from 'nanoid';
import type { Database } from 'better-sqlite3';

export interface SessionState {
  phase: 'lobby' | 'coin' | 'draft' | 'in_game' | 'ended';
  players: { id: string; name: string; ready: boolean; is_cpu?: boolean }[];
  coin_result?: 'heads' | 'tails';
  first_possession_id?: string;
}

export const CPU_PLAYER_ID = 'cpu';
export const CPU_PLAYER_NAME = 'CPU Bot';

export function sessionsRouter(db: Database): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const display_name = (req.body?.display_name ?? '').trim();
    const vs_cpu = !!req.body?.vs_cpu;
    if (!display_name) {
      return res.status(400).json({ error: 'display_name required' });
    }
    const session_id = nanoid(8);
    const player_id = nanoid(12);
    const now = Date.now();
    const state: SessionState = {
      phase: 'lobby',
      players: [{ id: player_id, name: display_name, ready: vs_cpu ? true : false }],
    };
    if (vs_cpu) {
      // Seed the CPU into the persisted state so a page-reload + rehydrate
      // sees both players and the existing 2-player logic keeps working.
      state.players.push({
        id: CPU_PLAYER_ID,
        name: CPU_PLAYER_NAME,
        ready: true,
        is_cpu: true,
      });
    }
    db.prepare(
      'INSERT INTO sessions (id, created_at, last_activity_at, state) VALUES (?, ?, ?, ?)',
    ).run(session_id, now, now, JSON.stringify(state));
    db.prepare(
      'INSERT INTO session_players (session_id, player_id, display_name, joined_at) VALUES (?, ?, ?, ?)',
    ).run(session_id, player_id, display_name, now);
    res.json({
      session_id,
      player_id,
      share_url: vs_cpu ? null : `/join/${session_id}`,
      state,
    });
  });

  router.post('/:id/join', (req, res) => {
    const session_id = req.params.id;
    const display_name = (req.body?.display_name ?? '').trim();
    if (!display_name) {
      return res.status(400).json({ error: 'display_name required' });
    }
    const row = db
      .prepare('SELECT state FROM sessions WHERE id = ?')
      .get(session_id) as { state: string } | undefined;
    if (!row) return res.status(404).json({ error: 'not_found' });
    const state: SessionState = JSON.parse(row.state);
    // vs-CPU rooms are locked — only the host can rejoin their own session.
    const hasCpu = state.players.some((p) => p.is_cpu || p.id === CPU_PLAYER_ID);
    if (hasCpu) {
      return res.status(409).json({ error: 'vs_cpu_locked' });
    }
    if (state.players.length >= 2) {
      return res.status(409).json({ error: 'session_full' });
    }
    const player_id = nanoid(12);
    state.players.push({ id: player_id, name: display_name, ready: false });
    const now = Date.now();
    db.prepare('UPDATE sessions SET state = ?, last_activity_at = ? WHERE id = ?').run(
      JSON.stringify(state),
      now,
      session_id,
    );
    db.prepare(
      'INSERT INTO session_players (session_id, player_id, display_name, joined_at) VALUES (?, ?, ?, ?)',
    ).run(session_id, player_id, display_name, now);
    res.json({ player_id, state });
  });

  router.get('/:id', (req, res) => {
    const row = db
      .prepare('SELECT state FROM sessions WHERE id = ?')
      .get(req.params.id) as { state: string } | undefined;
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ state: JSON.parse(row.state) });
  });

  return router;
}