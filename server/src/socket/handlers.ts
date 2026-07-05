// Socket.IO handlers — wire client events to the server-side state machine.
import type { Server as IOServer, Socket } from 'socket.io';
import type { Database } from 'better-sqlite3';
import { nanoid } from 'nanoid';
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
import type { RoomState } from './game_machine.js';
import { TOTAL_PICKS } from '@gridiron/shared';
import type { Play, PlaySub } from '@gridiron/shared';

// In-memory room registry (could be persisted to DB if needed).
const rooms = new Map<string, RoomState>();

export function getRoom(session_id: string): RoomState | undefined {
  return rooms.get(session_id);
}

export function ensureRoom(session_id: string, host_id: string, host_name: string): RoomState {
  let r = rooms.get(session_id);
  if (!r) {
    r = newRoom(session_id, host_id, host_name);
    rooms.set(session_id, r);
  }
  return r;
}

interface SocketData {
  session_id?: string;
  player_id?: string;
}

export function registerSocketHandlers(io: IOServer, _db: Database): void {
  io.on('connection', (socket: Socket) => {
    const sdata: SocketData = (socket.data ||= {});

    socket.on('session:join', ({ session_id, player_id, display_name }: { session_id: string; player_id: string; display_name: string }) => {
      // Hydrate room from DB if not in memory
      let room = rooms.get(session_id);
      if (!room) {
        const row = _db
          .prepare('SELECT state FROM sessions WHERE id = ?')
          .get(session_id) as { state: string } | undefined;
        if (!row) {
          socket.emit('session:error', { error: 'not_found' });
          return;
        }
        const persistedState = JSON.parse(row.state);
        const host = persistedState.players[0];
        const guest = persistedState.players[1];
        if (!host) {
          socket.emit('session:error', { error: 'no_host' });
          return;
        }
        room = newRoom(session_id, host.id, host.name);
        room.players = persistedState.players;
        room.guest_id = guest?.id ?? null;
        rooms.set(session_id, room);
      }
      sdata.session_id = session_id;
      sdata.player_id = player_id;
      socket.join(`session:${session_id}`);
      // Add player if not present (or update name if display_name provided and player exists)
      const existing = room.players.find((p) => p.id === player_id);
      if (!existing) {
        const result = addPlayer(room, player_id, display_name);
        if (!result.ok) {
          socket.emit('session:error', { error: result.reason });
          return;
        }
      } else if (display_name && display_name !== existing.name) {
        existing.name = display_name;
      }
      io.to(`session:${session_id}`).emit('session:state', snapshot(room));
    });

    socket.on('session:ready', () => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = rooms.get(sdata.session_id);
      if (!room) return;
      setReady(room, sdata.player_id);
      io.to(`session:${sdata.session_id}`).emit('session:state', snapshot(room));
      if (allReady(room)) {
        flipCoin(room);
        startDraft(room);
        io.to(`session:${sdata.session_id}`).emit('session:state', snapshot(room));
      }
    });

    socket.on('draft:pick', ({ group, option_id }: { group: string; option_id: string }) => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = rooms.get(sdata.session_id);
      if (!room || !room.draft) return;
      const r = draftPick(room, sdata.player_id, group as any, option_id);
      if (!r.ok) {
        socket.emit('session:error', { error: r.reason });
        return;
      }
      io.to(`session:${sdata.session_id}`).emit('session:state', snapshot(room));
      if (room.draft.current_turn >= TOTAL_PICKS) {
        const game = startGame(room);
        game.phase = 'awaiting_schemes';
        io.to(`session:${sdata.session_id}`).emit('session:state', snapshot(room));
      }
    });

    socket.on('game:scheme_pick', ({ parent, sub }: { parent: Play['parent']; sub: Play['sub'] }) => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = rooms.get(sdata.session_id);
      if (!room || !room.game) return;
      if (room.game.phase !== 'awaiting_schemes') {
        socket.emit('session:error', { error: 'not_awaiting_schemes' });
        return;
      }
      room.pending_schemes[sdata.player_id] = { parent, sub };
      // Reveal when both committed
      if (Object.keys(room.pending_schemes).length === 2) {
        room.game.phase = 'ready_to_snap';
      }
      io.to(`session:${sdata.session_id}`).emit('session:state', snapshot(room));
    });

    socket.on('game:audible', ({ target_sub }: { target_sub: PlaySub }) => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = rooms.get(sdata.session_id);
      if (!room || !room.game) return;
      const game = room.game;
      const player_idx = room.players.findIndex((p) => p.id === sdata.player_id);
      if (player_idx === -1) return;
      // Only offense can audibles
      if (player_idx !== game.possession_idx) {
        socket.emit('session:error', { error: 'not_offense' });
        return;
      }
      const currentPlay: Play | undefined = room.pending_schemes[sdata.player_id];
      if (!currentPlay) {
        socket.emit('session:error', { error: 'no_current_play' });
        return;
      }
      // Punt and FG have no sub-types — audibles not allowed
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
      io.to(`session:${sdata.session_id}`).emit('session:state', snapshot(room));
    });

    socket.on('game:fake_audible', () => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = rooms.get(sdata.session_id);
      if (!room || !room.game) return;
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
      io.to(`session:${sdata.session_id}`).emit('session:state', snapshot(room));
    });

    socket.on('game:def_audible', ({ target_sub }: { target_sub: PlaySub }) => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = rooms.get(sdata.session_id);
      if (!room || !room.game) return;
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
      io.to(`session:${sdata.session_id}`).emit('session:state', snapshot(room));
    });

    socket.on('game:def_stay', () => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = rooms.get(sdata.session_id);
      if (!room || !room.game) return;
      const game = room.game;
      const player_idx = room.players.findIndex((p) => p.id === sdata.player_id);
      const defIdx = game.possession_idx === 0 ? 1 : 0;
      if (player_idx !== defIdx) return;
      if (game.phase !== 'awaiting_def_response') return;
      (game as any)._pending_def_audible = null;
      game.phase = 'ready_to_snap';
      io.to(`session:${sdata.session_id}`).emit('session:state', snapshot(room));
    });

    socket.on('game:snap', () => {
      if (!sdata.session_id) return;
      const room = rooms.get(sdata.session_id);
      if (!room || !room.game) return;
      const game = room.game;
      if (game.phase !== 'ready_to_snap') return;
      const seed = Math.floor(Math.random() * 2 ** 32);
      const { result } = resolveCurrentPlay(room, seed);
      game.phase = 'play_anim';
      io.to(`session:${sdata.session_id}`).emit('play:result', { result });
      io.to(`session:${sdata.session_id}`).emit('session:state', snapshot(room));
      // Auto-flow: play_anim → between_plays → awaiting_schemes without requiring
      // any client to click "Next Play". The defense doesn't need to manually advance.
      const sid = sdata.session_id;
      setTimeout(() => {
        if (room.game?.phase === 'play_anim') {
          room.game.phase = 'between_plays';
          io.to(`session:${sid}`).emit('session:state', snapshot(room));
        }
      }, 2000);
      setTimeout(() => {
        if (room.game?.phase === 'between_plays') {
          room.game.phase = 'awaiting_schemes';
          clearSchemes(room);
          io.to(`session:${sid}`).emit('session:state', snapshot(room));
        }
      }, 4500);
    });

    socket.on('game:next_play', () => {
      // Kept for backward compat — skip the between_plays delay if explicitly clicked.
      if (!sdata.session_id) return;
      const room = rooms.get(sdata.session_id);
      if (!room || !room.game) return;
      const game = room.game;
      if (game.phase === 'ended') return;
      if (game.phase !== 'between_plays' && game.phase !== 'play_anim') return;
      game.phase = 'awaiting_schemes';
      clearSchemes(room);
      io.to(`session:${sdata.session_id}`).emit('session:state', snapshot(room));
    });

    socket.on('disconnect', () => {
      // v1: keep room alive on disconnect (could add forfeit logic later)
    });
  });
}