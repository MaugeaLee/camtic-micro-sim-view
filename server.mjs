// npm start — HOST/PORT 는 .env
import { loadEnv, mergeConfig } from './server/env.mjs';
import { startServer } from './server/app-server.mjs';

loadEnv();
const { host, port, cfg } = await startServer(mergeConfig());
console.log(`Micro-Cell Viewer → http://${host}:${port}`);
console.log(`API Swagger        → http://${host}:${port}${cfg.api.docs}`);
