#!/usr/bin/env -S npx tsx
// Cleanup sessions inactive for more than 7 days. Cleans both the DB row
// and any in-memory room state if invoked when the server isn't running.
// Run via cron: 0 3 * * * cd /home/USER/dev/gridiron-heads && node --import tsx scripts/cleanup_sessions.ts

import { initDb } from '../server/src/db.js';

const DB_PATH = process.env.DB_PATH ?? './server/data/gridiron.db';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const db = initDb(DB_PATH);
const cutoff = Date.now() - SEVEN_DAYS_MS;

// Cascading FK from session_players → sessions and player_tokens →
// session_players deletes tokens + player rows when the session row dies.
const result = db.prepare('DELETE FROM sessions WHERE last_activity_at < ?').run(cutoff);
console.log(`[cleanup] deleted ${result.changes} sessions older than 7 days`);
db.close();
