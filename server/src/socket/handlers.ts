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
import { tickCpu, CPU_PLAYER_ID } from './cpu.js';
import { TOTAL_PICKS } from '@gridiron/shared';
import type { Play, PlaySub } from '@gridiron/shared';

// In-memory room registry (could be persisted to DB if needed).
const rooms = new Map<string, RoomState>();

export function getRoom(session_id: string): RoomState | undefined {
  return rooms.get(session_id);
}

/** Rehydrate or create a fresh in-memory room for the given session. */
function getOrCreateRoom(
  session_id: string,
  host_id: string,
  host_name: string,
  cpu_player_id: string | null = null,
): RoomState {
  let r = rooms.get(session_id);
  if (!r) {
    r = newRoom(session_id, host_id, host_name, {
      cpu_player_id: cpu_player_id ?? undefined,
    });
    rooms.set(session_id, r);
  }
  return r;
}

/** Broadcast current room state to everyone in the session, then tick the CPU
 *  if this is a vs-CPU room. Keeps the existing 2P code path byte-identical
 *  when cpu_player_id is null (tickCpu is a no-op in that case). */
function broadcastAndTick(io: IOServer, room: RoomState): void {
  io.to(`session:${room.session_id}`).emit('session:state', snapshot(room));
  tickCpu(io, room);
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
        // CPU rooms have the CPU already seeded into persistedState.players[1].
        // We can detect by is_cpu flag (CPU-only post-deploy) or by the
        // CPU_PLAYER_ID literal (CPU rooms created before is_cpu existed).
        const cpuId = guest?.is_cpu || guest?.id === CPU_PLAYER_ID ? guest.id : null;
        room = newRoom(session_id, host.id, host.name, {
          cpu_player_id: cpuId ?? undefined,
        });
        room.players = persistedState.players;
        room.guest_id = guest?.id ?? null;
        rooms.set(session_id, room);
      }
      sdata.session_id = session_id;
      sdata.player_id = player_id;
      socket.join(`session:${session_id}`);
      const existing = room.players.find((p) => p.id === player_id);
      if (!existing) {
        // Reject new human joins when CPU is the second player (vs-CPU is
        // a locked 2-player room — only the host can join their own session).
        if (room.cpu_player_id) {
          socket.emit('session:error', { error: 'vs_cpu_locked' });
          return;
        }
        const result = addPlayer(room, player_id, display_name);
        if (!result.ok) {
          socket.emit('session:error', { error: result.reason });
          return;
        }
      } else if (display_name && display_name !== existing.name && !existing.is_cpu) {
        // Don't overwrite the CPU's display name on re-hydration.
        existing.name = display_name;
      }
      broadcastAndTick(io, room);
      // CPU rooms boot the game the moment the host connects — no second
      // ready click needed. 2P path requires the existing session:ready flow.
      if (room.cpu_player_id && allReady(room) && !room.draft && !room.game) {
        flipCoin(room);
        startDraft(room);
        broadcastAndTick(io, room);
      }
    });

    socket.on('session:ready', () => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = rooms.get(sdata.session_id);
      if (!room) return;
      // CPU players are auto-readied at room creation; human sockets ignore
      // double-ready. Defensive: ignore if not the human.
      const player = room.players.find((p) => p.id === sdata.player_id);
      if (!player || player.is_cpu) return;
      setReady(room, sdata.player_id);
      io.to(`session:${sdata.session_id}`).emit('session:state', snapshot(room));
      if (allReady(room)) {
        flipCoin(room);
        startDraft(room);
        // CPU may owe a draft pick immediately if coin favored it.
        broadcastAndTick(io, room);
      }
    });

    socket.on('draft:pick', ({ group, option_id }: { group: string; option_id: string }) => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = rooms.get(sdata.session_id);
      if (!room || !room.draft) return;
      // CPU picks are driven by tickCpu; reject human emulating CPU id.
      if (sdata.player_id === CPU_PLAYER_ID) {
        socket.emit('session:error', { error: 'cpu_id_reserved' });
        return;
      }
      const r = draftPick(room, sdata.player_id, group as any, option_id);
      if (!r.ok) {
        socket.emit('session:error', { error: r.reason });
        return;
      }
      broadcastAndTick(io, room);
      if (room.draft.current_turn >= TOTAL_PICKS) {
        const game = startGame(room);
        game.phase = 'awaiting_schemes';
        // CPU may be the first offense — let tickCpu drive it.
        broadcastAndTick(io, room);
      }
    });

    socket.on('game:scheme_pick', ({ parent, sub }: { parent: Play['parent']; sub: Play['sub'] }) => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = rooms.get(sdata.session_id);
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
      // Reveal when both committed
      if (Object.keys(room.pending_schemes).length === 2) {
        game.phase = 'ready_to_snap';
      }
      // tickCpu handles the case where CPU is offense AND defense is
      // still waiting for the human — only acts on CPU's side.
      broadcastAndTick(io, room);
    });

    socket.on('game:audible', ({ target_sub }: { target_sub: PlaySub }) => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = rooms.get(sdata.session_id);
      if (!room || !room.game) return;
      if (sdata.player_id === CPU_PLAYER_ID) {
        socket.emit('session:error', { error: 'cpu_id_reserved' });
        return;
      }
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
      broadcastAndTick(io, room);
    });

    socket.on('game:fake_audible', () => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = rooms.get(sdata.session_id);
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
      broadcastAndTick(io, room);
    });

    socket.on('game:def_audible', ({ target_sub }: { target_sub: PlaySub }) => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = rooms.get(sdata.session_id);
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
      broadcastAndTick(io, room);
    });

    socket.on('game:def_stay', () => {
      if (!sdata.session_id || !sdata.player_id) return;
      const room = rooms.get(sdata.session_id);
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
      broadcastAndTick(io, room);
    });

    socket.on('game:snap', () => {
      if (!sdata.session_id) return;
      const room = rooms.get(sdata.session_id);
      if (!room || !room.game) return;
      if (sdata.player_id === CPU_PLAYER_ID) {
        socket.emit('session:error', { error: 'cpu_id_reserved' });
        return;
      }
      const game = room.game;
      if (game.phase !== 'ready_to_snap') return;
      const seed = Math.floor(Math.random() * 2 ** 32);
      const { result } = resolveCurrentPlay(room, seed);
      // If the play ended the game (win condition met), don't clobber the 'ended'
      // phase with 'play_anim' — broadcast the terminal state so both clients
      // render GameOver. Previously this handler forced phase → 'play_anim' even
      // when the game had just been decided, masking wins as zombie plays.
      // `resolveCurrentPlay` widens game.phase to 'between_plays' | 'ended' (the
      // latter when the win condition is met), so cast through any to compare.
      const gameEnded = (game.phase as string) === 'ended';
      if (!gameEnded) game.phase = 'play_anim';
      io.to(`session:${sdata.session_id}`).emit('play:result', { result });
      broadcastAndTick(io, room);
      if (gameEnded) return; // skip auto-advance — game is over, broadcast is final
      // Auto-flow: play_anim → between_plays → awaiting_schemes without requiring
      // any client to click "Next Play". The defense doesn't need to manually advance.
      const sid = sdata.session_id;
      setTimeout(() => {
        if (room.game?.phase === 'play_anim') {
          room.game.phase = 'between_plays';
          broadcastAndTick(io, room);
        }
      }, 2000);
      setTimeout(() => {
        if (room.game?.phase === 'between_plays') {
          room.game.phase = 'awaiting_schemes';
          clearSchemes(room);
          broadcastAndTick(io, room);
        }
      }, 4500);
    });

    socket.on('game:next_play', () => {
      // Kept for backward compat — skip the between_plays delay if explicitly clicked.
      if (!sdata.session_id) return;
      const room = rooms.get(sdata.session_id);
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
      broadcastAndTick(io, room);
    });

    socket.on('disconnect', () => {
      // v1: keep room alive on disconnect (could add forfeit logic later)
      // CPU never disconnects.
    });
  });
}