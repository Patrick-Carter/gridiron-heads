import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { initDb } from '../src/db.js';
import { sessionsRouter } from '../src/routes/sessions.js';
import express from 'express';

const TEST_DB = path.resolve('./tests/_routes_tmp.db');

function makeApp() {
  // fresh DB
  for (const ext of ['', '-wal', '-shm']) {
    const p = TEST_DB + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const db = initDb(TEST_DB);
  const app = express();
  app.use(express.json());
  app.use('/api/sessions', sessionsRouter(db));
  return { app, db };
}

describe('POST /api/sessions', () => {
  it('creates a session and returns session_id + player_id', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/sessions')
      .send({ display_name: 'Alice' });
    expect(res.status).toBe(200);
    expect(res.body.session_id).toBeTruthy();
    expect(res.body.player_id).toBeTruthy();
    expect(res.body.share_url).toMatch(/\/join\//);
    expect(res.body.state.players[0].name).toBe('Alice');
    expect(res.body.state.players[0].ready).toBe(false);
  });

  it('requires display_name', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/sessions').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/sessions/:id/join', () => {
  it('lets a 2nd player join', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/sessions').send({ display_name: 'Alice' });
    const session_id = create.body.session_id;

    const join = await request(app)
      .post(`/api/sessions/${session_id}/join`)
      .send({ display_name: 'Bob' });
    expect(join.status).toBe(200);
    expect(join.body.player_id).toBeTruthy();
    expect(join.body.state.players).toHaveLength(2);
    expect(join.body.state.players[1].name).toBe('Bob');
  });

  it('rejects join to unknown session', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/sessions/nonexistent/join')
      .send({ display_name: 'Bob' });
    expect(res.status).toBe(404);
  });

  it('rejects 3rd player', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/sessions').send({ display_name: 'Alice' });
    const session_id = create.body.session_id;
    await request(app)
      .post(`/api/sessions/${session_id}/join`)
      .send({ display_name: 'Bob' });
    const third = await request(app)
      .post(`/api/sessions/${session_id}/join`)
      .send({ display_name: 'Carol' });
    expect(third.status).toBe(409);
  });
});

describe('GET /api/sessions/:id', () => {
  it('returns state for valid session', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/sessions').send({ display_name: 'Alice' });
    const session_id = create.body.session_id;
    const res = await request(app).get(`/api/sessions/${session_id}`);
    expect(res.status).toBe(200);
    expect(res.body.state.players[0].name).toBe('Alice');
  });
  it('returns 404 for unknown', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/sessions/nope');
    expect(res.status).toBe(404);
  });
});