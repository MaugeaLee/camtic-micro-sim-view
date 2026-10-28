// 조인(V3-3): 장 B MQTT PubSub JSON → 장 C 모양 ZeroMQ PUB. `docx/09-limits-and-join.md` 「조인」의 NEW bridge 자리.
// 장 C 의 MsgDataDTO 정의를 이 레포에서 확인하지 못했다 — 아래 DTO(`camtic-sim-bridge/0`)·토픽 규칙은 **가정**이다.
// edge_forwarder 가 이 토픽·본문을 받는지 확인한 적 없다. 붙일 때 장 C 코드와 대조해 toDto 만 고치면 되게 한 곳에 모았다.
// 하는 일: data 항목만 넘긴다(이벤트·명령·AAS 환경은 안 넘김). MQTT 로 발행하지 않고, ZeroMQ 명령(cmd)을 받지 않는다.
import fs from 'node:fs';
import { MqttSub, maskUrl } from './mqtt.mjs';
import { PubSocket } from './zmtp.mjs';
import { decode } from '../js/data/pubsub.js';

export const DTO_SCHEMA = 'camtic-sim-bridge/0';
export const KIND = 'sim';

export function readJoinConfig(env = process.env) {
  return {
    mqttUrl: env.B_MQTT_URL || 'mqtt://127.0.0.1:1883',
    topics: String(env.JOIN_MQTT_TOPICS || 'opcua/json/#').split(',').map((s) => s.trim()).filter(Boolean),
    zmqBind: env.JOIN_ZMQ_BIND || 'tcp://127.0.0.1:5558',
    tagMap: env.JOIN_TAG_MAP || null,
    healthMs: Number(env.JOIN_HEALTH_MS) || 5000,
  };
}

// tag_map.json: { "<DataSetWriter>/<필드>": "<OPC UA browse path>" }. engineering.csv 에서 만든다는 것은 09 의 제안(미확인).
export function loadTagMap(file) {
  if (!file) return {};
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('tag_map.json 은 { "writer/field": "browse path" } 객체');
  for (const [k, v] of Object.entries(doc)) if (typeof v !== 'string' || !k.includes('/')) throw new Error(`tag_map 항목이 이상함: ${k}`);
  return doc;
}

export function deviceKey(writer) {
  return String(writer).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

export const dataTopic = (key) => `collector.${KIND}.${key}.data`;
export const HEALTH_TOPIC = `collector.${KIND}.bridge.health`;

const ms = (t) => { const v = typeof t === 'string' ? Date.parse(t) : NaN; return Number.isFinite(v) ? v : null; };

// data 항목 + 그 자산 메타 → { topic, body }. 가정 DTO.
export function toDto(item, { meta = null, tagMap = {}, mqttTopic = null, now = Date.now() } = {}) {
  const key = deviceKey(item.writer);
  const fields = new Map((meta?.fields ?? []).map((f) => [f.name, f]));
  const tags = Object.entries(item.values).map(([name, x]) => {
    const f = fields.get(name);
    return {
      name, value: x?.v ?? null, quality: x?.v == null ? 'bad' : 'good', ts_ms: ms(x?.ts),
      unit: f?.unit ?? null, label: f?.label || null, aas_path: f?.path ?? null,
      browse_path: tagMap[`${item.writer}/${name}`] ?? null,
    };
  });
  return {
    topic: dataTopic(key),
    body: {
      schema: DTO_SCHEMA, kind: KIND, device_key: key,
      timestamp_ms: ms(item.t) ?? now, received_ms: now, seq: item.seq ?? null,
      source: { chapter: 'B', publisher: item.publisher, group: item.group ?? null, writer: item.writer, mqtt_topic: mqttTopic },
      tags,
    },
  };
}

export class Bridge {
  constructor(conf, { tagMap = loadTagMap(conf.tagMap) } = {}) {
    this.conf = conf;
    this.tagMap = tagMap;
    this.meta = new Map();
    this.devices = new Set();
    this.stats = { received: 0, items: 0, published: 0, noSubscriber: 0, skipped: 0, errors: 0 };
    this.pub = new PubSocket();
    this.sub = new MqttSub({ url: conf.mqttUrl, topics: conf.topics });
    this.sub.on('message', (topic, payload) => this.onMessage(topic, payload));
    this.timer = null;
    this.address = null;
  }

  async start() {
    this.address = await this.pub.bind(this.conf.zmqBind);
    this.sub.start();
    this.timer = setInterval(() => this.health(), this.conf.healthMs);
    this.timer.unref?.();
    return this;
  }

  get endpoint() { return this.address ? `tcp://${this.address.address}:${this.address.port}` : null; }

  onMessage(topic, payload, now = Date.now()) {
    this.stats.received++;
    for (const item of decode(topic, payload)) {
      this.stats.items++;
      if (item.kind === 'meta') { this.meta.set(item.writer, item); continue; }
      if (item.kind === 'error') { this.stats.errors++; continue; }
      if (item.kind !== 'data') { this.stats.skipped++; continue; }
      const { topic: zt, body } = toDto(item, { meta: this.meta.get(item.writer), tagMap: this.tagMap, mqttTopic: topic, now });
      this.devices.add(body.device_key);
      if (this.pub.send([zt, JSON.stringify(body)])) this.stats.published++;
      else this.stats.noSubscriber++;
    }
  }

  status() {
    return {
      schema: DTO_SCHEMA, kind: KIND, device_key: 'bridge', timestamp_ms: Date.now(),
      mqtt: { url: maskUrl(this.conf.mqttUrl), state: this.sub.status.state, topics: this.conf.topics },
      zmq: { bind: this.endpoint, subscribers: this.pub.subscribers, dropped: this.pub.dropped },
      devices: this.devices.size, meta: this.meta.size, ...this.stats,
    };
  }

  health() { this.pub.send([HEALTH_TOPIC, JSON.stringify(this.status())]); }

  async stop() {
    clearInterval(this.timer);
    this.sub.stop();
    await this.pub.close();
  }
}
