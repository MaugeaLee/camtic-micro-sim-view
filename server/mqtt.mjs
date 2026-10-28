// 구독 전용 MQTT 3.1.1 클라이언트(node:net). 의존성 없음. 발행하지 않는다.
// CONNECT · SUBSCRIBE(QoS 0) · PUBLISH 수신(QoS 1이면 PUBACK) · PINGREQ · 끊기면 다시 붙음. TLS(mqtts) 없음.
import net from 'node:net';
import { EventEmitter } from 'node:events';

export const MAX_PACKET = 32 * 1024 * 1024;
export const T = Object.freeze({ CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4, SUBSCRIBE: 8, SUBACK: 9, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14 });

const str = (s) => {
  const b = Buffer.from(String(s), 'utf8');
  const h = Buffer.alloc(2); h.writeUInt16BE(b.length);
  return Buffer.concat([h, b]);
};
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };

export function encodeLength(n) {
  const out = [];
  do {
    let d = n % 128; n = Math.floor(n / 128);
    if (n > 0) d |= 0x80;
    out.push(d);
  } while (n > 0);
  return Buffer.from(out);
}

export function packet(type, flags, body = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([(type << 4) | flags]), encodeLength(body.length), body]);
}

export function encodeConnect({ clientId, username, password, keepalive = 30 }) {
  let flags = 0x02;
  if (username != null && username !== '') flags |= 0x80;
  if (password != null && password !== '') flags |= 0x40;
  const parts = [str('MQTT'), Buffer.from([4, flags]), u16(keepalive), str(clientId)];
  if (flags & 0x80) parts.push(str(username));
  if (flags & 0x40) parts.push(str(password));
  return packet(T.CONNECT, 0, Buffer.concat(parts));
}

export function encodeSubscribe(id, topics) {
  return packet(T.SUBSCRIBE, 2, Buffer.concat([u16(id), ...topics.map((t) => Buffer.concat([str(t), Buffer.from([0])]))]));
}

export function encodePublish(topic, payload, { retain = false, qos = 0, id = 1 } = {}) {
  const body = [str(topic)];
  if (qos > 0) body.push(u16(id));
  body.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8'));
  return packet(T.PUBLISH, (qos << 1) | (retain ? 1 : 0), Buffer.concat(body));
}

// 버퍼 앞에서 완성된 패킷만 꺼낸다. 남은 바이트는 rest. 길이 필드가 깨지면 error.
export function readPackets(buf, max = MAX_PACKET) {
  const packets = [];
  let i = 0;
  while (buf.length - i >= 2) {
    let len = 0, mul = 1, j = i + 1, done = false;
    for (let k = 0; k < 4 && j < buf.length; k++, j++) {
      len += (buf[j] & 0x7f) * mul; mul *= 128;
      if (!(buf[j] & 0x80)) { done = true; j++; break; }
    }
    if (!done) {
      if (j - i - 1 >= 4) return { packets, rest: Buffer.alloc(0), error: '길이 필드 오류' };
      break;
    }
    if (len > max) return { packets, rest: Buffer.alloc(0), error: `패킷 상한 초과 (${len} B)` };
    if (buf.length < j + len) break;
    packets.push({ type: buf[i] >> 4, flags: buf[i] & 0x0f, body: buf.subarray(j, j + len) });
    i = j + len;
  }
  return { packets, rest: buf.subarray(i) };
}

export function parsePublish(p) {
  const n = p.body.readUInt16BE(0);
  const topic = p.body.subarray(2, 2 + n).toString('utf8');
  const qos = (p.flags >> 1) & 3;
  let k = 2 + n, id = null;
  if (qos > 0) { id = p.body.readUInt16BE(k); k += 2; }
  return { topic, qos, id, retain: !!(p.flags & 1), payload: p.body.subarray(k) };
}

export function parseUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'mqtt:' && u.protocol !== 'tcp:') throw new Error(`지원하지 않는 스킴 ${u.protocol} (mqtt:// 만)`);
  return {
    host: u.hostname || '127.0.0.1', port: Number(u.port) || 1883,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
  };
}

// 응답·화면에는 계정 없이
export function maskUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.username || u.password) { u.username = u.username ? '***' : ''; u.password = u.password ? '***' : ''; }
    return u.toString().replace(/\/$/, '');
  } catch { return '(잘못된 URL)'; }
}

const BACKOFF = [1000, 2000, 5000, 10000];

// emit: 'message' (topic, payload Buffer, {retain}) · 'state' (status)
export class MqttSub extends EventEmitter {
  constructor({ url, topics, clientId = `microsim-b-${process.pid}-${Math.random().toString(16).slice(2, 8)}`, keepalive = 30 }) {
    super();
    this.url = url; this.topics = topics; this.clientId = clientId; this.keepalive = keepalive;
    this.sock = null; this.timer = null; this.ping = null; this.tries = 0; this.stopped = true;
    this.status = { state: 'idle', url: maskUrl(url), topics, error: null, since: null, connects: 0, messages: 0, bytes: 0, lastAt: null };
  }

  set(patch) {
    Object.assign(this.status, patch);
    this.emit('state', this.status);
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    let target;
    try { target = parseUrl(this.url); }
    catch (e) { this.set({ state: 'error', error: e.message }); return; }
    this.set({ state: 'connecting', error: null });
    let buf = Buffer.alloc(0);
    const sock = net.createConnection({ host: target.host, port: target.port });
    this.sock = sock;
    sock.setNoDelay(true);
    sock.on('connect', () => sock.write(encodeConnect({ clientId: this.clientId, username: target.username, password: target.password, keepalive: this.keepalive })));
    sock.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      const { packets, rest, error } = readPackets(buf);
      buf = Buffer.from(rest);
      for (const p of packets) this.onPacket(sock, p);
      if (error) { this.set({ error }); sock.destroy(); }
    });
    sock.on('error', (e) => this.set({ error: e.code ? `${e.code} ${target.host}:${target.port}` : e.message }));
    sock.on('close', () => {
      clearInterval(this.ping); this.ping = null;
      if (this.sock === sock) this.sock = null;
      if (this.stopped) { this.set({ state: 'idle' }); return; }
      this.set({ state: 'retry' });
      const wait = BACKOFF[Math.min(this.tries++, BACKOFF.length - 1)];
      this.timer = setTimeout(() => this.connect(), wait);
    });
  }

  onPacket(sock, p) {
    if (p.type === T.CONNACK) {
      const rc = p.body[1];
      if (rc !== 0) { this.set({ error: `CONNACK 거부 (코드 ${rc})` }); sock.destroy(); return; }
      this.tries = 0;
      this.set({ state: 'connected', since: new Date().toISOString(), connects: this.status.connects + 1, error: null });
      sock.write(encodeSubscribe(1, this.topics));
      clearInterval(this.ping);
      this.ping = setInterval(() => sock.write(packet(T.PINGREQ, 0)), this.keepalive * 500);
    } else if (p.type === T.PUBLISH) {
      const m = parsePublish(p);
      if (m.qos === 1) sock.write(packet(T.PUBACK, 0, u16(m.id)));
      this.status.messages += 1; this.status.bytes += m.payload.length; this.status.lastAt = new Date().toISOString();
      this.emit('message', m.topic, m.payload, { retain: m.retain });
    } else if (p.type === T.SUBACK) {
      const bad = [...p.body.subarray(2)].some((c) => c === 0x80);
      if (bad) this.set({ error: '구독 거부 (SUBACK 0x80)' });
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer); clearInterval(this.ping);
    if (this.sock) {
      try { this.sock.end(packet(T.DISCONNECT, 0)); } catch { /* 이미 닫힘 */ }
      this.sock.destroy();
    }
    this.set({ state: 'idle' });
  }
}
