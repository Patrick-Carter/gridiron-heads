// Single source of truth for client-side session state.
// Subscribes to server 'session:state' + 'play:result' events, exposes
// { state, me, lastPlayResult, send, error, connected }.

import { useEffect, useState, useCallback, useRef } from 'react';
import { getSocket, EVENTS } from '../api/socket.js';
import type { Socket } from 'socket.io-client';
import type { ActiveSkillId, GameState, MatchOutcome, PlayResult } from '@gridiron/shared';

export interface SessionSnapshot {
  session_id: string;
  players: { id: string; name: string; ready: boolean }[];
  coin_result?: 'heads' | 'tails' | null;
  first_possession_id?: string | null;
  draft?: any;
  game?: GameState | null;
  outcome?: MatchOutcome | null;
  pending_schemes?: Record<string, any>;
  active_card_chain?: {
    offense: ActiveSkillId | null;
    defense: ActiveSkillId | null;
    suppressed: ActiveSkillId | null;
  } | null;
}

export interface PlayResultMsg {
  result: PlayResult;
}

export function useSession(
  session_id: string,
  player_id: string,
  auth_token: string,
  display_name: string = '',
) {
  const [state, setState] = useState<SessionSnapshot | null>(null);
  const [lastPlayResult, setLastPlayResult] = useState<PlayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const sockRef = useRef<Socket | null>(null);

  useEffect(() => {
    const sock = getSocket();
    sockRef.current = sock;

    const onConnect = () => {
      setConnected(true);
      sock.emit(EVENTS.SESSION_JOIN, {
        session_id,
        auth_token,
        display_name,
      });
    };
    const onDisconnect = () => setConnected(false);
    const onState = (snap: SessionSnapshot) => {
      setError(null);
      setState(snap);
      if (!snap.game) setLastPlayResult(null);
    };
    const onPlayResult = (msg: PlayResultMsg) => {
      setLastPlayResult(msg.result);
    };
    const onError = (msg: { error: string }) => setError(msg.error);

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    sock.on(EVENTS.SESSION_STATE, onState);
    sock.on(EVENTS.PLAY_RESULT, onPlayResult);
    sock.on(EVENTS.SESSION_ERROR, onError);

    if (sock.connected) onConnect();

    return () => {
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off(EVENTS.SESSION_STATE, onState);
      sock.off(EVENTS.PLAY_RESULT, onPlayResult);
      sock.off(EVENTS.SESSION_ERROR, onError);
    };
  }, [session_id, auth_token]);

  const send = useCallback((event: string, payload?: any) => {
    const sock = sockRef.current ?? getSocket();
    sock.emit(event, payload);
  }, []);

  return {
    state,
    me: state?.players.find((p) => p.id === player_id) ?? null,
    opponent: state?.players.find((p) => p.id !== player_id) ?? null,
    lastPlayResult,
    error,
    connected,
    send,
    setLastPlayResult,
  };
}
