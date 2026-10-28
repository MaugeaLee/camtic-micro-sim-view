// 장 B 데모 소스(`npm run demo` · `node server.mjs --b-demo`). micro-assembly 없이 구독 대시보드·수신 점검을 돌려 보려는 것.
// 이 뷰어 시뮬(js/sim, faults 시나리오: 9분 주기로 셀 고장 3건)을 서버 안에서 돌리고, 같은 모양의 OPC UA PubSub JSON 을 프로세스 안 MQTT 브로커로,
// 입고·출고 기록을 가짜 FAC API 로 내놓는다. 모두 127.0.0.1 임시 포트. 값은 시뮬 가정값이다 — 현장·micro-assembly 값이 아니다.
// 수신 점검이 실제로 잡는지 보려고 일부러 섞는 것: 45 s 마다 AMR 값 한 건 빠뜨림(seq 누락), 60 s 마다 JSON 아닌 메시지 한 건.
import http from 'node:http';
import net from 'node:net';
import { ViewerState } from '../js/sim/state.js';
import { encodePublish, packet, readPackets, T, parsePublish } from './mqtt.mjs';
import { loadProcess } from './process.mjs';

const PUB = 'demo';
const GROUP = 'CamticSim';
const D = `opcua/json/data/${PUB}/${GROUP}/`;
const M = `opcua/json/metadata/${PUB}/${GROUP}/`;
const SEVERITY = { alert: 800, error: 800, warn: 600, plan: 400, act: 300, ok: 200, info: 100 };
const FAC_EVENTS_MAX = 20000;

export function topicMatch(filter, topic) {
  const f = filter.split('/'), t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

// 구독만 받는 최소 브로커: CONNECT · SUBSCRIBE(QoS 0) · PINGREQ · retained. 외부 발행은 받지 않는다(데모 발행기만).
export class DemoBroker {
  constructor() {
    this.clients = new Set();
    this.retained = new Map();
    this.inbound = 0;
    this.server = net.createServer((sock) => this.accept(sock));
  }

  listen(host = '127.0.0.1', port = 0) {
    return new Promise((ok, bad) => {
      this.server.once('error', bad);
      this.server.listen(port, host, () => ok(this.server.address().port));
    });
  }

  accept(sock) {
    const c = { sock, subs: [], buf: Buffer.alloc(0) };
    this.clients.add(c);
    sock.on('data', (chunk) => {
      const { packets, rest, error } = readPackets(Buffer.concat([c.buf, chunk]), 1 << 20);
      if (error) { sock.destroy(); return; }
      c.buf = rest;
      for (const p of packets) this.onPacket(c, p);
    });
    sock.on('error', () => {});
    sock.on('close', () => this.clients.delete(c));
  }

  onPacket(c, p) {
    if (p.type === T.CONNECT) c.sock.write(packet(T.CONNACK, 0, Buffer.from([0, 0])));
    else if (p.type === T.SUBSCRIBE) {
      const id = p.body.readUInt16BE(0);
      const got = [];
      for (let k = 2; k + 2 <= p.body.length;) {
        const n = p.body.readUInt16BE(k);
        got.push(p.body.subarray(k + 2, k + 2 + n).toString('utf8'));
        k += 3 + n;
      }
      c.subs.push(...got);
      c.sock.write(packet(T.SUBACK, 0, Buffer.concat([Buffer.from([id >> 8, id & 0xff]), Buffer.alloc(got.length, 0)])));
      for (const [topic, payload] of this.retained) if (got.some((f) => topicMatch(f, topic))) c.sock.write(encodePublish(topic, payload, { retain: true }));
    } else if (p.type === T.PINGREQ) c.sock.write(packet(T.PINGRESP, 0));
    else if (p.type === T.DISCONNECT) c.sock.end();
    else if (p.type === T.PUBLISH) { parsePublish(p); this.inbound++; }   // 받기만 하고 버린다(구독 측이 발행했는지 세려고 센다)
  }

  publish(topic, payload, { retain = false } = {}) {
    if (retain) this.retained.set(topic, payload);
    let pkt = null;
    for (const c of this.clients) {
      if (!c.subs.some((f) => topicMatch(f, topic))) continue;
      if (c.sock.writableLength > 4 << 20) continue;   // 느린 구독자는 건너뜀
      c.sock.write(pkt ??= encodePublish(topic, payload));
    }
  }

  close() {
    for (const c of this.clients) c.sock.destroy();
    this.clients.clear();
    return new Promise((ok) => this.server.close(() => ok()));
  }
}

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v ?? null);
const fld = (Value, ts) => ({ Value, SourceTimestamp: ts });

// 시뮬 → 데이터셋. writer 이름 → { desc, fields: [[이름, 설명, 단위, 타입]], values(plant) }
function writers(state) {
  const P = state.plant;
  const out = [];
  out.push({ name: 'Plant', desc: '데모 시뮬 공장 요약', fields: [['SimTime', '시뮬 시각', 's', 11], ['Kits', '키트 수', '', 6], ['Delivered', '배송', '', 6], ['Shipped', '출하', '', 6]],
    values: () => ({ SimTime: r2(state.time), Kits: P.kits.length, Delivered: P.delivered, Shipped: P.work.OUT?.shipped ?? 0 }) });
  const health = () => Object.fromEntries(P.health.view().map((h) => [h.id, h]));
  for (const id of Object.keys(P.units)) {
    out.push({ name: `Cell_${id}`, desc: `${id} 셀(시뮬)`, fields: [['State', '상태', '', 12], ['Done', '완료', '', 6], ['Stock', '재고', '', 6], ['Progress', '진행', '', 11], ['Health', '건강도(가정)', '%', 11], ['Drift', '드리프트(가정)', '‰', 11]],
      values: () => { const u = P.units[id], h = health()[id]; return { State: u.state, Done: u.done, Stock: u.stock, Progress: r2(u.progress), Health: h?.health ?? null, Drift: h?.drift ?? null }; } });
  }
  for (const a of P.allAmrs) {
    out.push({ name: `AMR_${a.id}`, desc: `${a.id} 이송 로봇(시뮬)`, amr: true, fields: [['X', 'x', 'm', 11], ['Z', 'z', 'm', 11], ['Battery', '배터리', '%', 11], ['Mode', '모드', '', 12], ['Load', '적재 목적지', '', 12]],
      values: () => ({ X: r2(a.x), Z: r2(a.z), Battery: r2(a.battery), Mode: a.mode, Load: a.load?.dest ?? null }) });
  }
  for (const r of P.robots) {
    const id = r.id;
    out.push({ name: `Robot_${id}`, desc: `${id} ${r.role === 'recover' ? '리커버리 견마' : r.role === 'inspect' ? '설비 점검 견마' : r.role === 'stock' ? '재고 실사 드론' : '공정 검사 드론'}(시뮬)`,
      fields: [['Role', '역할', '', 12], ['X', 'x', 'm', 11], ['Y', '고도', 'm', 11], ['Z', 'z', 'm', 11], ['Battery', '배터리', '%', 11], ['Mode', '모드', '', 12], ['Task', '작업', '', 12]],
      values: () => { const v = P.robots.find((x) => x.id === id); return v ? { Role: v.role, X: r2(v.x), Y: r2(v.y ?? 0), Z: r2(v.z), Battery: v.battery == null ? null : r2(v.battery), Mode: v.mode, Task: v.task } : {}; } });
  }
  return out;
}

export class DemoPublisher {
  constructor(broker, { speed = 1, faults = true } = {}) {
    this.broker = broker;
    this.speed = speed;
    this.faults = faults;
    const loaded = loadProcess();
    this.state = new ViewerState({ scenario: 'faults', process: loaded.ok ? loaded.doc : null });
    this.ws = writers(this.state);
    this.seq = {};
    this.lastLog = 0;
    this.tick = 0;
    this.fac = { run: `demo-${Date.now().toString(36)}`, events: [], next: 0, stored: 0, shipped: 0, stats: { productions: 0, deliveries: 0 } };
    this.injected = { gaps: 0, junk: 0 };
    this.timer = null;
  }

  start(ms = 1000) {
    this.publishMeta();
    this.timer = setInterval(() => this.step(ms / 1000), ms);
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  nextSeq(w) { return (this.seq[w] = (this.seq[w] ?? 0) + 1); }

  publishMeta() {
    for (const w of this.ws) {
      this.broker.publish(`${M}${w.name}`, JSON.stringify({ MessageId: `meta-${w.name}`, MessageType: 'ua-metadata', PublisherId: PUB, MetaData: {
        Name: w.name, Description: { Locale: 'ko-KR', Text: w.desc },
        Fields: w.fields.map(([Name, d, unit, BuiltInType]) => ({ Name, Description: { Locale: 'ko-KR', Text: d }, BuiltInType,
          Properties: unit ? [{ Key: { Name: 'EngineeringUnits' }, Value: unit }] : [] })),
      } }), { retain: true });
    }
    this.broker.publish(`aas/${PUB}/environment`, JSON.stringify({ assetAdministrationShells: this.ws.map((w) => ({ idShort: w.name })), submodels: this.ws.map((w) => ({ idShort: `${w.name}_Status` })) }), { retain: true });
  }

  step(dt) {
    const S = this.state;
    for (let t = 0; t < dt * this.speed - 1e-9; t += 0.1) S.step(0.1);
    S.drainEvents();   // 렌더 이벤트는 서버에서 쓰지 않는다(안 비우면 쌓인다)
    this.tick++;
    const ts = new Date().toISOString();
    for (const w of this.ws) {
      const seq = this.nextSeq(w.name);
      if (this.faults && w.amr && this.tick % 45 === 0 && w === this.ws.find((x) => x.amr)) { this.injected.gaps++; continue; }
      const values = w.values();
      this.broker.publish(`${D}${w.name}`, JSON.stringify({ MessageId: `${w.name}-${seq}`, MessageType: 'ua-data', PublisherId: PUB, WriterGroupName: GROUP, Messages: [{
        DataSetWriterName: w.name, SequenceNumber: seq, Timestamp: ts, MessageType: 'ua-keyframe',
        Payload: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, fld(v, ts)])),
      }] }));
    }
    const fresh = S.logs.filter((l) => l.id > this.lastLog).reverse();
    if (fresh.length) this.lastLog = fresh.at(-1).id;
    for (const l of fresh.slice(-40)) {
      const lv = l.level === 'error' ? 'alert' : l.level;
      const seq = this.nextSeq('Events');
      this.broker.publish(`${D}Events`, JSON.stringify({ MessageType: 'ua-data', PublisherId: PUB, WriterGroupName: GROUP, Messages: [{
        DataSetWriterName: 'Events', SequenceNumber: seq, Timestamp: ts, MessageType: 'ua-event',
        Payload: { EventId: fld(`ev-${l.id}`), EventType: fld(`ns=1;s=Demo.${lv}`), SourceName: fld(l.title.split(' ')[0]), Time: fld(ts),
          Severity: fld(SEVERITY[lv] ?? 100), Message: fld({ Locale: 'ko-KR', Text: `${l.title}${l.obs ? ` — ${l.obs}` : ''}` }) },
      }] }));
      if (l.level === 'act') {
        const cseq = this.nextSeq('Commands');
        const target = l.title.split(' ')[0];
        this.broker.publish(`${D}Commands`, JSON.stringify({ MessageType: 'ua-data', PublisherId: PUB, WriterGroupName: GROUP, Messages: [{
          DataSetWriterName: 'Commands', SequenceNumber: cseq, Timestamp: ts, MessageType: 'ua-keyframe',
          Payload: Object.fromEntries(Object.entries({ CommandId: `D-${l.id}`, Code: 'DISPATCH', Name: l.title, Group: 'robot', Target: target, TargetName: target,
            Argument: '', Issuer: '데모 시뮬', Reason: l.obs ?? '', State: 'done', Note: '시뮬 출동 기록' }).map(([k, v]) => [k, fld(v, ts)])),
        }] }));
      }
    }
    if (this.faults && this.tick % 60 === 30) { this.injected.junk++; this.broker.publish(`${D}Noise`, 'not-json {'); }
    this.facStep();
  }

  facEvent(e) {
    this.fac.events.push({ i: this.fac.next++, t: this.state.time, ...e });
    if (this.fac.events.length > FAC_EVENTS_MAX) this.fac.events.splice(0, this.fac.events.length - FAC_EVENTS_MAX);
  }

  facStep() {
    const O = this.state.plant.work.OUT;
    if (!O) return;
    while (this.fac.stored < O.stored) { this.fac.stored++; this.fac.stats.productions++; this.facEvent({ type: 'production.done', key: `PRD-${this.fac.stored}`, lines: [{ product: 'KIT', qty: 1 }] }); }
    while (this.fac.shipped < O.shipped) { this.fac.shipped++; this.fac.stats.deliveries++; this.facEvent({ type: 'delivery.done', key: `DLV-${this.fac.shipped}`, lines: [{ product: 'KIT', qty: 1 }] }); }
  }

  // GET /api/fac/<view>
  facApi(view, q) {
    const F = this.fac, P = this.state.plant;
    if (view === 'status') return { code: 200, body: { active: true, run: F.run, mode: '데모(이 뷰어 시뮬)', t: this.state.time, events: F.next, stats: { ...F.stats, equipment: Object.keys(P.units).length } } };
    if (view === 'events') {
      const since = Math.max(0, Number(q.get('since')) || 0), limit = Math.min(1000, Math.max(1, Number(q.get('limit')) || 200));
      const events = F.events.filter((e) => e.i >= since).slice(0, limit);
      return { code: 200, body: { run: F.run, events, next: events.length ? events.at(-1).i + 1 : Math.max(since, F.events[0]?.i ?? since) } };
    }
    if (view === 'stock') {
      const O = P.work.OUT;
      return { code: 200, body: { run: F.run, data: {
        stock: { OUT: { KIT: O ? O.stored - O.shipped : 0 }, RACK: { KIT: P.rack ? P.rack.items.filter(Boolean).length : 0 } },
        products: { KIT: { code: 'KIT', name: '키트(데모)' } }, locations: { OUT: { name: '완료품 책장' }, RACK: { name: '랙' } },
      } } };
    }
    return { code: 404, body: { error: `데모 FAC 에 없는 조회: ${view}` } };
  }
}

// 브로커 + 발행기 + FAC. conf 는 ChapterB 설정에 그대로 넣는다.
export async function startBDemo({ host = '127.0.0.1', speed = 1, faults = true, interval = 1000 } = {}) {
  const broker = new DemoBroker();
  const mqttPort = await broker.listen(host, 0);
  const pub = new DemoPublisher(broker, { speed, faults });
  const fac = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${host}`);
    const m = /^\/api\/fac\/([a-z]+)$/.exec(url.pathname);
    const { code, body } = req.method === 'GET' && m ? pub.facApi(m[1], url.searchParams) : { code: 404, body: { error: 'not found' } };
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  });
  const facPort = await new Promise((ok) => fac.listen(0, host, () => ok(fac.address().port)));
  pub.start(interval);
  return {
    broker, pub, fac,
    conf: { mqttUrl: `mqtt://${host}:${mqttPort}`, topics: ['opcua/json/#', 'aas/+/environment'], facUrl: `http://${host}:${facPort}/api/fac`, demo: true },
    async close() { pub.stop(); await broker.close(); await new Promise((ok) => fac.close(() => ok())); },
  };
}
