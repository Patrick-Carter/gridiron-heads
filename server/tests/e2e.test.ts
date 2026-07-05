// End-to-end 2-player socket flow test.
// Spins up a real http+socket.io server, creates a session via HTTP,
// opens 2 socket.io-client connections, drives them through the full
// game flow (ready → coin → draft → scheme picks → snap → resolve).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { initDb } from '../src/db.js';
import { createServer } from '../src/app.js';
import fs from 'fs';
import path from 'path';

const TEST_DB = path.resolve('./tests/_e2e_tmp.db');

function makeClient(port: number): ClientSocket {
  return ioClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
}

function waitFor(socket: ClientSocket, event: string, predicate?: (data: any) => boolean): Promise<any> {
  return new Promise((resolve) => {
    const handler = (data: any) => {
      if (!predicate || predicate(data)) {
        socket.off(event, handler);
        resolve(data);
      }
    };
    socket.on(event, handler);
    // safety timeout — 8s
    setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, 8000);
  });
}

describe('2-player end-to-end flow', () => {
  let http_server: any;
  let port: number;
  let host: ClientSocket;
  let guest: ClientSocket;
  let sessionId: string;
  let hostPlayerId: string;
  let guestPlayerId: string;

  beforeAll(async () => {
    for (const ext of ['', '-wal', '-shm']) {
      const p = TEST_DB + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    const db = initDb(TEST_DB);
    const { http_server: hs } = createServer({ db });
    http_server = hs;
    await new Promise<void>((resolve) => {
      http_server.listen(0, () => resolve());
    });
    port = (http_server.address() as AddressInfo).port;

    // Create session via HTTP
    const createRes = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'Alice' }),
    });
    const createJson = await createRes.json();
    sessionId = createJson.session_id;
    hostPlayerId = createJson.player_id;

    const joinRes = await fetch(`http://localhost:${port}/api/sessions/${sessionId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'Bob' }),
    });
    const joinJson = await joinRes.json();
    guestPlayerId = joinJson.player_id;

    // Open sockets
    host = makeClient(port);
    guest = makeClient(port);
    await Promise.all([
      new Promise<void>((r) => host.on('connect', () => r())),
      new Promise<void>((r) => guest.on('connect', () => r())),
    ]);
  }, 20000);

  afterAll(async () => {
    host?.disconnect();
    guest?.disconnect();
    await new Promise<void>((resolve) => http_server.close(() => resolve()));
  });

  it('complete flow: join → ready → draft → play', async () => {
    // Wait for coin flip result to arrive (after both ready)
    const coinPromise = waitFor(host, 'session:state', (s) => s && s.coin_result != null);
    host.emit('session:join', { session_id: sessionId, player_id: hostPlayerId, display_name: 'Alice' });
    guest.emit('session:join', { session_id: sessionId, player_id: guestPlayerId, display_name: 'Bob' });
    // Wait for state to reflect both players joined
    await waitFor(host, 'session:state', (s) => s && s.players.length === 2);
    host.emit('session:ready');
    guest.emit('session:ready');
    const draftState = await coinPromise;
    expect(draftState.coin_result).toMatch(/heads|tails/);
    expect(draftState.first_possession_id).toBeTruthy();
    expect(draftState.draft).toBeTruthy();
    expect(draftState.draft.pool.QB).toHaveLength(3);

    // Drive full draft — register waitFor FIRST so it catches the final state
    const playerLatest: Record<string, any> = { [hostPlayerId]: draftState, [guestPlayerId]: draftState };
    const updateLatest = (pid: string, s: any) => {
      if (s) playerLatest[pid] = s;
    };
    host.on('session:state', (s) => updateLatest(hostPlayerId, s));
    guest.on('session:state', (s) => updateLatest(guestPlayerId, s));
    const gameDonePromise = waitFor(host, 'session:state', (s) => s && s.game);
    const order = draftState.draft.pick_order;
    const groups = ['QB', 'D_LINE', 'O_LINE', 'OFF_SKILL', 'DEF_SKILL', 'KICKER'];
    for (let i = 0; i < 12; i++) {
      const playerId = order[i];
      const sock = playerId === hostPlayerId ? host : guest;
      const latest = playerLatest[playerId];
      const team = latest?.draft?.picks?.[playerId];
      // Find first unpicked group
      const group = groups.find((g) => {
        return (team as any)?.[g.toLowerCase()] == null;
      });
      if (!group) throw new Error(`no unpicked group for ${playerId} at pick ${i}`);
      const pool = latest?.draft?.pool;
      const opt = pool?.[group]?.[0];
      if (!opt) throw new Error(`no ${group} option available for ${playerId} at pick ${i}`);
      sock.emit('draft:pick', { group, option_id: opt.id });
      // brief delay so server state propagates
      await new Promise((r) => setTimeout(r, 25));
    }
    // Wait for game to appear in any state
    const gameState = await gameDonePromise;
    if (!gameState) throw new Error(`game state not received`);
    console.log('final game phase:', gameState.game.phase);
    expect(gameState.game).toBeTruthy();
    expect(gameState.game.phase).toBe('awaiting_schemes');

    // Each player picks scheme
    const scheme0 = { parent: 'run', sub: 'inside' };
    const scheme1 = { parent: 'run', sub: 'outside' };
    host.emit('game:scheme_pick', scheme0);
    guest.emit('game:scheme_pick', scheme1);

    // Wait for ready_to_snap
    const readyState = await waitFor(host, 'session:state', (s) => s.game?.phase === 'ready_to_snap');
    expect(readyState.game.phase).toBe('ready_to_snap');

    // Snap the ball
    const playResultPromise = waitFor(host, 'play:result');
    host.emit('game:snap');
    const playMsg = await playResultPromise;
    expect(playMsg.result).toBeTruthy();
    expect(typeof playMsg.result.yards).toBe('number');

    // After play resolves, server should be in between_plays or play_anim
    const finalState = await waitFor(host, 'session:state', (s) => s.game?.phase === 'between_plays');
    expect(finalState.game.phase).toBe('between_plays');
    expect(finalState.game.history.length).toBe(1);
  }, 30000);

  it('rejects draft pick from wrong player', async () => {
    // open a fresh session for this isolation test
    const createRes = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'X' }),
    });
    const c = await createRes.json();
    const joinRes = await fetch(`http://localhost:${port}/api/sessions/${c.session_id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'Y' }),
    });
    const j = await joinRes.json();

    const a = makeClient(port);
    const b = makeClient(port);
    await Promise.all([
      new Promise<void>((r) => a.on('connect', () => r())),
      new Promise<void>((r) => b.on('connect', () => r())),
    ]);
    a.emit('session:join', { session_id: c.session_id, player_id: c.player_id, display_name: 'X' });
    b.emit('session:join', { session_id: c.session_id, player_id: j.player_id, display_name: 'Y' });
    await waitFor(a, 'session:state', (s) => s.players.length === 2);
    a.emit('session:ready');
    b.emit('session:ready');
    const ds = await waitFor(a, 'session:state', (s) => s.draft != null);
    // b tries to pick when it's a's turn (a is first_possession_id)
    const wrongPlayerId = ds.first_possession_id === c.player_id ? j.player_id : c.player_id;
    const wrongSock = wrongPlayerId === j.player_id ? b : a;
    const errPromise = waitFor(wrongSock, 'session:error');
    wrongSock.emit('draft:pick', { group: 'QB', option_id: ds.draft.pool.QB[0].id });
    const err = await errPromise;
    expect(err.error).toBeTruthy();
    a.disconnect();
    b.disconnect();
  }, 20000);
});