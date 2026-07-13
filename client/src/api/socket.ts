// Socket.IO client singleton + typed event surface.
import { io, Socket } from 'socket.io-client';

let sock: Socket | null = null;

export function getSocket(): Socket {
  if (!sock) {
    sock = io('/', {
      autoConnect: true,
      transports: ['websocket', 'polling'],
    });
  }
  return sock;
}

export function disconnectSocket(): void {
  if (sock) {
    sock.disconnect();
    sock = null;
  }
}

// Event name constants
export const EVENTS = {
  SESSION_JOIN: 'session:join',
  SESSION_READY: 'session:ready',
  SESSION_STATE: 'session:state',
  SESSION_ERROR: 'session:error',
  DRAFT_PICK: 'draft:pick',
  SCHEME_PICK: 'game:scheme_pick',
  AUDIBLE: 'game:audible',
  FAKE_AUDIBLE: 'game:fake_audible',
  DEF_AUDIBLE: 'game:def_audible',
  DEF_STAY: 'game:def_stay',
  SNAP: 'game:snap',
  NEXT_PLAY: 'game:next_play',
  SHOOTOUT_KICK: 'game:shootout_kick',
  CONCEDE: 'session:concede',
  PLAY_RESULT: 'play:result',
} as const;
