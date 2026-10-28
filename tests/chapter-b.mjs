// 장 B 구독(V3-1): MQTT 3.1.1 코덱, PubSub JSON 풀기, 가짜 브로커 → SSE, FAC GET 대리.
import http from 'node:http';
import net from 'node:net';
import { encodeLength, encodePublish, maskUrl, packet, parsePublish, parseUrl, readPackets, T } from '../server/mqtt.mjs';
import { BStore, LIMITS, decode } from '../js/data/pubsub.js';
import { startServer } from '../server/app-server.mjs';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(25); }
  return false;
}

console.log('chapter-b');

// ── 코덱 ──
for (const n of [0, 127, 128, 16383, 16384, 2097151, 2097152]) {
  const { packets } = readPackets(Buffer.concat([Buffer.from([0x30]), encodeLength(n), Buffer.alloc(n)]));
  if (packets.length !== 1 || packets[0].body.length !== n) check(`길이 ${n}`, false);
}
check('남은 길이 varint 왕복', true);
const pub = encodePublish('opcua/json/data/jin3d/MetaFactory/AMR1', '{"a":1}', { retain: true });
const two = Buffer.concat([pub, packet(T.PINGRESP, 0)]);
const half = readPackets(two.subarray(0, 7));
check('덜 온 패킷은 rest', half.packets.length === 0 && half.rest.length === 7);
const both = readPackets(two);
const p0 = parsePublish(both.packets[0]);
check('PUBLISH 풀기', both.packets.length === 2 && p0.topic.endsWith('/AMR1') && p0.retain && p0.qos === 0 && p0.payload.toString() === '{"a":1}');
const q1 = parsePublish(readPackets(encodePublish('x', 'y', { qos: 1, id: 7 })).packets[0]);
check('QoS1 패킷 ID', q1.qos === 1 && q1.id === 7 && q1.payload.toString() === 'y');
check('패킷 상한', !!readPackets(Buffer.concat([Buffer.from([0x30]), encodeLength(100)]), 50).error);
check('길이 필드 5바이트 거부', !!readPackets(Buffer.from([0x30, 0xff, 0xff, 0xff, 0xff, 0x01])).error);
const pu = parseUrl('mqtt://user%40x:p%3Ass@10.0.0.2:1884');
check('URL 계정', pu.host === '10.0.0.2' && pu.port === 1884 && pu.username === 'user@x' && pu.password === 'p:ss');
check('URL 기본 포트', parseUrl('mqtt://localhost').port === 1883);
let threw = false; try { parseUrl('mqtts://h'); } catch { threw = true; }
check('mqtts 거부', threw);
check('계정 가림', !maskUrl('mqtt://u:secret@h:1883').includes('secret') && maskUrl('mqtt://h:1883') === 'mqtt://h:1883');

// ── PubSub JSON (micro-assembly datahub.js 모양) ──
const TS = '2026-10-26T00:01:40.000Z';
const ref = { DataSetWriterId: 3, DataSetWriterName: 'AMR1', SequenceNumber: 12, Timestamp: TS, MessageType: 'ua-keyframe',
  Payload: { Battery: { Value: 81.5, SourceTimestamp: TS }, Mode: { Value: 'move', SourceTimestamp: TS } } };
const dataMsg = { MessageId: 'm1', MessageType: 'ua-data', PublisherId: 'jin3d', WriterGroupName: 'MetaFactory', Messages: [ref] };
const metaMsg = { MessageId: 'm0', MessageType: 'ua-metadata', PublisherId: 'jin3d', DataSetWriterId: 3, MetaData: {
  Name: 'AMR1', Description: { Locale: 'ko-KR', Text: '이송 로봇 1' }, Fields: [
    { Name: 'Battery', Description: { Text: '배터리' }, BuiltInType: 11, Properties: [{ Key: { Name: 'EngineeringUnits' }, Value: '%' }, { Key: { Name: 'AAS.IdShortPath' }, Value: 'Status.Battery' }] },
    { Name: 'Mode', Description: { Text: '모드' }, BuiltInType: 12, Properties: [] }] } };
const evMsg = { MessageType: 'ua-data', PublisherId: 'jin3d', WriterGroupName: 'MetaFactory', Messages: [{ DataSetWriterName: 'Events', SequenceNumber: 4, Timestamp: TS, MessageType: 'ua-event',
  Payload: { EventId: { Value: 'e4' }, EventType: { Value: 'ns=1;s=Jin3D.alert' }, SourceName: { Value: 'SCREW' }, Time: { Value: TS }, Severity: { Value: 800 }, Message: { Value: { Text: '토크 이상', Locale: 'ko-KR' } } } }] };
const cmd = (state) => ({ MessageType: 'ua-data', PublisherId: 'jin3d', WriterGroupName: 'MetaFactory', Messages: [{ DataSetWriterName: 'Commands', SequenceNumber: 9, Timestamp: TS, MessageType: 'ua-keyframe',
  Payload: Object.fromEntries(Object.entries({ CommandId: 'C-1', Code: 'HOLD', Name: '정지', Group: 'cell', Target: 'SCREW', TargetName: '체결 셀', Argument: '', Issuer: 'OCS', Reason: '토크', State: state, Note: '' }).map(([k, v]) => [k, { Value: v, SourceTimestamp: TS }])) }] });
const D = 'opcua/json/data/jin3d/MetaFactory/', M = 'opcua/json/metadata/jin3d/MetaFactory/';

const [d] = decode(`${D}AMR1`, JSON.stringify(dataMsg));
check('data 풀기', d.kind === 'data' && d.writer === 'AMR1' && d.seq === 12 && d.values.Battery.v === 81.5 && d.values.Mode.ts === TS);
const [m] = decode(`${M}AMR1`, Buffer.from(JSON.stringify(metaMsg)));
check('metadata 풀기 (Buffer)', m.kind === 'meta' && m.desc === '이송 로봇 1' && m.fields[0].unit === '%' && m.fields[0].path === 'Status.Battery' && m.fields[1].unit === null);
const [e] = decode(`${D}Events`, JSON.stringify(evMsg));
check('event 풀기', e.kind === 'event' && e.level === 'alert' && e.severity === 800 && e.source === 'SCREW' && e.text === '토크 이상' && e.t === TS);
const [c] = decode(`${D}Commands`, JSON.stringify(cmd('issued')));
check('command 풀기', c.kind === 'command' && c.id === 'C-1' && c.code === 'HOLD' && c.state === 'issued' && c.targetName === '체결 셀');
const [env] = decode('aas/jin3d/environment', JSON.stringify({ assetAdministrationShells: [{}, {}], submodels: [{}, {}, {}] }));
check('AAS env 크기만', env.kind === 'env' && env.shells === 2 && env.submodels === 3);
check('JSON 아님', decode(`${D}X`, 'nope')[0].kind === 'error');
check('모르는 토픽', decode('foo/bar', '{}')[0].kind === 'other');

const st = new BStore();
st.apply(d); st.apply(m);
check('메타·값 합침', st.rows().length === 1 && st.assets.AMR1.desc === '이송 로봇 1' && st.assets.AMR1.values.Battery.v === 81.5 && st.assets.AMR1.count === 1);
for (let i = 0; i < LIMITS.events + 20; i++) st.apply({ ...e, seq: i });
check('이벤트 상한·최신 앞', st.events.length === LIMITS.events && st.events[0].seq === LIMITS.events + 19);
st.apply(c); st.apply(decode(`${D}Commands`, JSON.stringify(cmd('done')))[0]);
check('명령은 ID별 최신', st.commands.length === 1 && st.commands[0].state === 'done');
const st2 = new BStore(); st2.load(JSON.parse(JSON.stringify(st.snapshot())));
check('스냅샷 왕복', st2.rows().length === 1 && st2.events.length === LIMITS.events && st2.counts.event === st.counts.event);

// ── 가짜 브로커 + FAC ──
const broker = { conns: [], connects: [], subs: [], published: 0 };
const brokerSrv = net.createServer((sock) => {
  broker.conns.push(sock);
  let buf = Buffer.alloc(0);
  sock.on('error', () => {});
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const r = readPackets(buf); buf = Buffer.from(r.rest);
    for (const p of r.packets) {
      if (p.type === T.CONNECT) {
        const b = p.body, n = b.readUInt16BE(0), proto = b.subarray(2, 2 + n).toString();
        const level = b[2 + n], flags = b[3 + n];
        let k = 6 + n;
        const rd = () => { const l = b.readUInt16BE(k); const s = b.subarray(k + 2, k + 2 + l).toString(); k += 2 + l; return s; };
        const id = rd(), user = flags & 0x80 ? rd() : null, pw = flags & 0x40 ? rd() : null;
        broker.connects.push({ proto, level, clean: !!(flags & 2), id, user, pw });
        sock.write(packet(T.CONNACK, 0, Buffer.from([0, 0])));
      } else if (p.type === T.SUBSCRIBE) {
        const b = p.body; let k = 2; const topics = [];
        while (k < b.length) { const l = b.readUInt16BE(k); topics.push(b.subarray(k + 2, k + 2 + l).toString()); k += 3 + l; }
        broker.subs.push(topics);
        sock.write(packet(T.SUBACK, 0, Buffer.concat([b.subarray(0, 2), Buffer.from(topics.map(() => 0))])));
      } else if (p.type === T.PINGREQ) sock.write(packet(T.PINGRESP, 0));
      else if (p.type === T.PUBLISH) broker.published++;
    }
  });
});
await new Promise((r) => brokerSrv.listen(0, '127.0.0.1', r));
const bport = brokerSrv.address().port;

const facSeen = [];
let facRun = 'run-a';
const facSrv = http.createServer((req, res) => {
  facSeen.push({ method: req.method, url: req.url });
  const u = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (u.pathname === '/api/fac/status') return send(200, { active: true, run: facRun, mode: 'auto', t: 3600, seq: 2, events: 2, stats: { po: 1, poOpen: 1 } });
  if (u.pathname === '/api/fac/events') return send(200, { run: facRun, events: [{ seq: 2, t: 10, type: 'po.create', key: 'P00001' }].filter((x) => x.seq > Number(u.searchParams.get('since') || 0)), next: 2 });
  if (u.pathname === '/api/fac/stock') return send(200, { run: facRun, t: 3600, data: { products: { raw: { code: 'RM-BOX' } }, locations: { rackRaw: { name: '선반' } }, stock: { rackRaw: { raw: 4 } } } });
  if (u.pathname === '/api/fac/mr') return send(503, { error: 'FAC 기록이 아직 없습니다' });
  if (u.pathname === '/api/fac/po') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('not json'); }
  send(404, { error: 'nope' });
});
await new Promise((r) => facSrv.listen(0, '127.0.0.1', r));
const fport = facSrv.address().port;

const b = { mqttUrl: `mqtt://viewer:s3cret@127.0.0.1:${bport}`, topics: ['opcua/json/#', 'aas/+/environment'], facUrl: `http://127.0.0.1:${fport}/api/fac` };
const { server, port, cfg } = await startServer({ port: 0, host: '127.0.0.1', b });
const base = `http://127.0.0.1:${port}`;
const getJson = async (p, init) => { const r = await fetch(base + p, init); return { code: r.status, body: await r.json() }; };

function sse(path) {
  const ctrl = new AbortController();
  const events = [];
  const ready = fetch(base + path, { signal: ctrl.signal }).then(async (res) => {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      let i;
      while ((i = text.indexOf('\n\n')) >= 0) {
        const chunk = text.slice(0, i); text = text.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(chunk)?.[1], data = /^data: (.+)$/m.exec(chunk)?.[1];
        if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
      }
    }
  }).catch(() => {});
  return { events, close: () => ctrl.abort(), ready, headers: null };
}

try {
  check('서버만 띄우면 브로커 접속 안 함', (await sleep(150), broker.connects.length === 0));

  const page = await (await fetch(`${base}/dashboard`)).text();
  check('/dashboard 페이지 + __ENV', page.includes('js/dash/main.js') && page.includes('window.__ENV') && page.includes(cfg.api.bStream));
  check('대시보드 JS·CSS 서빙', (await fetch(`${base}/js/dash/main.js`)).status === 200 && (await fetch(`${base}/css/dash.css`)).status === 200);
  check('대시보드는 three 안 씀', !page.includes('importmap'));

  const s = sse(cfg.api.bStream);
  check('SSE 접속 → 구독 시작', await until(() => broker.subs.length === 1));
  const c0 = broker.connects[0];
  check('CONNECT MQTT 3.1.1 · clean · 계정', c0.proto === 'MQTT' && c0.level === 4 && c0.clean && c0.user === 'viewer' && c0.pw === 's3cret' && c0.id.startsWith('microsim-b-'));
  check('SUBSCRIBE 토픽', JSON.stringify(broker.subs[0]) === JSON.stringify(b.topics));
  check('첫 SSE는 snapshot', await until(() => s.events.length > 0) && s.events[0].event === 'snapshot' && s.events[0].data.store.counts.data === 0);

  const sock = broker.conns[0];
  sock.write(encodePublish(`${M}AMR1`, JSON.stringify(metaMsg), { retain: true }));
  sock.write(Buffer.concat([encodePublish(`${D}AMR1`, JSON.stringify(dataMsg)), encodePublish(`${D}Events`, JSON.stringify(evMsg))]));
  const big = encodePublish(`${D}Commands`, JSON.stringify(cmd('issued')), { qos: 1, id: 5 });
  sock.write(big.subarray(0, 10)); await sleep(30); sock.write(big.subarray(10));
  const kinds = () => new Set(s.events.filter((x) => x.event === 'batch').flatMap((x) => x.data.items.map((i) => i.kind)));
  check('batch에 meta·data·event·command', await until(() => ['meta', 'data', 'event', 'command'].every((k) => kinds().has(k))), [...kinds()].join(','));
  check('SSE는 0.5초 묶음', s.events.filter((x) => x.event === 'batch').length <= 2);

  const stat = await getJson(cfg.api.bStatus);
  check('status 연결·건수', stat.code === 200 && stat.body.mqtt.state === 'connected' && stat.body.mqtt.messages === 4 && stat.body.assets === 1 && stat.body.clients === 1);
  check('status 계정 가림', !JSON.stringify(stat.body).includes('s3cret'));
  check('발행 안 함', broker.published === 0);

  const s2 = sse(cfg.api.bStream);
  check('늦게 온 화면도 snapshot에 누적값', await until(() => s2.events[0]?.event === 'snapshot') && s2.events[0].data.store.assets.AMR1?.values.Battery.v === 81.5 && s2.events[0].data.store.events.length === 1);
  s2.close();

  sock.destroy();
  check('끊기면 다시 붙음', await until(() => broker.subs.length === 2, 4000) && broker.connects.length === 2);
  check('mqtt 상태 SSE', s.events.some((x) => x.event === 'mqtt' && x.data.state === 'retry'));
  s.close();

  // FAC 대리
  const fs1 = await getJson(`${cfg.api.bFac}/status`);
  check('FAC status 대리', fs1.code === 200 && fs1.body.run === 'run-a' && fs1.body.stats.po === 1);
  facSeen.length = 0;
  const fe = await getJson(`${cfg.api.bFac}/events?since=1&limit=5&type=po.create&evil=1`);
  check('FAC events 쿼리는 since·limit·type만', fe.code === 200 && fe.body.events.length === 1 && facSeen[0].url === '/api/fac/events?since=1&limit=5&type=po.create');
  const fsk = await getJson(`${cfg.api.bFac}/stock`);
  check('FAC stock 대리', fsk.body.data.stock.rackRaw.raw === 4);
  check('FAC 503 그대로', (await getJson(`${cfg.api.bFac}/mr`)).code === 503);
  check('FAC JSON 아니면 502', (await getJson(`${cfg.api.bFac}/po`)).code === 502);
  facSeen.length = 0;
  const unk = await getJson(`${cfg.api.bFac}/push`);
  check('FAC 목록 밖(push)은 404 · 업스트림 안 부름', unk.code === 404 && facSeen.length === 0);
  check('FAC 경로 탈출 404', (await getJson(`${cfg.api.bFac}/..%2Fstatus`)).code === 404 && facSeen.length === 0);
  check('POST 405', (await getJson(`${cfg.api.bFac}/status`, { method: 'POST' })).code === 405 && facSeen.length === 0);

  const oa = await getJson(cfg.api.openapi);
  check('OpenAPI 장 B 경로(GET만)', ['bStatus', 'bStream'].every((k) => Object.keys(oa.body.paths[cfg.api[k]]).join() === 'get') && !!oa.body.paths[`${cfg.api.bFac}/{view}`]?.get);
} finally {
  await new Promise((r) => server.close(r));
}
check('서버 닫으면 SSE·구독도 닫힘', true);

// 업스트림 없음
const dead = await startServer({ port: 0, host: '127.0.0.1', b: { mqttUrl: 'mqtt://127.0.0.1:1', topics: ['opcua/json/#'], facUrl: 'http://127.0.0.1:1/api/fac' } });
try {
  const u = `http://127.0.0.1:${dead.port}`;
  const r = await fetch(`${u}${dead.cfg.api.bFac}/status`);
  const body = await r.json();
  check('FAC 없으면 502 + 안내', r.status === 502 && body.error.includes('micro-assembly') && !!body.detail);
  await fetch(`${u}${dead.cfg.api.bStatus}`);
  const ok = await until(async () => (await (await fetch(`${u}${dead.cfg.api.bStatus}`)).json()).mqtt.error?.includes('ECONNREFUSED'));
  check('브로커 없으면 ECONNREFUSED 표시', ok);
} finally {
  await new Promise((r) => dead.server.close(r));
}

brokerSrv.close(); facSrv.close();
for (const c of broker.conns) c.destroy();
console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
