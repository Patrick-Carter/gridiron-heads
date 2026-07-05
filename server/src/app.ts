import express, { Express } from 'express';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Database } from 'better-sqlite3';
import { sessionsRouter } from './routes/sessions.js';
import { initDb } from './db.js';
import { registerSocketHandlers } from './socket/handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CreateAppOpts {
  db?: Database;
  io?: IOServer;
}

export function createApp(opts: CreateAppOpts = {}): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Sessions API — uses provided DB or opens default
  const db = opts.db ?? initDb(path.resolve(__dirname, '../data/gridiron.db'));
  app.use('/api/sessions', sessionsRouter(db));

  // Static client mount LAST so it doesn't shadow /api/* and /healthz
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist, { fallthrough: true }));

  // SPA fallback — any non-API GET that didn't hit a static file returns
  // index.html so the React Router catch-all can resolve the route.
  // Without this, shareable URLs like /join/<id> 404 in production.
  app.get(/^(?!\/api|\/healthz|\/socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return app;
}

export interface CreateServerOpts {
  db?: Database;
}

export function createServer(opts: CreateServerOpts = {}): {
  app: Express;
  http_server: http.Server;
  io: IOServer;
  db: Database;
} {
  const db = opts.db ?? initDb(path.resolve(process.cwd(), 'server/data/gridiron.db'));
  const app = createApp({ db });
  const http_server = http.createServer(app);
  const io = new IOServer(http_server, {
    cors: { origin: '*' },
    serveClient: false,
  });
  registerSocketHandlers(io, db);
  return { app, http_server, io, db };
}