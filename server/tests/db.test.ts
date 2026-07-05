import { describe, it, expect, beforeEach } from 'vitest';
import { initDb } from '../src/db.js';
import fs from 'fs';
import path from 'path';

const TEST_DB = path.resolve('./tests/_tmp.db');

describe('initDb', () => {
  beforeEach(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const p = TEST_DB + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  it('creates sessions table', () => {
    const db = initDb(TEST_DB);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
      .all();
    expect(rows).toHaveLength(1);
    db.close();
  });

  it('creates session_players table', () => {
    const db = initDb(TEST_DB);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_players'")
      .all();
    expect(rows).toHaveLength(1);
    db.close();
  });

  it('enables WAL journal mode', () => {
    const db = initDb(TEST_DB);
    const row = db.pragma('journal_mode', { simple: true }) as string;
    expect(row.toLowerCase()).toBe('wal');
    db.close();
  });

  it('is idempotent (re-init does not throw)', () => {
    const db1 = initDb(TEST_DB);
    db1.close();
    expect(() => initDb(TEST_DB).close()).not.toThrow();
  });
});