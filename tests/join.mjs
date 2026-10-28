// 조인(V3-3): ZMTP 3.0 코덱·PUB/SUB, 가정 DTO, 데모 소스 → 브리지 → SUB 끝까지, libzmq(pyzmq) 상호 운용(있으면).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PubSocket, SubSocket, command, frame, greeting, multipart, parseCommand, parseEndpoint, parseReady, readFrames, ready,
} from '../server/zmtp.mjs';
import { Bridge, DTO_SCHEMA, HEALTH_TOPIC, deviceKey, loadTagMap, readJoinConfig, toDto } from '../server/join.mjs';
import { startBDemo } from '../server/b-demo.mjs';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(30); }
  return false;
}

console.log('join');

// ── ZMTP 코덱 ──
{
  const g = greeting(true);
  check('인사 64 B · 서명 · 3.0 · NULL · as-server', g.length === 64 && g[0] === 0xff && g[9] === 0x7f && g[10] === 3 && g[11] === 0
    && g.subarray(12, 16).toString() === 'NULL' && g[32] === 1);
  const short = frame('abc', { more: true }), long = frame(Buffer.alloc(300, 7));
  check('짧은 프레임 flags·크기', short[0] === 0x01 && short[1] === 3 && short.length === 5);
  check('긴 프레임 8바이트 크기', (long[0] & 0x02) === 0x02 && long.readBigUInt64BE(1) === 300n && long.length === 309);
  const r = readFrames(Buffer.concat([multipart(['t', 'body']), long.subarray(0, 100)]));
  check('멀티파트 풀기 · 덜 온 프레임은 rest', r.frames.length === 2 && r.frames[0].more && !r.frames[1].more
    && r.frames[1].body.toString() === 'body' && r.rest.length === 100);
  const rc = readFrames(ready({ 'Socket-Type': 'PUB', Identity: '' })).frames[0];
  const c = parseCommand(rc.body);
  check('READY 명령 왕복', rc.command && c.name === 'READY' && parseReady(c.data)['Socket-Type'] === 'PUB' && parseReady(c.data).Identity === '');
  const huge = Buffer.alloc(9); huge[0] = 0x02; huge.writeBigUInt64BE(1n << 40n, 1);
  check('프레임 상한', !!readFrames(huge).error);
  check('엔드포인트', parseEndpoint('tcp://*:5558').host === '0.0.0.0' && parseEndpoint('tcp://127.0.0.1:1').port === 1);
  let threw = false; try { parseEndpoint('ipc:///tmp/x'); } catch { threw = true; }
  check('tcp 아닌 엔드포인트 거부', threw);
}

// ── PUB/SUB (이 구현끼리) ──
{
  const pub = new PubSocket();
  const a = await pub.bind('tcp://127.0.0.1:0');
  const ep = `tcp://127.0.0.1:${a.port}`;
  const s1 = await new SubSocket().connect(ep, ['collector.sim.']);
  const s2 = await new SubSocket().connect(ep, []);
  s2.peer.send(command('SUBSCRIBE', Buffer.from('collector.sim.cell_sort')));   // ZMTP 3.1 명령 형식
  const got1 = [], got2 = [];
  s1.on('message', (p) => got1.push(p.map(String)));
  s2.on('message', (p) => got2.push(p.map(String)));
  await until(() => pub.subscribers === 2);
  pub.send(['collector.sim.cell_sort.data', '{"a":1}']);
  pub.send(['collector.sim.cell_press.data', '{"b":2}']);
  pub.send(['collector.plc.x.data', 'nope']);
  await until(() => got1.length >= 2 && got2.length >= 1);
  await sleep(50);
  check('접두사 구독(3.0 메시지 형식)', got1.length === 2 && got1[0][0] === 'collector.sim.cell_sort.data' && got1[0][1] === '{"a":1}', JSON.stringify(got1));
  check('접두사 구독(3.1 SUBSCRIBE 명령)', got2.length === 1 && got2[0][0].endsWith('cell_sort.data'), JSON.stringify(got2));
  s1.peer.send(frame(Buffer.concat([Buffer.from([0]), Buffer.from('collector.sim.')])));   // 구독 취소
  await sleep(50);
  pub.send(['collector.sim.cell_sort.data', '{"a":2}']);
  await sleep(80);
  check('구독 취소', got1.length === 2 && got2.length === 2);
  const slow = [...pub.peers].find((p) => p.subs.length);
  Object.defineProperty(slow.sock, 'writableLength', { get: () => 1 << 30, configurable: true });
  const before = pub.dropped;
  pub.send(['collector.sim.cell_sort.data', 'x']);
  check('느린 SUB 는 그 메시지 버리고 셈', pub.dropped === before + 1);
  s1.close(); s2.close();
  // PUB 끼리는 붙지 않는다
  const closed = await new Promise((ok) => {
    import('node:net').then(({ default: net }) => {
      const sock = net.connect(a.port, '127.0.0.1');
      sock.on('connect', () => { sock.write(greeting(false)); sock.write(ready({ 'Socket-Type': 'PUB' })); });
      sock.resume(); sock.on('close', () => ok(true)); sock.on('error', () => {});
      setTimeout(() => ok(false), 1500);
    });
  });
  check('짝이 안 맞는 소켓 종류(PUB↔PUB) 끊음', closed);
  await pub.close();
}

// ── DTO(가정) ──
{
  const meta = { kind: 'meta', writer: 'Cell_SORT', fields: [{ name: 'Health', label: '건강도', unit: '%', path: 'Status.Health' }, { name: 'State', label: '상태', unit: null, path: null }] };
  const item = { kind: 'data', publisher: 'demo', group: 'G', writer: 'Cell_SORT', seq: 7, t: '2026-10-26T00:00:01.000Z',
    values: { Health: { v: 91.5, ts: '2026-10-26T00:00:01.000Z' }, State: { v: 'BUSY', ts: null }, Drift: { v: null, ts: null } } };
  const { topic, body } = toDto(item, { meta, tagMap: { 'Cell_SORT/Health': 'Objects/Sim/Cell_SORT/Health' }, mqttTopic: 'opcua/json/data/demo/G/Cell_SORT', now: 5 });
  const h = body.tags.find((t) => t.name === 'Health'), d = body.tags.find((t) => t.name === 'Drift');
  check('토픽 collector.sim.<device>.data', topic === 'collector.sim.cell_sort.data');
  check('DTO 머리(schema·kind·device·시각·seq·출처)', body.schema === DTO_SCHEMA && body.kind === 'sim' && body.device_key === 'cell_sort'
    && body.timestamp_ms === Date.parse(item.t) && body.received_ms === 5 && body.seq === 7 && body.source.chapter === 'B' && body.source.writer === 'Cell_SORT');
  check('태그: 값·단위·AAS 경로·browse path(tag_map)', h.value === 91.5 && h.unit === '%' && h.aas_path === 'Status.Health'
    && h.browse_path === 'Objects/Sim/Cell_SORT/Health' && h.ts_ms === Date.parse(item.t) && h.quality === 'good');
  check('값 없음 = quality bad · 메타 없는 필드도 넘김', d.quality === 'bad' && d.unit === null && body.tags.length === 3);
  check('device key 정리', deviceKey('Robot_HOUND-02') === 'robot_hound-02' && deviceKey('AMR P/1') === 'amr_p_1' && deviceKey('***') === 'unknown');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'join-'));
  const ok = path.join(dir, 'ok.json'), bad = path.join(dir, 'bad.json');
  fs.writeFileSync(ok, JSON.stringify({ 'A/x': 'Objects/A/x' })); fs.writeFileSync(bad, JSON.stringify({ x: 1 }));
  let threw = false; try { loadTagMap(bad); } catch { threw = true; }
  check('tag_map 읽기 · 이상하면 거부', loadTagMap(ok)['A/x'] === 'Objects/A/x' && threw && Object.keys(loadTagMap(null)).length === 0);
  fs.rmSync(dir, { recursive: true, force: true });
  const conf = readJoinConfig({});
  check('기본 설정(가정 포트 5558 · 장 C 5555–5557 피함)', conf.zmqBind === 'tcp://127.0.0.1:5558' && conf.topics.join() === 'opcua/json/#' && conf.tagMap === null);
}

// ── 데모 소스 → 브리지 → SUB ──
const demo = await startBDemo({ interval: 100, speed: 40 });
const bridge = await new Bridge({ ...readJoinConfig({}), mqttUrl: demo.conf.mqttUrl, zmqBind: 'tcp://127.0.0.1:0', healthMs: 300 }).start();
try {
  const sub = await new SubSocket().connect(bridge.endpoint, ['collector.sim.']);
  const msgs = [];
  sub.on('message', (p) => msgs.push({ topic: String(p[0]), body: JSON.parse(String(p[1])) }));
  const ok = await until(() => msgs.some((m) => m.topic === HEALTH_TOPIC) && msgs.some((m) => m.topic === 'collector.sim.cell_sort.data')
    && msgs.some((m) => m.topic === 'collector.sim.robot_drone-01.data'), 8000);
  const sort = msgs.find((m) => m.topic === 'collector.sim.cell_sort.data')?.body;
  const health = msgs.filter((m) => m.topic === HEALTH_TOPIC).at(-1)?.body;
  check('데모 → 브리지 → SUB: 셀·드론 데이터 · health', ok, `${msgs.length}건 · 토픽 ${new Set(msgs.map((m) => m.topic)).size}`);
  check('메타데이터(retained)의 단위가 태그에 붙음', sort?.tags.find((t) => t.name === 'Health')?.unit === '%', JSON.stringify(sort?.tags?.[4] ?? null));
  check('브리지 health: MQTT 연결 · 구독자 1 · 발행 > 0', health?.mqtt.state === 'connected' && health.zmq.subscribers === 1 && health.published > 0 && health.devices >= 10,
    health ? `발행 ${health.published} · 기기 ${health.devices}` : '');
  check('이벤트·명령·AAS 환경은 넘기지 않음', !msgs.some((m) => /events|commands|environment/.test(m.topic)) && bridge.stats.skipped >= 0);
  check('브리지는 MQTT 로 발행하지 않음', demo.broker.inbound === 0);
  check('일부러 섞은 깨진 JSON 은 넘기지 않고 셈', await until(() => bridge.stats.errors >= 1, 5000), `오류 ${bridge.stats.errors}`);
  sub.close();

  // libzmq(pyzmq)가 있으면 실제 SUB 로 받아 본다
  const hasPy = spawnSync('python3', ['-c', 'import zmq'], { stdio: 'ignore' }).status === 0;
  if (!hasPy) console.log('    (pyzmq 없음 — libzmq 상호 운용은 건너뜀)');
  else {
    const port = bridge.address.port;
    const py = spawn('python3', ['-c', `
import zmq, json, sys
c = zmq.Context(); s = c.socket(zmq.SUB); s.setsockopt(zmq.RCVTIMEO, 5000)
s.setsockopt_string(zmq.SUBSCRIBE, 'collector.sim.cell_press.'); s.connect('tcp://127.0.0.1:${port}')
t, b = s.recv_multipart(); d = json.loads(b)
print(json.dumps({'topic': t.decode(), 'schema': d['schema'], 'key': d['device_key'], 'tags': len(d['tags'])})); sys.stdout.flush()
`]);
    let out = '', err = '';
    py.stdout.on('data', (x) => { out += x; }); py.stderr.on('data', (x) => { err += x; });
    const code = await new Promise((r) => py.on('close', r));
    let r = null; try { r = JSON.parse(out); } catch { /* 아래에서 실패 */ }
    check('libzmq SUB(pyzmq)가 브리지 DTO 를 받음', code === 0 && r?.topic === 'collector.sim.cell_press.data' && r.schema === DTO_SCHEMA && r.tags > 0,
      r ? JSON.stringify(r) : err.trim().split('\n').at(-1));
  }
} finally {
  await bridge.stop();
  await demo.close();
}

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
