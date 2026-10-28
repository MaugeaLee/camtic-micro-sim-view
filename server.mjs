// npm start — HOST/PORT 는 .env
// npm run demo (= --b-demo): 장 B 데모 소스(프로세스 안 MQTT 브로커 + 가짜 FAC, 이 뷰어 시뮬 값)를 같이 띄운다. B_MQTT_URL·B_FAC_URL 대신 쓴다.
import { loadEnv, mergeConfig } from './server/env.mjs';
import { startServer } from './server/app-server.mjs';

loadEnv();
const demoOn = process.argv.includes('--b-demo') || process.env.B_DEMO === '1';
// B_DEMO_SPEED: 데모 시뮬 배속(기본 4 — 첫 셀 고장이 시뮬 110 s 라 1배속이면 이벤트가 2분 가까이 안 보인다)
const demo = demoOn ? await (await import('./server/b-demo.mjs')).startBDemo({ speed: Number(process.env.B_DEMO_SPEED) || 4 }) : null;
const { host, port, cfg } = await startServer(mergeConfig(demo ? { b: demo.conf } : {}));
console.log(`Micro-Cell Viewer → http://${host}:${port}`);
console.log(`API Swagger        → http://${host}:${port}${cfg.api.docs}`);
console.log(`장 B 구독          → http://${host}:${port}/dashboard${demo ? `  (데모 소스: 브로커 ${demo.conf.mqttUrl} · FAC ${demo.conf.facUrl})` : ''}`);
