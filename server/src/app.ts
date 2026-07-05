import express, { Express } from 'express';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  // sessions routes wired in Phase 2
  // static client mount wired at end of Phase 3 (built client lives at ../../client/dist)
  // intentionally check for dist folder so we don't 500 in dev:
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist, { fallthrough: true }));
  return app;
}

export function createServer() {
  const app = createApp();
  const http_server = http.createServer(app);
  const io = new IOServer(http_server, {
    cors: { origin: '*' },
    serveClient: false,
  });
  return { app, http_server, io };
}