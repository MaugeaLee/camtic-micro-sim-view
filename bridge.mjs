// npm run bridge — 조인(V3-3): 장 B MQTT 구독 → ZeroMQ PUB(장 C 모양, DTO 가정). 뷰어 서버와 따로 뜬다.
// --b-demo: micro-assembly 대신 데모 소스(server/b-demo.mjs)를 같이 띄워 거기를 구독한다.
// 설정: B_MQTT_URL · JOIN_MQTT_TOPICS · JOIN_ZMQ_BIND(기본 tcp://127.0.0.1:5558) · JOIN_TAG_MAP · JOIN_HEALTH_MS
import { loadEnv } from './server/env.mjs';
import { Bridge, readJoinConfig, HEALTH_TOPIC, DTO_SCHEMA } from './server/join.mjs';

loadEnv();
const conf = readJoinConfig();
const demo = process.argv.includes('--b-demo')
  ? await (await import('./server/b-demo.mjs')).startBDemo({ speed: Number(process.env.B_DEMO_SPEED) || 4 })
  : null;
if (demo) conf.mqttUrl = demo.conf.mqttUrl;

const bridge = await new Bridge(conf).start();
console.log(`조인 브리지 (${DTO_SCHEMA}, 형식 가정)`);
console.log(`  MQTT 구독  ${bridge.status().mqtt.url}  ${conf.topics.join(', ')}${demo ? '  (데모 소스)' : ''}`);
console.log(`  ZeroMQ PUB ${bridge.endpoint}  토픽 collector.sim.<device>.data · ${HEALTH_TOPIC}`);

const line = setInterval(() => {
  const s = bridge.status();
  console.log(`  [${new Date().toISOString().slice(11, 19)}] MQTT ${s.mqtt.state} · 받음 ${s.received} · 발행 ${s.published} · 구독자 없음 ${s.noSubscriber} · SUB ${s.zmq.subscribers} · 기기 ${s.devices}`);
}, 10000);

async function shutdown() {
  clearInterval(line);
  await bridge.stop();
  await demo?.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
