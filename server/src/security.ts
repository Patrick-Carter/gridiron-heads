// Shared server utilities: origin allowlist, request-rate limiter, and
// session/player auth-token lookup helpers used by both HTTP and the
// Socket.IO handler.

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Server as IOServer, Socket } from 'socket.io';
import type { Database } from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Origin allowlist
// ---------------------------------------------------------------------------

function defaultAllowedOrigins(): string[] {
  // Production: the public Cloudflare Tunnel origin.
  // Local dev: server on :3000, Vite client on :5173 (both with http).
  return [
    'https://bb.carterhub.net',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ];
}

export function loadAllowedOrigins(): string[] {
  const env = process.env.ALLOWED_ORIGINS;
  if (!env || !env.trim()) return defaultAllowedOrigins();
  const list = env.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : defaultAllowedOrigins();
}

export interface OriginDecision {
  ok: boolean;
  reason?: 'no_origin' | 'not_allowed';
  origin?: string;
}

/**
 * Returns true if `origin` is allowed. No-origin requests (curl, server-to-
 * server, native clients) are allowed through to keep external machines
 * working behind the Cloudflare tunnel.
 */
export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  return allowed.includes(origin);
}

/** Express middleware that 403s requests with a disallowed Origin header. */
export function originAllowlistMiddleware(allowed: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // Only enforce on browser-style requests that carry an Origin header.
    const origin = req.headers.origin;
    if (origin !== undefined && !isOriginAllowed(origin, allowed)) {
      return res.status(403).json({ error: 'origin_not_allowed' });
    }
    next();
  };
}

/** Socket.IO cors-style origin decision: (origin, cb) signature. */
export function socketIoOriginChecker(allowed: string[]): (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void {
  return (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    cb(new Error('origin_not_allowed'));
  };
}

// ---------------------------------------------------------------------------
// Per-IP rate limiter (sliding window)
// ---------------------------------------------------------------------------

interface Bucket {
  ts: number[];
}

export class IpRateLimiter {
  private buckets = new Map<string, Bucket>();
  private windowMs: number;
  private max: number;
  // Drop empty buckets occasionally to keep the Map small under steady traffic.
  private lastGc = Date.now();
  private gcIntervalMs: number;

  constructor(opts: { windowMs: number; max: number; gcIntervalMs?: number }) {
    this.windowMs = opts.windowMs;
    this.max = opts.max;
    this.gcIntervalMs = opts.gcIntervalMs ?? Math.max(opts.windowMs * 2, 60_000);
  }

  /** Returns { ok, remaining, retryAfterMs? } for the given key (IP). */
  check(key: string): { ok: boolean; remaining: number; retryAfterMs: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let b = this.buckets.get(key);
    if (!b) {
      b = { ts: [] };
      this.buckets.set(key, b);
    }
    // Evict expired entries.
    while (b.ts.length > 0 && b.ts[0] < cutoff) b.ts.shift();
    if (b.ts.length >= this.max) {
      const retryAfterMs = Math.max(0, b.ts[0] + this.windowMs - now);
      return { ok: false, remaining: 0, retryAfterMs };
    }
    b.ts.push(now);
    // Periodic GC.
    if (now - this.lastGc > this.gcIntervalMs) this.gc(now, cutoff);
    return { ok: true, remaining: this.max - b.ts.length, retryAfterMs: 0 };
  }

  private gc(now: number, cutoff: number) {
    this.lastGc = now;
    for (const [k, v] of this.buckets) {
      while (v.ts.length > 0 && v.ts[0] < cutoff) v.ts.shift();
      if (v.ts.length === 0) this.buckets.delete(k);
    }
  }

  size(): number {
    return this.buckets.size;
  }
}

/** Apply the limiter on Socket.IO connection attempts. */
export function socketIoRateLimit(limiter: IpRateLimiter) {
  return (socket: Socket, next: (err?: Error) => void) => {
    const ip = socket.handshake.address || 'unknown';
    const r = limiter.check(ip);
    if (!r.ok) {
      const err = new Error('rate_limited') as Error & { data?: unknown };
      err.data = { retryAfterMs: r.retryAfterMs };
      return next(err);
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Display-name validation
// ---------------------------------------------------------------------------

// Letters (any script), digits, marks, common punctuation, symbols (incl.
// emoji), separators (space, etc.) — capped at 32 chars.
const NAME_RE = /^[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Z}]{1,32}$/u;

export function normalizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Trim outer whitespace, collapse interior whitespace runs to single spaces.
  let s = raw.trim().replace(/\s+/g, ' ');
  if (s.length === 0) return null;
  if (s.length > 32) s = s.slice(0, 32);
  if (!NAME_RE.test(s)) return null;
  return s;
}

// ---------------------------------------------------------------------------
// Auth-token helpers (DB-backed)
// ---------------------------------------------------------------------------

export interface AuthLookup {
  ok: boolean;
  session_id?: string;
  player_id?: string;
  reason?: 'unknown_token' | 'session_mismatch';
}

export function lookupAuthToken(
  db: Database,
  token: unknown,
  expected_session_id?: string,
): AuthLookup {
  if (typeof token !== 'string' || token.length === 0 || token.length > 128) {
    return { ok: false, reason: 'unknown_token' };
  }
  const row = db
    .prepare(
      'SELECT session_id, player_id FROM player_tokens WHERE token = ?',
    )
    .get(token) as { session_id: string; player_id: string } | undefined;
  if (!row) return { ok: false, reason: 'unknown_token' };
  if (expected_session_id && row.session_id !== expected_session_id) {
    return { ok: false, reason: 'session_mismatch' };
  }
  return { ok: true, session_id: row.session_id, player_id: row.player_id };
}

export function issueAuthToken(
  db: Database,
  session_id: string,
  player_id: string,
  token: string,
): void {
  db.prepare(
    'INSERT INTO player_tokens (token, session_id, player_id, issued_at) VALUES (?, ?, ?, ?)',
  ).run(token, session_id, player_id, Date.now());
}

// ---------------------------------------------------------------------------
// Trust proxy helper. Lets Express honor X-Forwarded-For / X-Forwarded-Proto
// from the Unraid host or cloudflared container (which present as private-
// network IPs) but ignores any public-claimed X-Forwarded-For from anywhere
// else. Returning `false` from the callback means "don't trust any header
// from this remote address."
// ---------------------------------------------------------------------------

export function trustProxyDecision(ip: string): boolean {
  if (!ip) return false;
  // Loopback
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  // IPv4 RFC1918
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  // 172.16.0.0 - 172.31.255.255
  const m = ip.match(/^172\.(\d+)\./);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  // Unique-Local IPv6 (fc00::/7)
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
  // Link-local IPv6
  if (ip.startsWith('fe80:')) return true;
  return false;
}

/** Express `trust proxy` callback: trust header from the docker bridge / Unraid LAN,
 *  not from arbitrary claimed proxies on the public Internet. */
export const trustProxyFn = (ip: string) => trustProxyDecision(ip);
