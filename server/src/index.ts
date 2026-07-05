import { createServer } from './app.js';

const PORT = Number(process.env.PORT ?? 3000);
const { http_server } = createServer();

http_server.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});