import path from 'path';
import fs from 'fs';
import { createServer } from './app.js';

const PORT = Number(process.env.PORT ?? 3000);
// DB_PATH lets the deployer pin the SQLite file to a persistent volume.
// Defaults to ./server/data/gridiron.db for local dev.
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(process.cwd(), 'server/data/gridiron.db');

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const { http_server } = createServer({ dbPath: DB_PATH });

http_server.listen(PORT, () => {
  console.log(`[server] listening on :${PORT} (db=${DB_PATH})`);
});