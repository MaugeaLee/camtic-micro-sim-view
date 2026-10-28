// ZeroMQ ZMTP 3.0 최소 구현(node:net, 의존성 없음). PUB(bind)과 테스트용 SUB(connect)만. 메커니즘 NULL — 암호·인증 없음.
// 구독: ZMTP 3.0 메시지 형식([0x01|0x00, 접두사...])과 3.1 SUBSCRIBE/CANCEL 명령 둘 다 받는다. 접두사 일치만(ZeroMQ와 같음).
import net from 'node:net';
import { EventEmitter } from 'node:events';

const MAX_FRAME = 16 * 1024 * 1024;
const MORE = 0x01, LONG = 0x02, COMMAND = 0x04;

export function greeting(asServer = false) {
  const g = Buffer.alloc(64);
  g[0] = 0xff; g[9] = 0x7f;
  g[10] = 3; g[11] = 0;
  g.write('NULL', 12, 'ascii');
  g[32] = asServer ? 1 : 0;
  return g;
}

export function frame(body, { more = false, command = false } = {}) {
  const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  const flags = (more ? MORE : 0) | (command ? COMMAND : 0) | (b.length > 255 ? LONG : 0);
  if (b.length > 255) {
    const h = Buffer.alloc(9); h[0] = flags; h.writeBigUInt64BE(BigInt(b.length), 1);
    return Buffer.concat([h, b]);
  }
  return Buffer.concat([Buffer.from([flags, b.length]), b]);
}

export function command(name, body = Buffer.alloc(0)) {
  return frame(Buffer.concat([Buffer.from([name.length]), Buffer.from(name, 'ascii'), body]), { command: true });
}

export function ready(props) {
  const parts = [];
  for (const [k, v] of Object.entries(props)) {
    const val = Buffer.from(v, 'utf8'), len = Buffer.alloc(4);
    len.writeUInt32BE(val.length);
    parts.push(Buffer.from([k.length]), Buffer.from(k, 'ascii'), len, val);
  }
  return command('READY', Buffer.concat(parts));
}

export function multipart(parts) {
  return Buffer.concat(parts.map((p, i) => frame(p, { more: i < parts.length - 1 })));
}

// 버퍼 앞에서 완성된 프레임만 꺼낸다.
export function readFrames(buf, max = MAX_FRAME) {
  const frames = [];
  let i = 0;
  while (buf.length - i >= 2) {
    const flags = buf[i];
    let size, head;
    if (flags & LONG) {
      if (buf.length - i < 9) break;
      const n = buf.readBigUInt64BE(i + 1);
      if (n > BigInt(max)) return { frames, rest: Buffer.alloc(0), error: `프레임 상한 초과 (${n} B)` };
      size = Number(n); head = 9;
    } else { size = buf[i + 1]; head = 2; }
    if (buf.length - i < head + size) break;
    frames.push({ more: !!(flags & MORE), command: !!(flags & COMMAND), body: buf.subarray(i + head, i + head + size) });
    i += head + size;
  }
  return { frames, rest: buf.subarray(i) };
}

export function parseCommand(body) {
  const n = body[0];
  return { name: body.subarray(1, 1 + n).toString('ascii'), data: body.subarray(1 + n) };
}

export function parseReady(data) {
  const props = {};
  for (let k = 0; k < data.length;) {
    const n = data[k]; const name = data.subarray(k + 1, k + 1 + n).toString('ascii'); k += 1 + n;
    const len = data.readUInt32BE(k); k += 4;
    props[name] = data.subarray(k, k + len).toString('utf8'); k += len;
  }
  return props;
}

// 한 연결: 인사 64 B → READY 교환 → 프레임. onMessage(parts) · onCommand(cmd)
class Peer {
  constructor(sock, { asServer, socketType, onReady, onMessage, onCommand, onClose }) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.stage = 'greeting'; this.parts = [];
    this.socketType = socketType; this.remote = null;
    Object.assign(this, { onReady, onMessage, onCommand, onClose });
    sock.setNoDelay(true);
    sock.write(greeting(asServer));
    sock.on('data', (c) => this.feed(c));
    sock.on('error', () => {});
    sock.on('close', () => this.onClose?.(this));
  }

  feed(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    if (this.stage === 'greeting') {
      if (this.buf.length < 64) return;
      const g = this.buf.subarray(0, 64);
      const mech = g.subarray(12, 32).toString('ascii').replace(/\0+$/, '');
      if (g[0] !== 0xff || g[9] !== 0x7f || g[10] < 3 || mech !== 'NULL') { this.sock.destroy(); return; }
      this.version = `${g[10]}.${g[11]}`;
      this.buf = this.buf.subarray(64);
      this.stage = 'handshake';
      this.sock.write(ready({ 'Socket-Type': this.socketType }));
    }
    const { frames, rest, error } = readFrames(this.buf);
    if (error) { this.sock.destroy(); return; }
    this.buf = rest;
    for (const f of frames) {
      if (f.command) {
        const c = parseCommand(f.body);
        if (c.name === 'READY' && this.stage === 'handshake') {
          this.remote = parseReady(c.data);
          this.stage = 'ready';
          this.onReady?.(this);
        } else if (c.name === 'ERROR') this.sock.destroy();
        else this.onCommand?.(this, c);
        continue;
      }
      if (this.stage !== 'ready') { this.sock.destroy(); return; }
      this.parts.push(f.body);
      if (!f.more) { const p = this.parts; this.parts = []; this.onMessage?.(this, p); }
    }
  }

  send(buf) { this.sock.write(buf); }
}

const PEER_TYPES = { PUB: ['SUB', 'XSUB'], SUB: ['PUB', 'XPUB'] };

export function parseEndpoint(ep) {
  const m = /^tcp:\/\/([^:/]+|\[[^\]]+\]):(\d+)$/.exec(String(ep));
  if (!m) throw new Error(`ZeroMQ 엔드포인트는 tcp://host:port 만: ${ep}`);
  return { host: m[1] === '*' ? '0.0.0.0' : m[1].replace(/^\[|\]$/g, ''), port: Number(m[2]) };
}

// PUB: bind 해서 SUB 들을 받는다. 구독 접두사가 맞는 피어에만 보낸다. 느린 피어(버퍼 > hwmBytes)는 그 메시지를 버리고 센다.
export class PubSocket extends EventEmitter {
  constructor({ hwmBytes = 8 * 1024 * 1024 } = {}) {
    super();
    this.hwmBytes = hwmBytes;
    this.peers = new Set();
    this.sent = 0; this.dropped = 0;
    this.server = net.createServer((sock) => this.accept(sock));
  }

  bind(endpoint) {
    const { host, port } = parseEndpoint(endpoint);
    return new Promise((ok, bad) => {
      this.server.once('error', bad);
      this.server.listen(port, host, () => { this.server.off('error', bad); ok(this.server.address()); });
    });
  }

  accept(sock) {
    const peer = new Peer(sock, {
      asServer: true, socketType: 'PUB',
      onReady: (p) => {
        if (!PEER_TYPES.PUB.includes(p.remote['Socket-Type'])) { p.sock.destroy(); return; }
        p.subs = []; this.peers.add(p); this.emit('peer', this.peers.size);
      },
      onMessage: (p, parts) => {
        const b = parts[0];
        if (!b?.length) return;
        if (b[0] === 1) this.subscribe(p, b.subarray(1));
        else if (b[0] === 0) this.unsubscribe(p, b.subarray(1));
      },
      onCommand: (p, c) => {
        if (c.name === 'SUBSCRIBE') this.subscribe(p, c.data);
        else if (c.name === 'CANCEL') this.unsubscribe(p, c.data);
      },
      onClose: (p) => { if (this.peers.delete(p)) this.emit('peer', this.peers.size); },
    });
    return peer;
  }

  subscribe(p, prefix) { p.subs.push(Buffer.from(prefix)); this.emit('subscribe', prefix.toString('utf8')); }
  unsubscribe(p, prefix) { const i = p.subs.findIndex((s) => s.equals(prefix)); if (i >= 0) p.subs.splice(i, 1); }

  // parts[0] 이 토픽 프레임(접두사 비교 대상)
  send(parts) {
    const head = Buffer.isBuffer(parts[0]) ? parts[0] : Buffer.from(String(parts[0]), 'utf8');
    let wire = null, n = 0;
    for (const p of this.peers) {
      if (!p.subs.some((s) => head.length >= s.length && head.subarray(0, s.length).equals(s))) continue;
      if (p.sock.writableLength > this.hwmBytes) { this.dropped++; continue; }
      p.send(wire ??= multipart([head, ...parts.slice(1)]));
      n++;
    }
    if (n) this.sent++;
    return n;
  }

  get subscribers() { return [...this.peers].filter((p) => p.subs.length).length; }

  close() {
    for (const p of this.peers) p.sock.destroy();
    this.peers.clear();
    return new Promise((ok) => this.server.close(() => ok()));
  }
}

// 테스트·점검용 SUB(connect). ZMTP 3.0 메시지 형식으로 구독한다.
export class SubSocket extends EventEmitter {
  constructor() { super(); this.peer = null; this.pending = []; }

  connect(endpoint, prefixes = ['']) {
    const { host, port } = parseEndpoint(endpoint);
    return new Promise((ok, bad) => {
      const sock = net.connect(port, host);
      sock.once('error', bad);
      this.peer = new Peer(sock, {
        asServer: false, socketType: 'SUB',
        onReady: (p) => {
          for (const s of prefixes) p.send(frame(Buffer.concat([Buffer.from([1]), Buffer.from(s, 'utf8')])));
          ok(this);
        },
        onMessage: (p, parts) => this.emit('message', parts),
      });
    });
  }

  close() { this.peer?.sock.destroy(); }
}
