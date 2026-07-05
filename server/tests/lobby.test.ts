import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { initDb } from '../src/db.js';
import { sessionsRouter } from '../src/routes/sessions.js';
import { lobbyRouter } from '../src/routes/lobby.js';
import express from 'express';
import { setRoom } from '../src/rooms.js';
import { newRoom } from '../src/socket/game_machine.js';

const TEST_DB = path.resolve('./tests/_lobby_tmp.db');

function makeApp() {
  for (const ext of ['', '-wal', '-shm']) {
    const p = TEST_DB + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const db = initDb(TEST_DB);
  const app = express();
  app.use(express.json());
  app.use('/api/sessions', sessionsRouter(db));
  app.use('/api/lobby', lobbyRouter(db));
  return { app, db };
}

async function create(app: any, display_name: string, opts: { vs_cpu?: boolean; is_public?: boolean } = {}) {
  const r = await request(app).post('/api/sessions').send({ display_name, ...opts });
  return r.body;
}

describe('POST /api/sessions — is_public flag', () => {
  it('persists is_public=true on the state row', async () => {
    const { app, db } = makeApp();
    const res = await request(app)
      .post('/api/sessions')
      .send({ display_name: 'Alice', is_public: true });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT state FROM sessions WHERE id = ?').get(res.body.session_id) as { state: string };
    const parsed = JSON.parse(row.state);
    expect(parsed.is_public).toBe(true);
  });

  it('defaults to private when is_public is omitted', async () => {
    const { app, db } = makeApp();
    const res = await request(app).post('/api/sessions').send({ display_name: 'Alice' });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT state FROM sessions WHERE id = ?').get(res.body.session_id) as { state: string };
    const parsed = JSON.parse(row.state);
    expect(parsed.is_public).toBeFalsy();
  });

  it('forces is_public=false for vs_cpu sessions', async () => {
    const { app, db } = makeApp();
    const res = await request(app)
      .post('/api/sessions')
      .send({ display_name: 'Alice', vs_cpu: true, is_public: true });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT state FROM sessions WHERE id = ?').get(res.body.session_id) as { state: string };
    const parsed = JSON.parse(row.state);
    expect(parsed.is_public).toBe(false);
  });
});

describe('GET /api/lobby', () => {
  it('returns empty lists when there are no public sessions', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/lobby');
    expect(res.status).toBe(200);
    expect(res.body.open).toEqual([]);
    expect(res.body.live).toEqual([]);
    expect(typeof res.body.generated_at).toBe('number');
  });

  it('lists public open lobbies with host + join_url', async () => {
    const { app } = makeApp();
    await request(app).post('/api/sessions').send({ display_name: 'Alice', is_public: true });
    await request(app).post('/api/sessions').send({ display_name: 'Bob', is_public: true });
    // Private one — should not appear
    await request(app).post('/api/sessions').send({ display_name: 'Carol' });

    const res = await request(app).get('/api/lobby');
    expect(res.status).toBe(200);
    expect(res.body.open).toHaveLength(2);
    for (const entry of res.body.open) {
      expect(entry.phase).toBe('lobby');
      expect(entry.host.name).toBeTruthy();
      expect(entry.join_url).toMatch(/^\/join\//);
    }
    const names = res.body.open.map((e: any) => e.host.name).sort();
    expect(names).toEqual(['Alice', 'Bob']);
    expect(res.body.live).toEqual([]);
  });

  it('hides vs-CPU public sessions (forced private)', async () => {
    const { app } = makeApp();
    await request(app).post('/api/sessions').send({ display_name: 'Alice', vs_cpu: true, is_public: true });
    const res = await request(app).get('/api/lobby');
    expect(res.body.open).toEqual([]);
    expect(res.body.live).toEqual([]);
  });

  it('hides a 2-player DB row that has no in-memory room (stale post-restart)', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/sessions').send({ display_name: 'Alice', is_public: true });
    const session_id = create.body.session_id;
    await request(app).post(`/api/sessions/${session_id}/join`).send({ display_name: 'Bob' });
    // No WS connect → no in-memory room. Should not appear at all.
    const res = await request(app).get('/api/lobby');
    expect(res.body.open).toEqual([]);
    expect(res.body.live).toEqual([]);
  });

  it('moves an open lobby into live once a 2nd player joins via WS+room exists', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/sessions').send({ display_name: 'Alice', is_public: true });
    const session_id = create.body.session_id;
    // Simulate "the host has a live room" by directly writing an in-memory
    // room. The lobby router reads from the rooms map for the live overlay.
    const room = newRoom(session_id, create.body.player_id, 'Alice', {});
    room.players = [
      { id: create.body.player_id, name: 'Alice', ready: true },
      { id: 'guest1', name: 'Bob', ready: true },
    ];
    room.game = {
      session_id,
      phase: 'in_game',
      scores: [1.0, 0.5],
      down: 1,
      distance: 10,
      ball_yardline: 50,
      possession_idx: 0,
      teams: [null as any, null as any],
      audibles_used: [0, 0],
      fake_audibles_used: [0, 0],
      history: [],
      last_play_seed: null,
    } as any;
    setRoom(session_id, room);

    const res = await request(app).get('/api/lobby');
    expect(res.body.open).toEqual([]);
    expect(res.body.live).toHaveLength(1);
    const g = res.body.live[0];
    expect(g.session_id).toBe(session_id);
    expect(g.phase).toBe('in_game');
    expect(g.scores).toEqual([1.0, 0.5]);
    expect(g.players.map((p: any) => p.name)).toEqual(['Alice', 'Bob']);
  });

  it('orders open lobbies by last_activity_at DESC (newest first)', async () => {
    const { app } = makeApp();
    await request(app).post('/api/sessions').send({ display_name: 'Alice', is_public: true });
    await new Promise((r) => setTimeout(r, 10));
    await request(app).post('/api/sessions').send({ display_name: 'Bob', is_public: true });
    await new Promise((r) => setTimeout(r, 10));
    await request(app).post('/api/sessions').send({ display_name: 'Carol', is_public: true });

    const res = await request(app).get('/api/lobby');
    expect(res.body.open).toHaveLength(3);
    // Most-recent first.
    expect(res.body.open[0].host.name).toBe('Carol');
    expect(res.body.open[2].host.name).toBe('Alice');
  });
});