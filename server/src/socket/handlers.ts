// Socket.IO handlers — wire client events to the server-side state machine.
import type { Server as IOServer, Socket } from 'socket.io';
import type { Database } from 'better-sqlite3';
import {
  newRoom,
  addPlayer,
  setReady,
  allReady,
  flipCoin,
  startDraft,
  draftPick,
  startGame,
  resolveCurrentPlay,
  snapshot,
  clearSchemes,
  isValidAudibleSub,
} from './game_machine.js';
import { tickCpu, CPU_PLAYER_ID } from './cpu.js';
import { TOTAL_PICKS } from '@gridiron/shared';
import type { Play, PlaySub } from '@gridiron/shared';
import { getRoom, hasRoom, setRoom, touchRoom } from '../rooms.js';
import { lookupAuthToken } from '../security.js';

interface SocketData {
  session_id?: string;
  player_id?: string;
}

interface JoinPayload {
  session_id: string;
  /**
   * Opaque auth token issued by POST /api/sessions or /join. The server
   * resolves it to (session_id, player_id) on every join — `player_id`
   * from the client alone is no longer trusted.
   */
  auth_token: string;
  /** Display-name update (REFRESH). Optional. Server does not store
   *  untrusted strings; only used to repaint existing names in the room. */
  display_name?: string;
}

function broadcast(io: IOServer, session_id: string, room: import('./game_machine.js').RoomState): void {
  io.to(`session:${session_id}`).emit('session:state', snapshot(room));
  tickCpu(io, room);
}

function rejectAuth(socket: Socket, reason: string): void {
  socket.emit('session:error', { error: reason });
}

export function registerSocketHandlers(io: IOServer, db: Database): void {
  io.on('connection', (socket: Socket) => {
    const sdata: SocketData = (socket.data ||= {});

    socket.on('session:join', (raw: JoinPayload) => {
      const { session_id, auth_token } = raw || ({} as JoinPayload);
      if (typeof session_id !== 'string' || session_id.length > 64) {
        rejectAuth(socket, 'invalid_session_id');
        return;
      }
      const lookup = lookupAuthToken(db, auth_token, session_id);
      if (!lookup.ok) {
        rejectAuth(socket, lookup.reason ?? 'unknown_token');
        return;
      }
      const { player_id } = lookup as { session_id: string; player_id: string };

      // Hydrate room from DB if not in memory.
      let room = getRoom(session_id);
      if (!room) {
        const row = db
          .prepare('SELECT state FROM sessions WHERE id = ?')
          .get(session_id) as { state: string } | undefined;
        if (!row) {
          rejectAuth(socket, 'not_found');
          return;
        }
        const persistedState = JSON.parse(row.state);
        const host = persistedState.players[0];
        const guest = persistedState.players[1];
        if (!host) {
          rejectAuth(socket, 'no_host');
          return;
        }
        const cpuId = guest?.is_cpu || guest?.id === CPU_PLAYER_ID ? guest.id : null;
        room = newRoom(session_id, host.id, host.name, {
          cpu_player_id: cpuId ?? undefined,
        });
        room.players = persistedState.players;
        room.guest_id = guest?.id ?? null;
        setRoom(session_id, room);
      }
      sdata.session_id = session_id;
      sdata.player_id = player_id;
      socket.join(`session:${session_id}`);

      const existing = room.players.find((p) => p.id === player_id);
      if (!existing) {
        // Token validates, but the in-memory room doesn't have this player.
        // This happens when a 2nd player joins via HTTP /api/sessions/:id/join
        // (which only writes the DB row + token) before they connect via WS —
        // the in-memory room was already populated by the host's prior WS
        // join and hasn't been refreshed. The auth_token IS the proof of
        // identity; pull the display name from session_players and add them
        // in. A valid token with no DB row would mean a stale token, which
        // we still reject.
        const spRow = db
          .prepare(
            'SELECT display_name FROM session_players WHERE session_id = ? AND player_id = ?',
          )
          .get(session_id, player_id) as { display_name: string } | undefined;
        if (!spRow) {
          rejectAuth(socket, 'not_a_member');
          return;
        }
        const result = addPlayer(room, player_id, spRow.display_name);
        if (!result.ok) {
          rejectAuth(socket, result.reason);
          return;
        }
        // Mirror into DB state.players so the next re-hydration sees them
        // (server restart won't lose their spot in the room).
        const stateRow = db
          .prepare('SELECT state FROM sessions WHERE id = ?')
          .get(session_id) as { state: string } | undefined;
        if (stateRow) {
          const persisted = JSON.parse(stateRow.state);
          if (!persisted.players.some((p: any) => p.id === player_id)) {
            persisted.players.push({
              id: player_id,
              name: spRow.display_name,
              ready: false,
            });
            db.prepare(
              'UPDATE sessions SET state = ?, last_activity_at = ? WHERE id = ?',
            ).run(JSON.stringify(persisted), Date.now(), session_id);
          }
        }
      }
      // Optional display-name refresh — only if valid + non-CPU.
      const player = room.players.find((p) => p.id === player_id)!;
      if (
        typeof raw?.display_name === 'string' &&
        raw.display_name.trim() &&
        raw.display_name.trim().length <= 32 &&
        !player.is_cpu &&
        player.name !== raw.display_name.trim().slice(0, 32)
      ) {
        // Cheap sanitization on the wire only — already validated when the
        // name was originally issued. Don't persist ad-hoc names here; the
        // route POST /api/sessions is the only writer.
        player.name = raw.display_name.trim().slice(0, 32);
      }
      touchRoom(room);
      broadcast(io, session_id, room);
      // CPU rooms boot the game the moment the host reconnects.
      if (room.cpu_player_id && allReady(room) && !room.draft && !room.game) {
        flipCoin(room);
        startDraft(room);
        touchRoom(room);
        broadcast(io, session_id, room);
      }
    });

    socket.on('session:ready', () => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = getRoom(sdata.session_id);
      if (!room) return;
      const player = room.players.find((p) => p.id === sdata.player_id);
      if (!player || player.is_cpu) return;
      setReady(room, sdata.player_id);
      touchRoom(room);
      io.to(`session:${sdata.session_id}`).emit('session:state', snapshot(room));
      if (allReady(room)) {
        flipCoin(room);
        startDraft(room);
        touchRoom(room);
        broadcast(io, sdata.session_id, room);
      }
    });

    socket.on('draft:pick', ({ group, option_id }: { group: string; option_id: string }) => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = getRoom(sdata.session_id);
      if (!room || !room.draft) return;
      if (sdata.player_id === CPU_PLAYER_ID) {
        socket.emit('session:error', { error: 'cpu_id_reserved' });
        return;
      }
      const r = draftPick(room, sdata.player_id, group as any, option_id);
      if (!r.ok) {
        socket.emit('session:error', { error: r.reason });
        return;
      }
      touchRoom(room);
      broadcast(io, sdata.session_id, room);
      if (room.draft.current_turn >= TOTAL_PICKS) {
        const game = startGame(room);
        game.phase = 'awaiting_schemes';
        touchRoom(room);
        broadcast(io, sdata.session_id, room);
      }
    });

    socket.on('game:scheme_pick', ({ parent, sub }: { parent: Play['parent']; sub: Play['sub'] }) => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = getRoom(sdata.session_id);
      if (!room || !room.game) return;
      if (sdata.player_id === CPU_PLAYER_ID) {
        socket.emit('session:error', { error: 'cpu_id_reserved' });
        return;
      }
      const game = room.game;
      if (game.phase !== 'awaiting_schemes') {
        socket.emit('session:error', { error: 'not_awaiting_schemes' });
        return;
      }
      room.pending_schemes[sdata.player_id] = { parent, sub };
      if (Object.keys(room.pending_schemes).length === 2) {
        game.phase = 'ready_to_snap';
      }
      touchRoom(room);
      broadcast(io, sdata.session_id, room);
    });

    socket.on('game:audible', ({ target_sub }: { target_sub: PlaySub }) => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = getRoom(sdata.session_id);
      if (!room || !room.game) return;
      if (sdata.player_id === CPU_PLAYER_ID) {
        socket.emit('session:error', { error: 'cpu_id_reserved' });
        return;
      }
      const game = room.game;
      const player_idx = room.players.findIndex((p) => p.id === sdata.player_id);
      if (player_idx === -1) return;
      if (player_idx !== game.possession_idx) {
        socket.emit('session:error', { error: 'not_offense' });
        return;
      }
      const currentPlay: Play | undefined = room.pending_schemes[sdata.player_id];
      if (!currentPlay) {
        socket.emit('session:error', { error: 'no_current_play' });
        return;
      }
      if (currentPlay.parent === 'punt' || currentPlay.parent === 'fg') {
        socket.emit('session:error', { error: 'no_audible_on_special' });
        return;
      }
      if (!isValidAudibleSub(currentPlay, target_sub)) {
        socket.emit('session:error', { error: 'invalid_audible_sub' });
        return;
      }
      if (game.audibles_used[player_idx] > 0) {
        socket.emit('session:error', { error: 'audible_used' });
        return;
      }
      (game as any)._pending_off_audible = { parent: currentPlay.parent, sub: target_sub };
      game.audibles_used[player_idx]++;
      game.phase = 'awaiting_def_response';
      touchRoom(room);
      broadcast(io, sdata.session_id, room);
    });

    socket.on('game:fake_audible', () => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = getRoom(sdata.session_id);
      if (!room || !room.game) return;
      if (sdata.player_id === CPU_PLAYER_ID) {
        socket.emit('session:error', { error: 'cpu_id_reserved' });
        return;
      }
      const game = room.game;
      const player_idx = room.players.findIndex((p) => p.id === sdata.player_id);
      if (player_idx === -1) return;
      if (player_idx !== game.possession_idx) {
        socket.emit('session:error', { error: 'not_offense' });
        return;
      }
      const currentPlay: Play | undefined = room.pending_schemes[sdata.player_id];
      if (currentPlay && (currentPlay.parent === 'punt' || currentPlay.parent === 'fg')) {
        socket.emit('session:error', { error: 'no_audible_on_special' });
        return;
      }
      if (game.fake_audibles_used[player_idx] > 0) {
        socket.emit('session:error', { error: 'fake_audible_used' });
        return;
      }
      (game as any)._pending_off_fake = true;
      game.fake_audibles_used[player_idx]++;
      game.phase = 'awaiting_def_response';
      touchRoom(room);
      broadcast(io, sdata.session_id, room);
    });

    socket.on('game:def_audible', ({ target_sub }: { target_sub: PlaySub }) => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = getRoom(sdata.session_id);
      if (!room || !room.game) return;
      if (sdata.player_id === CPU_PLAYER_ID) {
        socket.emit('session:error', { error: 'cpu_id_reserved' });
        return;
      }
      const game = room.game;
      const player_idx = room.players.findIndex((p) => p.id === sdata.player_id);
      if (player_idx === -1) return;
      const defIdx = game.possession_idx === 0 ? 1 : 0;
      if (player_idx !== defIdx) {
        socket.emit('session:error', { error: 'not_defense' });
        return;
      }
      if (game.phase !== 'awaiting_def_response') {
        socket.emit('session:error', { error: 'not_awaiting_response' });
        return;
      }
      const currentPlay: Play | undefined = room.pending_schemes[sdata.player_id];
      if (!currentPlay) {
        socket.emit('session:error', { error: 'no_current_play' });
        return;
      }
      if (currentPlay.parent === 'punt' || currentPlay.parent === 'fg') {
        socket.emit('session:error', { error: 'no_audible_on_special' });
        return;
      }
      if (!isValidAudibleSub(currentPlay, target_sub)) {
        socket.emit('session:error', { error: 'invalid_audible_sub' });
        return;
      }
      (game as any)._pending_def_audible = { parent: currentPlay.parent, sub: target_sub };
      game.phase = 'ready_to_snap';
      touchRoom(room);
      broadcast(io, sdata.session_id, room);
    });

    socket.on('game:def_stay', () => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = getRoom(sdata.session_id);
      if (!room || !room.game) return;
      if (sdata.player_id === CPU_PLAYER_ID) {
        socket.emit('session:error', { error: 'cpu_id_reserved' });
        return;
      }
      const game = room.game;
      const player_idx = room.players.findIndex((p) => p.id === sdata.player_id);
      const defIdx = game.possession_idx === 0 ? 1 : 0;
      if (player_idx !== defIdx) return;
      if (game.phase !== 'awaiting_def_response') return;
      (game as any)._pending_def_audible = null;
      game.phase = 'ready_to_snap';
      touchRoom(room);
      broadcast(io, sdata.session_id, room);
    });

    socket.on('game:snap', () => {
      if (!sdata.session_id) return;
      const room = getRoom(sdata.session_id);
      if (!room || !room.game) return;
      if (sdata.player_id === CPU_PLAYER_ID) {
        socket.emit('session:error', { error: 'cpu_id_reserved' });
        return;
      }
      const game = room.game;
      if (game.phase !== 'ready_to_snap') return;
      const seed = Math.floor(Math.random() * 2 ** 32);
      const { result } = resolveCurrentPlay(room, seed);
      const gameEnded = (game.phase as string) === 'ended';
      if (!gameEnded) game.phase = 'play_anim';
      touchRoom(room);
      io.to(`session:${sdata.session_id}`).emit('play:result', { result });
      broadcast(io, sdata.session_id, room);
      if (gameEnded) return;
      const sid = sdata.session_id;
      setTimeout(() => {
        const r = getRoom(sid);
        if (r?.game?.phase === 'play_anim') {
          r.game.phase = 'between_plays';
          touchRoom(r);
          broadcast(io, sid, r);
        }
      }, 2000);
      setTimeout(() => {
        const r = getRoom(sid);
        if (r?.game?.phase === 'between_plays') {
          r.game.phase = 'awaiting_schemes';
          clearSchemes(r);
          touchRoom(r);
          broadcast(io, sid, r);
        }
      }, 4500);
    });

    socket.on('game:next_play', () => {
      if (!sdata.session_id) return;
      const room = getRoom(sdata.session_id);
      if (!room || !room.game) return;
      if (sdata.player_id === CPU_PLAYER_ID) {
        socket.emit('session:error', { error: 'cpu_id_reserved' });
        return;
      }
      const game = room.game;
      if (game.phase === 'ended') return;
      if (game.phase !== 'between_plays' && game.phase !== 'play_anim') return;
      game.phase = 'awaiting_schemes';
      clearSchemes(room);
      touchRoom(room);
      broadcast(io, sdata.session_id, room);
    });

    socket.on('disconnect', () => {
      // The DB row + auth token are the long-term identity. We don't
      // immediately drop the player from the room — a flaky network or
      // a tab refresh should be transparent. The in-memory reaper will
      // drop the room once it's been idle for ROOM_TTL_MS with no sockets
      // still attached, at which point the next reconnect re-hydrates
      // from the DB.
      const sid = sdata.session_id;
      if (!sid) return;
      const room = getRoom(sid);
      if (!room) return;
      touchRoom(room);
    });
  });
}
