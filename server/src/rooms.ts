// In-memory room registry — kept in its own module so app.ts (which sets
// up the reaper) and socket/handlers.ts (which mutates the rooms) can both
// import without forming a cycle.

import type { Server as IOServer } from 'socket.io';
import type { RoomState } from './socket/game_machine.js';

const rooms = new Map<string, RoomState>();

export function getRoom(session_id: string): RoomState | undefined {
  return rooms.get(session_id);
}

export function setRoom(session_id: string, room: RoomState): void {
  rooms.set(session_id, room);
}

export function hasRoom(session_id: string): boolean {
  return rooms.has(session_id);
}

export function deleteRoom(session_id: string): void {
  rooms.delete(session_id);
}

export function listRoomIds(): string[] {
  return Array.from(rooms.keys());
}

export function roomCount(): number {
  return rooms.size;
}

/**
 * Drop rooms that have had no active websocket for ROOM_TTL_MS and either:
 *  - are still in 'lobby' (never started), or
 *  - have been inactive for >TTL *and* no session-state in DB (already
 *    reaped by the cleanup script).
 *
 * Returns the number of rooms reaped. Caller is responsible for the timer.
 */
export function reapStaleRooms(io: IOServer, ttlMs: number): number {
  const now = Date.now();
  let reaped = 0;
  for (const [sid, room] of rooms) {
    if (now - room.last_activity_at < ttlMs) continue;
    // Active sockets still attached? Leave alone — they're using the room.
    const sockets = io.sockets.adapter.rooms.get(`session:${sid}`);
    if (sockets && sockets.size > 0) continue;
    rooms.delete(sid);
    reaped++;
  }
  return reaped;
}

/** Update last_activity_at; called from handlers whenever the room is touched. */
export function touchRoom(room: RoomState): void {
  room.last_activity_at = Date.now();
}
