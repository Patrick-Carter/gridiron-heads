import express, { Express } from 'express';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Database } from 'better-sqlite3';
import rateLimit from 'express-rate-limit';
import { sessionsRouter } from './routes/sessions.js';
import { initDb } from './db.js';
import { registerSocketHandlers } from './socket/handlers.js';
import { reapStaleRooms, roomCount } from './rooms.js';
import {
  loadAllowedOrigins,
  originAllowlistMiddleware,
  socketIoOriginChecker,
  IpRateLimiter,
  socketIoRateLimit,
  trustProxyFn,
} from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Sliding window: 30 socket connects per IP per minute. Easy headroom for
// normal browser reconnects while shutting down cheap connect-flood DoS.
export const SOCKET_LIMITER = new IpRateLimiter({ windowMs: 60_000, max: 30 });

// 90s idle GC for in-memory rooms with no active sockets. The DB row is the
// long-term canonical state; the in-memory cache is transient.
export const ROOM_TTL_MS = 90_000;
// Reaper runs every 30s — half the TTL — so a defunct room is reaped within
// at most TTL + REAPER_INTERVAL.
export const ROOM_REAPER_MS = 30_000;

let reaperTimer: NodeJS.Timeout | null = null;

export function startRoomReaper(io: IOServer): void {
  if (reaperTimer) return;
  reaperTimer = setInterval(() => {
    try {
      const n = reapStaleRooms(io, ROOM_TTL_MS);
      if (n > 0) console.log(`[server] reaped ${n} stale room(s) (${roomCount()} remain)`);
    } catch (err) {
      console.error('[server] reaper error:', err);
    }
  }, ROOM_REAPER_MS);
  reaperTimer.unref?.();
}

export function stopRoomReaper(): void {
  if (reaperTimer) {
    clearInterval(reaperTimer);
    reaperTimer = null;
  }
}

export interface CreateAppOpts {
  db?: Database;
  io?: IOServer;
}

export function createApp(opts: CreateAppOpts = {}): Express {
  const app = express();
  const allowedOrigins = loadAllowedOrigins();

  // Trust only private/loopback hops when interpreting X-Forwarded-*. This
  // keeps Express in sync with what cloudflared reports over the docker
  // bridge without letting any public client spoof its own proxy.
  app.set('trust proxy', trustProxyFn);

  // Security headers. The SPA's inline styles (Tailwind) and runtime
  // (Vite inlines only in dev) aren't compatible with helmet's default CSP
  // — we already trusted them by serving our own bundle, so disable CSP
  // here and rely on the same-origin policy above for protection.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // CORS for HTTP — checked both here (response side) and explicitly by the
  // allowlist middleware (blocks disallowed origins outright).
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: false,
    }),
  );
  app.use(originAllowlistMiddleware(allowedOrigins));

  // Body parsing with a tight ceiling — every endpoint takes a few KB max.
  app.use(express.json({ limit: '16kb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // HTTP rate limit on /api/sessions (20 req/min/IP). Bucket covers session
  // create + join + get. /healthz stays unmetered (CF / kubelet polls).
  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited' },
  });

  // Sessions API — uses provided DB or opens default
  const db = opts.db ?? initDb(path.resolve(__dirname, '../data/gridiron.db'));
  app.use('/api/sessions', apiLimiter, sessionsRouter(db));

  // Static client mount LAST so it doesn't shadow /api/* and /healthz
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist, { fallthrough: true }));

  // SPA fallback — any non-API GET that didn't hit a static file returns
  // index.html so the React Router catch-all can resolve the route.
  app.get(/^(?!\/api|\/healthz|\/socket\.io|\.well-known).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return app;
}

export interface CreateServerOpts {
  db?: Database;
  dbPath?: string;
}

export function createServer(opts: CreateServerOpts = {}): {
  app: Express;
  http_server: http.Server;
  io: IOServer;
  db: Database;
} {
  const db =
    opts.db ??
    initDb(opts.dbPath ?? path.resolve(process.cwd(), 'server/data/gridiron.db'));
  const app = createApp({ db });
  const http_server = http.createServer(app);
  const io = new IOServer(http_server, {
    // Origin check at the Socket.IO layer. Enforced at the handshake
    // (both WS upgrade and HTTP polling first-request). Server-to-server
    // / curl connections have no Origin header and are allowed.
    cors: {
      origin: socketIoOriginChecker(loadAllowedOrigins()),
      credentials: false,
    },
    serveClient: false,
    transports: ['websocket', 'polling'],
    // Per-message buffer cap (default 1 MB; we drop to 64 KB so a malicious
    // client can't park large payloads on a long-lived socket). Game
    // payloads never exceed a few hundred bytes.
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 25_000,
    pingTimeout: 30_000,
    allowUpgrades: true,
  });

  // Per-IP socket-connect rate limit.
  io.use(socketIoRateLimit(SOCKET_LIMITER));

  registerSocketHandlers(io, db);

  // In-memory room GC.
  startRoomReaper(io);

  return { app, http_server, io, db };
}
