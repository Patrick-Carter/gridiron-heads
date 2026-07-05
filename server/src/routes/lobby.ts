// GET /api/lobby — public-facing list of public sessions.
//
// Two sections in the response:
//
//   "open"  — public sessions still in the lobby phase (1 player, waiting
//             for an opponent to join). Includes a join_url the client can
//             POST against. These are joinable.
//
//   "live"  — public sessions currently in draft/in_game/ended. Exposes the
//             live score + player names so anyone can see who's winning.
//             Not joinable (session_full) — read-only listing.
//
// Visibility rules:
//   - Private sessions (is_public !== true) never appear.
//   - vs-CPU games can never be public (sessions.ts POST /).
//   - Stale public sessions whose in-memory room has been reaped and whose
//     DB row already shows 2 players are skipped — they look like open
//     lobbies to anyone browsing, but the host already finished/started.
//   - Sessions whose host disconnected and whose room TTL hasn't expired
//     still appear so the 2nd player can find them again.
//
// Rate-limited separately from /api/sessions/* because the polling client
// hits this endpoint ~4s/second while a tab is open on the lobby browser.

import { Router } from 'express';
import type { Database } from 'better-sqlite3';
import { getRoom, listRoomIds } from '../rooms.js';

interface LobbyPlayer {
  id: string;
  name: string;
}

interface OpenLobbyEntry {
  session_id: string;
  phase: 'lobby';
  host: LobbyPlayer;
  created_at: number;
  join_url: string;
}

interface LiveGameEntry {
  session_id: string;
  phase: 'draft' | 'in_game' | 'ended';
  players: LobbyPlayer[];
  scores: [number, number];
  updated_at: number;
}

export interface LobbyResponse {
  open: OpenLobbyEntry[];
  live: LiveGameEntry[];
  generated_at: number;
}

interface SessionRow {
  id: string;
  created_at: number;
  last_activity_at: number;
  state: string;
}

export function lobbyRouter(db: Database): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    // Read all public sessions ordered by most-recent activity. Bound the
    // scan to a reasonable number — the lobby list is a UI surface, not a
    // search engine.
    const rows = db
      .prepare(
        `SELECT id, created_at, last_activity_at, state
           FROM sessions
          WHERE json_extract(state, '$.is_public') = 1
          ORDER BY last_activity_at DESC
          LIMIT 200`,
      )
      .all() as SessionRow[];

    // Pre-index in-memory rooms by session_id so the per-row overlay is O(1).
    const liveRoomIds = new Set(listRoomIds());
    const roomById = new Map<string, ReturnType<typeof getRoom>>();
    for (const sid of liveRoomIds) {
      const r = getRoom(sid);
      if (r) roomById.set(sid, r);
    }

    const open: OpenLobbyEntry[] = [];
    const live: LiveGameEntry[] = [];

    for (const row of rows) {
      let parsed: any;
      try {
        parsed = JSON.parse(row.state);
      } catch {
        // Corrupt state row — skip rather than 500 the whole list.
        continue;
      }
      if (!parsed || parsed.is_public !== true) continue;
      const players: LobbyPlayer[] = Array.isArray(parsed.players)
        ? parsed.players
            .filter((p: any) => p && typeof p.id === 'string' && typeof p.name === 'string')
            .map((p: any) => ({ id: p.id, name: p.name }))
        : [];

      const room = roomById.get(row.id);

      if (room) {
        // In-memory room is the live source of truth.
        if (room.game) {
          // A room.game exists ⇢ the draft has started. Show as live.
          // (GameState.phase covers awaiting_schemes/…/play_anim/…/ended;
          // there's no literal 'in_game' in GamePhase — see shared/types.ts.)
          const phase = room.game.phase;
          const labelPhase: 'draft' | 'in_game' | 'ended' =
            phase === 'ended' ? 'ended' : 'in_game';
          live.push({
            session_id: row.id,
            phase: labelPhase,
            players: room.players.map((p) => ({
              id: p.id,
              name: p.name,
            })),
            scores: room.game.scores,
            updated_at: room.last_activity_at,
          });
          continue;
        }
        if (room.players.length < 2) {
          // Lobby-phase room still waiting for an opponent.
          const host = room.players[0];
          if (host) {
            open.push({
              session_id: row.id,
              phase: 'lobby',
              host: { id: host.id, name: host.name },
              created_at: row.created_at,
              join_url: `/join/${row.id}`,
            });
          }
          continue;
        }
        // 2 players in the room but no game started (still in lobby phase).
        // Show as live so we don't leak joinable links.
        live.push({
          session_id: row.id,
          phase: 'in_game',
          players: room.players.map((p) => ({ id: p.id, name: p.name })),
          scores: [0, 0],
          updated_at: room.last_activity_at,
        });
        continue;
      }

      // No in-memory room. The DB row may still describe a joinable open
      // lobby (host alone, before anyone connected via WS).
      if (players.length === 1 && parsed.phase === 'lobby') {
        open.push({
          session_id: row.id,
          phase: 'lobby',
          host: players[0],
          created_at: row.created_at,
          join_url: `/join/${row.id}`,
        });
        continue;
      }
      // 2 players but no in-memory room → server restart mid-game, stale.
      // Hide so the lobby list doesn't show ghost rooms. The players can
      // still reconnect via WS — the DB will re-hydrate the room.
    }

    const out: LobbyResponse = {
      open,
      live,
      generated_at: Date.now(),
    };
    res.json(out);
  });

  return router;
}