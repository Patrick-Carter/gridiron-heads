#!/usr/bin/env -S npx tsx
// Cleanup sessions inactive for more than 7 days.
// Run via cron: 0 3 * * * cd /home/USER/dev/gridiron-heads && node --import tsx scripts/cleanup_sessions.ts

import { initDb } from '../server/src/db.js';

const DB_PATH = process.env.DB_PATH ?? './server/data/gridiron.db';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const db = initDb(DB_PATH);
const cutoff = Date.now() - SEVEN_DAYS_MS;
const result = db.prepare('DELETE FROM sessions WHERE last_activity_at < ?').run(cutoff);
console.log(`[cleanup] deleted ${result.changes} sessions older than 7 days`);
db.close();