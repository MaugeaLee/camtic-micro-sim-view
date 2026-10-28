// 장 B 구독: micro-assembly가 내는 OPC UA PubSub JSON(MQTT)을 풀어 표용 상태로 모은다. DOM 없음 — 서버와 대시보드가 같이 쓴다.
// 토픽: opcua/json/{data|metadata}/<PublisherId>/<WriterGroup>/<DataSetWriter>, aas/<PublisherId>/environment
// 값은 시뮬 값이다. 현장 실측이 아니다.
// 누적 상한: 오래 켜 둬도 메모리·스냅샷 크기가 자산 수 × 필드 수 + 상한 개수에서 멈춘다(README 「데이터 누적 오버헤드」).
export const LIMITS = Object.freeze({ events: 300, commands: 200, fields: 200, assets: 500, topics: 300, ring: 50, raw: 4096 });

const TOPIC = /^opcua\/json\/(data|metadata)\/([^/]+)\/([^/]+)\/(.+)$/;
const AAS_ENV = /^aas\/([^/]+)\/environment$/;

const val = (f) => (f && typeof f === 'object' && 'Value' in f ? f.Value : f);
const fieldTs = (f) => (f && typeof f === 'object' ? f.SourceTimestamp ?? null : null);
const text = (v) => (v && typeof v === 'object' ? v.Text ?? '' : v ?? '');

function prop(props, name) {
  const p = (props ?? []).find((x) => x?.Key?.Name === name);
  return p ? p.Value : null;
}

// 메시지 한 건 → 항목 배열. 항목 kind: meta | data | event | command | env | other
export function decode(topic, payload) {
  let doc;
  try { doc = typeof payload === 'string' ? JSON.parse(payload) : JSON.parse(new TextDecoder().decode(payload)); }
  catch { return [{ kind: 'error', topic, error: 'JSON 아님' }]; }

  const env = AAS_ENV.exec(topic);
  if (env) {
    return [{
      kind: 'env', publisher: env[1],
      shells: Array.isArray(doc?.assetAdministrationShells) ? doc.assetAdministrationShells.length : 0,
      submodels: Array.isArray(doc?.submodels) ? doc.submodels.length : 0,
    }];
  }

  const m = TOPIC.exec(topic);
  if (!m || !doc || typeof doc !== 'object') return [{ kind: 'other', topic }];
  const [, cls, publisher, group, writer] = m;

  if (cls === 'metadata') {
    const md = doc.MetaData ?? {};
    return [{
      kind: 'meta', publisher, group, writer: md.Name ?? writer,
      desc: text(md.Description), fields: (md.Fields ?? []).slice(0, LIMITS.fields).map((f) => ({
        name: f.Name, label: text(f.Description), type: f.BuiltInType ?? null,
        unit: prop(f.Properties, 'EngineeringUnits'), path: prop(f.Properties, 'AAS.IdShortPath'),
      })),
    }];
  }

  const out = [];
  for (const msg of Array.isArray(doc.Messages) ? doc.Messages : []) {
    const p = msg?.Payload ?? {};
    const name = msg?.DataSetWriterName ?? writer;
    if (msg?.MessageType === 'ua-event' || doc.MessageType === 'ua-event') {
      out.push({
        kind: 'event', publisher, seq: msg.SequenceNumber ?? null, t: val(p.Time) ?? msg.Timestamp ?? null,
        level: String(val(p.EventType) ?? '').split('.').pop() || 'info', severity: Number(val(p.Severity)) || 0,
        source: val(p.SourceName) ?? '', text: text(val(p.Message)),
      });
    } else if (name === 'Commands') {
      const c = Object.fromEntries(Object.entries(p).map(([k, f]) => [k, val(f)]));
      out.push({
        kind: 'command', publisher, seq: msg.SequenceNumber ?? null, t: msg.Timestamp ?? null,
        id: c.CommandId ?? null, code: c.Code ?? '', name: c.Name ?? '', group: c.Group ?? '', target: c.Target ?? '',
        targetName: c.TargetName ?? '', argument: c.Argument ?? '', issuer: c.Issuer ?? '', reason: c.Reason ?? '',
        state: c.State ?? '', note: c.Note ?? '',
      });
    } else {
      const values = {};
      for (const [k, f] of Object.entries(p).slice(0, LIMITS.fields)) values[k] = { v: val(f), ts: fieldTs(f) };
      out.push({ kind: 'data', publisher, group, writer: name, seq: msg?.SequenceNumber ?? null, t: msg?.Timestamp ?? null, values });
    }
  }
  return out.length ? out : [{ kind: 'other', topic }];
}

// 받은 항목을 누적한 화면 상태. 직렬화 가능(서버 → SSE 스냅샷 → 브라우저 load).
export class BStore {
  constructor() { this.reset(); }

  reset() {
    this.assets = {};      // writer → { writer, desc, fields: [{name,label,unit,type}], values, seq, t, count }
    this.events = [];      // 최신이 앞
    this.commands = [];    // CommandId별 최신 상태, 최신이 앞
    this.env = null;
    this.counts = { meta: 0, data: 0, event: 0, command: 0, env: 0, other: 0, error: 0, dropped: 0 };
    this.nAssets = 0;
    this.lastAt = null;
  }

  // 상한을 넘는 새 자산은 받지 않고 dropped 로 센다
  asset(writer) {
    if (this.assets[writer]) return this.assets[writer];
    if (this.nAssets >= LIMITS.assets) return null;
    this.nAssets++;
    return (this.assets[writer] = { writer, desc: '', fields: [], values: {}, seq: null, t: null, count: 0 });
  }

  apply(item, at = null) {
    this.counts[item.kind] = (this.counts[item.kind] ?? 0) + 1;
    if (at) this.lastAt = at;
    switch (item.kind) {
      case 'meta': {
        const a = this.asset(item.writer);
        if (!a) { this.counts.dropped++; break; }
        a.desc = item.desc; a.fields = item.fields;
        break;
      }
      case 'data': {
        const a = this.asset(item.writer);
        if (!a) { this.counts.dropped++; break; }
        for (const [k, v] of Object.entries(item.values)) {
          if (k in a.values || Object.keys(a.values).length < LIMITS.fields) a.values[k] = v;
        }
        a.seq = item.seq; a.t = item.t; a.count += item.n ?? 1;
        break;
      }
      case 'event':
        this.events.unshift(item);
        if (this.events.length > LIMITS.events) this.events.length = LIMITS.events;
        break;
      case 'command': {
        const i = item.id == null ? -1 : this.commands.findIndex((c) => c.id === item.id);
        if (i >= 0) this.commands.splice(i, 1);
        this.commands.unshift(item);
        if (this.commands.length > LIMITS.commands) this.commands.length = LIMITS.commands;
        break;
      }
      case 'env':
        this.env = { shells: item.shells, submodels: item.submodels };
        break;
      default:
    }
  }

  // 자산 표 행: 메타데이터만 온 자산(값 없음)도 보인다
  rows() {
    return Object.values(this.assets).sort((a, b) => a.writer.localeCompare(b.writer));
  }

  snapshot() {
    return { assets: this.assets, events: this.events, commands: this.commands, env: this.env, counts: this.counts, lastAt: this.lastAt };
  }

  load(s) {
    this.reset();
    if (!s) return;
    this.assets = s.assets ?? {}; this.nAssets = Object.keys(this.assets).length; this.events = s.events ?? []; this.commands = s.commands ?? [];
    this.env = s.env ?? null; this.counts = { ...this.counts, ...(s.counts ?? {}) }; this.lastAt = s.lastAt ?? null;
  }
}

// 배치 합치기: 같은 자산 data 는 한 건으로(값은 최신으로 덮고 n 에 건수). 이벤트·명령·메타는 그대로 순서 유지.
// 쏟아지는 값(고빈도 텔레메트리)도 배치 크기는 자산 수 + 이벤트 수에서 멈춘다.
export function coalesce(items) {
  const out = [];
  const at = new Map();
  for (const it of items) {
    if (it.kind !== 'data') { out.push(it); continue; }
    const i = at.get(it.writer);
    if (i == null) { at.set(it.writer, out.length); out.push({ ...it, values: { ...it.values }, n: it.n ?? 1 }); continue; }
    const m = out[i];
    Object.assign(m.values, it.values);
    m.seq = it.seq; m.t = it.t; m.n += it.n ?? 1;
  }
  return out;
}

// 수신 점검: 토픽별 건수·속도·크기·seq 누락·해석 오류와 최근 원문 링. 서버에서만 쌓고, 화면은 필요할 때만 가져간다.
// seq 누락은 (publisher, writer) 별 SequenceNumber 가 1보다 크게 뛴 만큼. 작아지면 재시작으로 센다.
const ENC = new TextEncoder();
const DEC = new TextDecoder();

export class TopicStats {
  constructor() { this.reset(); }

  reset() {
    this.topics = new Map();
    this.seqs = new Map();
    this.ring = [];
    this.n = 0;
    this.overflow = 0;
    this.since = null;
  }

  add(topic, payload, items, now = Date.now()) {
    const bytes = typeof payload === 'string' ? ENC.encode(payload).length : payload.length;
    this.since ??= now;
    let s = this.topics.get(topic);
    if (!s) {
      if (this.topics.size >= LIMITS.topics) { this.overflow++; s = null; }
      else this.topics.set(topic, (s = { topic, count: 0, bytes: 0, rate: 0, last: null, gaps: 0, restarts: 0, errors: 0, kinds: {} }));
    }
    let gap = 0;
    for (const it of items) {
      if (it.kind === 'error') { if (s) s.errors++; continue; }
      if (it.seq == null || (it.kind !== 'data' && it.kind !== 'event' && it.kind !== 'command')) continue;
      const key = `${it.publisher}/${it.writer ?? it.kind}`;
      const prev = this.seqs.get(key);
      if (prev != null) {
        if (it.seq > prev + 1) gap += it.seq - prev - 1;
        else if (it.seq <= prev && s) s.restarts++;
      }
      if (prev != null || this.seqs.size < LIMITS.topics * 4) this.seqs.set(key, it.seq);
    }
    if (s) {
      if (s.last != null) {
        const dt = Math.max(1e-3, (now - s.last) / 1000);
        s.rate = s.rate ? s.rate * 0.8 + (1 / dt) * 0.2 : 1 / dt;
      }
      s.count++; s.bytes += bytes; s.last = now; s.gaps += gap;
      for (const it of items) s.kinds[it.kind] = (s.kinds[it.kind] ?? 0) + 1;
    }
    this.n++;
    const text = typeof payload === 'string' ? payload : DEC.decode(payload.subarray(0, LIMITS.raw));
    this.ring.unshift({
      i: this.n, at: new Date(now).toISOString(), topic, bytes, gap,
      raw: text.length > LIMITS.raw ? text.slice(0, LIMITS.raw) : text, cut: bytes > LIMITS.raw,
      items: items.slice(0, 8),
    });
    if (this.ring.length > LIMITS.ring) this.ring.length = LIMITS.ring;
  }

  view(now = Date.now()) {
    const topics = [...this.topics.values()].map((s) => ({ ...s, age: s.last == null ? null : (now - s.last) / 1000, kinds: { ...s.kinds } }))
      .sort((a, b) => a.topic.localeCompare(b.topic));
    return { n: this.n, overflow: this.overflow, since: this.since == null ? null : new Date(this.since).toISOString(), topics, ring: this.ring };
  }
}

// 이벤트 등급 → 정렬 우선(원 레포 Severity: alert 800 · warn 600 · plan 400 · act 300 · ok 200 · info 100)
export const LEVELS = Object.freeze(['alert', 'warn', 'plan', 'act', 'ok', 'info']);
