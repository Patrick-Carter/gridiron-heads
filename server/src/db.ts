import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export function initDb(filepath: string): DB {
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(filepath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      last_activity_at INTEGER NOT NULL,
      state TEXT NOT NULL,
      game_state TEXT
    );
    CREATE TABLE IF NOT EXISTS session_players (
      session_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, player_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `);
  return db;
}