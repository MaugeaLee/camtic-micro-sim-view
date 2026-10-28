// 장 B 구독(V3-1): micro-assembly 브로커를 구독해 SSE로 넘기고, FAC API는 GET만 대신 부른다. 발행·쓰기 없음.
// 브로커 연결은 첫 대시보드 접속(/api/b/stream·status) 때 시작한다 — 서버만 띄우면 1883을 두드리지 않는다.
import { MqttSub } from './mqtt.mjs';
import { BStore, TopicStats, coalesce, decode } from '../js/data/pubsub.js';

export const FAC_VIEWS = Object.freeze(['status', 'events', 'po', 'moves', 'stock', 'mr', 'equipment', 'orderpoints', 'master']);
const FAC_QUERY = ['since', 'limit', 'type'];
const FLUSH_MS = 500;
const FAC_TIMEOUT = 3000;
const PENDING_MAX = 2000;         // 플러시 전 쌓인 항목이 이만큼이면 미리 합친다
const SSE_LAG = 1024 * 1024;      // 소켓 버퍼가 이보다 크면 그 클라이언트는 건너뛰고, 따라잡으면 스냅샷으로 다시 맞춘다

export function readBConfig(env = process.env) {
  const topics = String(env.B_MQTT_TOPICS || 'opcua/json/#,aas/+/environment').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    mqttUrl: env.B_MQTT_URL || 'mqtt://127.0.0.1:1883',
    topics,
    facUrl: String(env.B_FAC_URL || 'http://127.0.0.1:8765/api/fac').replace(/\/+$/, ''),
  };
}

export class ChapterB {
  constructor(conf) {
    this.conf = conf;
    this.store = new BStore();
    this.stats = new TopicStats();
    this.lagSkips = 0;
    this.resyncs = 0;
    this.clients = new Set();
    this.pending = [];
    this.flushTimer = null;
    this.sub = new MqttSub({ url: conf.mqttUrl, topics: conf.topics });
    this.sub.on('message', (topic, payload) => this.onMessage(topic, payload));
    this.sub.on('state', () => this.send('mqtt', this.sub.status));
  }

  ensure() { this.sub.start(); }

  onMessage(topic, payload) {
    const now = Date.now();
    const at = new Date(now).toISOString();
    const items = decode(topic, payload);
    this.stats.add(topic, payload, items, now);
    for (const item of items) {
      this.store.apply(item, at);
      this.pending.push(item);
    }
    if (this.pending.length > PENDING_MAX) this.pending = coalesce(this.pending);
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  flush() {
    this.flushTimer = null;
    if (!this.pending.length) return;
    const items = coalesce(this.pending); this.pending = [];
    this.send('batch', { at: this.store.lastAt, items, counts: this.store.counts });
  }

  snapshotLine() {
    return `event: snapshot\ndata: ${JSON.stringify({ mqtt: this.sub.status, demo: !!this.conf.demo, store: this.store.snapshot() })}\n\n`;
  }

  send(event, data) {
    if (!this.clients.size) return;
    let line = null;
    for (const res of this.clients) {
      if (res.writableLength > SSE_LAG) { res.stale = true; this.lagSkips++; continue; }
      if (res.stale && event === 'batch') { res.stale = false; this.resyncs++; res.write(this.snapshotLine()); continue; }
      res.write(line ??= `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }

  status() {
    return {
      mqtt: this.sub.status, fac: this.conf.facUrl, demo: !!this.conf.demo, clients: this.clients.size, counts: this.store.counts,
      assets: this.store.nAssets, topics: this.stats.topics.size, topicOverflow: this.stats.overflow, lagSkips: this.lagSkips, resyncs: this.resyncs,
    };
  }

  // 수신 점검: 토픽 통계 + 최근 원문. 화면이 열려 있을 때만 1초 간격으로 부른다(SSE 로 원문을 흘리지 않는다).
  inspect() {
    this.ensure();
    return { mqtt: this.sub.status, demo: !!this.conf.demo, counts: this.store.counts, ...this.stats.view() };
  }

  stream(req, res) {
    this.ensure();
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 3000\n\n');
    res.write(this.snapshotLine());
    this.clients.add(res);
    const beat = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(beat); this.clients.delete(res); });
  }

  async fac(name, url) {
    if (!FAC_VIEWS.includes(name)) return { code: 404, body: { error: `FAC 조회 없음: ${name}`, views: FAC_VIEWS } };
    const q = new URLSearchParams();
    for (const k of FAC_QUERY) if (url.searchParams.has(k)) q.set(k, url.searchParams.get(k));
    const target = `${this.conf.facUrl}/${name}${q.size ? `?${q}` : ''}`;
    try {
      const r = await fetch(target, { signal: AbortSignal.timeout(FAC_TIMEOUT) });
      const text = await r.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { error: 'FAC 응답이 JSON 아님' }; return { code: 502, body }; }
      return { code: r.status, body };
    } catch (e) {
      return { code: 502, body: { error: 'FAC API 응답 없음 — micro-assembly 서버가 떠 있는지 확인', detail: e.name === 'TimeoutError' ? '시간 초과' : (e.cause?.code ?? e.message) } };
    }
  }

  close() {
    clearTimeout(this.flushTimer);
    this.sub.stop();
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
