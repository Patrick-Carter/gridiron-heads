import { Router } from 'express';
import { nanoid } from 'nanoid';
import type { Database } from 'better-sqlite3';
import {
  normalizeDisplayName,
  lookupAuthToken,
  issueAuthToken,
} from '../security.js';

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
    const display_name = normalizeDisplayName(req.body?.display_name);
    const vs_cpu = !!req.body?.vs_cpu;
    if (!display_name) {
      return res.status(400).json({ error: 'invalid_display_name' });
    }
    const session_id = nanoid(8);
    const player_id = nanoid(12);
    const auth_token = nanoid(32);
    const now = Date.now();
    const state: SessionState = {
      phase: 'lobby',
      players: [{ id: player_id, name: display_name, ready: vs_cpu ? true : false }],
    };
    if (vs_cpu) {
      state.players.push({
        id: CPU_PLAYER_ID,
        name: CPU_PLAYER_NAME,
        ready: true,
        is_cpu: true,
      });
    }
    // Single best-effort tx: insert session row, player row, and bind a
    // freshly-issued auth token in one go. better-sqlite3 transactions are
    // synchronous so a partial failure can't desync the DB.
    const insertTxn = db.transaction(() => {
      db.prepare(
        'INSERT INTO sessions (id, created_at, last_activity_at, state) VALUES (?, ?, ?, ?)',
      ).run(session_id, now, now, JSON.stringify(state));
      db.prepare(
        'INSERT INTO session_players (session_id, player_id, display_name, joined_at) VALUES (?, ?, ?, ?)',
      ).run(session_id, player_id, display_name, now);
      issueAuthToken(db, session_id, player_id, auth_token);
    });
    insertTxn();
    res.json({
      session_id,
      player_id,
      auth_token,
      share_url: vs_cpu ? null : `/join/${session_id}`,
      state,
    });
  });

  router.post('/:id/join', (req, res) => {
    const session_id = req.params.id;
    if (typeof session_id !== 'string' || session_id.length > 64) {
      return res.status(400).json({ error: 'invalid_session_id' });
    }
    const display_name = normalizeDisplayName(req.body?.display_name);
    if (!display_name) {
      return res.status(400).json({ error: 'invalid_display_name' });
    }
    const row = db
      .prepare('SELECT state FROM sessions WHERE id = ?')
      .get(session_id) as { state: string } | undefined;
    if (!row) return res.status(404).json({ error: 'not_found' });
    const state: SessionState = JSON.parse(row.state);
    const hasCpu = state.players.some((p) => p.is_cpu || p.id === CPU_PLAYER_ID);
    if (hasCpu) {
      return res.status(409).json({ error: 'vs_cpu_locked' });
    }
    if (state.players.length >= 2) {
      return res.status(409).json({ error: 'session_full' });
    }
    const player_id = nanoid(12);
    const auth_token = nanoid(32);
    state.players.push({ id: player_id, name: display_name, ready: false });
    const now = Date.now();
    const joinTxn = db.transaction(() => {
      db.prepare(
        'UPDATE sessions SET state = ?, last_activity_at = ? WHERE id = ?',
      ).run(JSON.stringify(state), now, session_id);
      db.prepare(
        'INSERT INTO session_players (session_id, player_id, display_name, joined_at) VALUES (?, ?, ?, ?)',
      ).run(session_id, player_id, display_name, now);
      issueAuthToken(db, session_id, player_id, auth_token);
    });
    joinTxn();
    res.json({ player_id, auth_token, state });
  });

  router.get('/:id', (req, res) => {
    const session_id = req.params.id;
    if (typeof session_id !== 'string' || session_id.length > 64) {
      return res.status(400).json({ error: 'invalid_session_id' });
    }
    const row = db
      .prepare('SELECT state FROM sessions WHERE id = ?')
      .get(session_id) as { state: string } | undefined;
    if (!row) return res.status(404).json({ error: 'not_found' });
    const state: SessionState = JSON.parse(row.state);

    // Bearer-token gate. Participants get the full state; everyone else
    // gets a stripped-down summary that doesn't expose names, draft
    // choices, scores, or play history.
    const authHeader = (req.headers.authorization ?? '').replace(
      /^Bearer\s+/i,
      '',
    );
    const lookup = lookupAuthToken(db, authHeader, session_id);
    if (!lookup.ok) {
      return res.json({
        state: {
          phase: state.phase,
          players: state.players.map((p) => ({ id: p.id, ready: p.ready })),
          session_id,
        },
      });
    }
    res.json({ state });
  });

  return router;
}
