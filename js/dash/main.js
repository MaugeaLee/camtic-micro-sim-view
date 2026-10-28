// 장 B 구독 대시보드. 3D 없음. 서버 SSE(MQTT 구독 결과)와 FAC GET 대리만 쓴다 — 정적 호스팅에서는 동작하지 않는다.
import { NO_SERVER } from '../core/env.js';
import { apiPath } from '../core/runtime.js';
import { BStore, LEVELS } from '../data/pubsub.js';

const $ = (id) => document.getElementById(id);
const store = new BStore();
// 구역별 dirty: 배치가 와도 바뀐 구역만 다시 그린다(자산 값만 바뀌면 이벤트·명령 표는 그대로).
const ui = { selected: null, level: 'all', dirty: new Set(['assets', 'events', 'commands', 'fac']), demo: false };
const insp = { data: null, pick: null, open: true, error: null };
const mark = (...k) => { for (const x of k) ui.dirty.add(x); };
const ALL = ['assets', 'events', 'commands', 'fac', 'inspect'];
const fac = { run: null, next: 0, events: [], status: null, stock: null, error: null };
const FAC_EVENTS_MAX = 300;
const MQTT_STATE = { connected: ['ok', '연결'], connecting: ['warn', '연결 중'], retry: ['bad', '재시도'], error: ['bad', '오류'], idle: ['', '대기'] };
const FAC_EV_LABEL = {
  master: '기준정보', 'po.create': '구매오더', 'receipt.done': '입고', 'internal.done': '내부 이동', 'production.done': '생산 입고',
  'delivery.done': '출고', 'mr.create': '정비요청', 'mr.update': '정비 갱신', 'mr.stage': '정비 단계',
};

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k);
  return e;
}

const clock = (t) => (typeof t === 'string' && t.length >= 19 ? t.slice(11, 19) : (t ?? '—'));
const simClock = (s) => {
  if (!Number.isFinite(s)) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
};
function fmt(v) {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function setDemo(on) {
  ui.demo = !!on;
  const b = $('demoBadge');
  b.hidden = !ui.demo;
  if (ui.demo) $('note').textContent = '데모 소스: 이 뷰어 시뮬 값을 서버 안 브로커·가짜 FAC 로 내보낸 것(npm run demo). micro-assembly·현장 값이 아니다. 수신 점검이 잡는지 보려고 seq 누락·깨진 JSON 을 일부러 섞는다.';
}

function setBadge(node, cls, label, title = '') {
  node.className = `badge ${cls}`.trim(); node.textContent = label; node.title = title;
}

// ── MQTT(SSE) ──
function onMqtt(s) {
  const [cls, label] = MQTT_STATE[s.state] ?? ['', s.state];
  setBadge($('mqttBadge'), cls, `MQTT ${label}`, `${s.url} · ${s.topics?.join(', ') ?? ''}${s.error ? ` · ${s.error}` : ''}`);
  $('footLine').textContent = `브로커 ${s.url} · 받은 메시지 ${s.messages} · ${Math.round((s.bytes ?? 0) / 1024)} KB${s.lastAt ? ` · 마지막 ${s.lastAt.slice(11, 19)} UTC` : ''}${s.error ? ` · ${s.error}` : ''}`;
}

function connect() {
  const src = new EventSource(apiPath('bStream'));
  src.addEventListener('snapshot', (e) => {
    const d = JSON.parse(e.data);
    store.load(d.store); onMqtt(d.mqtt); setDemo(d.demo); mark(...ALL);
  });
  src.addEventListener('batch', (e) => {
    const d = JSON.parse(e.data);
    for (const item of d.items) {
      store.apply(item, d.at);
      if (item.kind === 'data' || item.kind === 'meta') mark('assets');
      else if (item.kind === 'event') mark('events');
      else if (item.kind === 'command') mark('commands');
    }
    if (d.counts) store.counts = d.counts;   // 배치는 합쳐 오므로 건수는 서버 값을 쓴다
  });
  src.addEventListener('mqtt', (e) => onMqtt(JSON.parse(e.data)));
  src.onerror = () => setBadge($('mqttBadge'), 'bad', 'MQTT 서버 끊김', '이 뷰어 서버와의 SSE가 끊겼다. 자동 재연결');
}

// ── 그리기 (0.5초마다, 바뀐 때만) ──
function renderAssets() {
  const rows = store.rows();
  $('assetCount').textContent = rows.length ? `${rows.length}개` : '';
  const body = $('assetTbl').tBodies[0];
  body.replaceChildren(...rows.map((a) => {
    const tr = el('tr', a.writer === ui.selected ? { class: 'sel' } : {},
      el('td', { text: a.writer }), el('td', { text: a.desc || '', title: a.desc || '' }),
      el('td', { class: 'num', text: String(a.fields.length || Object.keys(a.values).length) }),
      el('td', { class: 'num', text: fmt(a.seq) }), el('td', { text: clock(a.t) }));
    tr.addEventListener('click', () => { ui.selected = a.writer; mark('assets'); render(); });
    return tr;
  }));
  const a = ui.selected && store.assets[ui.selected];
  $('fieldHint').hidden = !!a;
  const fbody = $('fieldTbl').tBodies[0];
  if (!a) { fbody.replaceChildren(); return; }
  const meta = new Map(a.fields.map((f) => [f.name, f]));
  const names = [...new Set([...a.fields.map((f) => f.name), ...Object.keys(a.values)])];
  fbody.replaceChildren(...names.map((n) => {
    const f = meta.get(n), v = a.values[n];
    return el('tr', {}, el('td', { text: f?.label || n, title: f?.path || n }), el('td', { class: 'num', text: fmt(v?.v) }),
      el('td', { text: f?.unit || '' }), el('td', { text: clock(v?.ts) }));
  }));
}

function renderEvents() {
  const list = ui.level === 'all' ? store.events : store.events.filter((e) => e.level === ui.level);
  $('evCount').textContent = store.counts.event ? `${store.counts.event}건` : '';
  $('evList').replaceChildren(...list.slice(0, 150).map((e) => el('li', {},
    el('time', { text: clock(e.t) }), el('span', { class: `lv ${e.level}`, text: e.level }),
    el('span', { text: `${e.source ? `[${e.source}] ` : ''}${e.text}`, title: e.text }))));
}

function renderCommands() {
  $('cmdCount').textContent = store.commands.length ? `${store.commands.length}건` : '';
  $('cmdTbl').tBodies[0].replaceChildren(...store.commands.slice(0, 100).map((c) => el('tr', {},
    el('td', { text: clock(c.t) }), el('td', { text: c.name || c.code, title: `${c.code} ${c.argument ?? ''} — ${c.reason ?? ''}` }),
    el('td', { text: c.targetName || c.target }), el('td', { text: c.state }), el('td', { text: c.issuer }))));
}

function renderFac() {
  const s = fac.status;
  if (fac.error) setBadge($('facBadge'), 'bad', 'FAC 응답 없음', fac.error);
  else if (s && !s.active) setBadge($('facBadge'), 'warn', 'FAC 대기', '업스트림은 떴지만 운전 기록이 없다');
  else if (s) setBadge($('facBadge'), 'ok', 'FAC 연결');
  $('facRun').textContent = s?.active ? `운전 ${s.run} · ${s.mode ?? ''} · 시뮬 ${simClock(s.t)}` : '';
  const st = s?.stats ?? {};
  const cards = [['구매오더', st.po, st.poOpen != null ? `미입고 ${st.poOpen}` : ''], ['입고', st.receipts], ['내부 이동', st.internals], ['생산 입고', st.productions],
    ['출고', st.deliveries], ['정비요청', st.mr, st.mrOpen != null ? `진행 ${st.mrOpen}` : ''], ['설비', st.equipment], ['FAC 이벤트', s?.events]];
  $('facStats').replaceChildren(...cards.map(([k, v, sub]) => el('div', { class: 'stat' }, el('b', { text: fmt(v) }), el('span', { text: sub ? `${k} · ${sub}` : k }))));

  const stock = fac.stock?.data?.stock;
  const tbl = $('stockTbl');
  if (!stock || typeof stock !== 'object') { tbl.tHead.replaceChildren(); tbl.tBodies[0].replaceChildren(); }
  else {
    const locs = Object.keys(stock);
    const prods = [...new Set(locs.flatMap((l) => Object.keys(stock[l] ?? {})))];
    const names = fac.stock.data.products ?? {}, locNames = fac.stock.data.locations ?? {};
    tbl.tHead.replaceChildren(el('tr', {}, el('th', { text: '로케이션' }), ...prods.map((p) => el('th', { text: names[p]?.code ?? p, title: names[p]?.name ?? p }))));
    tbl.tBodies[0].replaceChildren(...locs.map((l) => el('tr', {}, el('td', { text: locNames[l]?.name ?? l, title: l }),
      ...prods.map((p) => el('td', { class: 'num', text: fmt(stock[l]?.[p] ?? 0) })))));
  }

  $('facEvCount').textContent = fac.events.length ? `${fac.events.length}건` : '';
  $('facEvList').replaceChildren(...fac.events.slice(0, 150).map((e) => el('li', {},
    el('time', { text: simClock(e.t) }), el('span', { class: 'lv', text: FAC_EV_LABEL[e.type] ?? e.type }),
    el('span', { text: facText(e), title: JSON.stringify(e) }))));
}

function facText(e) {
  const lines = Array.isArray(e.lines) ? e.lines.map((l) => `${l.product} ${l.qty ?? ''}`).join(' · ') : '';
  return [e.key, e.name, e.stage, lines, e.equipment].filter(Boolean).join(' — ') || (e.type === 'master' ? '제품·로케이션·설비 등록' : '');
}

// ── 수신 점검 ──
const ago = (s) => (s == null ? '—' : s < 1 ? '방금' : s < 90 ? `${s.toFixed(0)} s 전` : `${(s / 60).toFixed(0)} 분 전`);
const kb = (b) => (b < 1024 ? `${b} B` : b < 1 << 20 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);

async function pollInspect() {
  if (!insp.open || document.hidden) return;
  try {
    const r = await fetch(apiPath('bInspect'), { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    insp.data = await r.json(); insp.error = null;
    setDemo(insp.data.demo);
    if (insp.data.mqtt) onMqtt(insp.data.mqtt);
  } catch (e) { insp.error = e.message; }
  mark('inspect');
}

// 화면 반영 대조: 원문에서 푼 값이 지금 자산 표 값과 같은지. 그 뒤 새 값이 왔으면 '갱신됨'.
function compareRow(item) {
  if (item.kind !== 'data') return null;
  const a = store.assets[item.writer];
  if (!a) return { ok: false, text: '자산 표에 없음' };
  const keys = Object.keys(item.values);
  const same = keys.filter((k) => JSON.stringify(a.values[k]?.v) === JSON.stringify(item.values[k].v)).length;
  if (same === keys.length) return { ok: true, text: `자산 표와 같음 (${same}/${keys.length})` };
  return { ok: (a.seq ?? 0) > (item.seq ?? 0), text: (a.seq ?? 0) > (item.seq ?? 0) ? `그 뒤 갱신됨 (seq ${item.seq} → ${a.seq})` : `값 다름 ${same}/${keys.length}` };
}

function renderInspect() {
  const d = insp.data;
  const s = store.counts;
  const total = (d?.counts ? Object.entries(d.counts).filter(([k]) => k !== 'dropped').reduce((n, [, v]) => n + v, 0) : 0);
  const shown = Object.entries(s).filter(([k]) => k !== 'dropped').reduce((n, [, v]) => n + v, 0);
  const gaps = d ? d.topics.reduce((n, t) => n + t.gaps, 0) : 0, errs = d ? d.topics.reduce((n, t) => n + t.errors, 0) : 0;
  $('inspSum').textContent = insp.error ? `조회 실패 ${insp.error}` : d
    ? `메시지 ${d.n} · 토픽 ${d.topics.length}${d.overflow ? ` (+${d.overflow} 상한 밖)` : ''} · 풀린 항목 서버 ${total} / 화면 ${shown}${total === shown ? ' 일치' : ' (다음 배치에서 맞춰짐)'} · seq 누락 ${gaps} · 해석 오류 ${errs}${s.dropped ? ` · 자산 상한 버림 ${s.dropped}` : ''}`
    : '불러오는 중…';
  $('inspSum').className = `muted ${gaps || errs ? 'warnline' : ''}`;
  $('topicTbl').tBodies[0].replaceChildren(...(d?.topics ?? []).map((t) => el('tr', { class: t.errors ? 'bad' : t.gaps ? 'warn' : '' },
    el('td', { text: t.topic.replace(/^opcua\/json\//, '…/'), title: t.topic }),
    el('td', { class: 'num', text: String(t.count) }), el('td', { class: 'num', text: t.rate ? t.rate.toFixed(1) : '—' }),
    el('td', { class: 'num', text: kb(t.bytes) }), el('td', { class: 'num', text: String(t.gaps) }), el('td', { class: 'num', text: String(t.errors) }),
    el('td', { text: ago(t.age) }))));
  const ring = d?.ring ?? [];
  $('rawList').replaceChildren(...ring.map((m) => {
    const bad = m.items.some((x) => x.kind === 'error');
    const li = el('li', { class: `${m.i === insp.pick ? 'on' : ''} ${bad ? 'bad' : m.gap ? 'warn' : ''}` },
      el('time', { text: clock(m.at) }), el('span', { class: 'lv', text: bad ? '오류' : m.gap ? `누락 ${m.gap}` : m.items[0]?.kind ?? '' }),
      el('span', { text: m.topic.split('/').slice(-1)[0], title: m.topic }), el('em', { text: kb(m.bytes) }));
    li.addEventListener('click', () => { insp.pick = m.i; mark('inspect'); render(); });
    return li;
  }));
  const m = ring.find((x) => x.i === insp.pick) ?? null;
  $('rawHint').hidden = !!m;
  $('rawPane').hidden = !m;
  if (!m) return;
  let pretty = m.raw;
  try { pretty = JSON.stringify(JSON.parse(m.raw), null, 1); } catch { /* 원문 그대로 */ }
  $('rawText').textContent = `${m.topic}\n${m.bytes} B${m.cut ? ' (4 KB에서 자름)' : ''}\n\n${pretty}`;
  $('decText').textContent = JSON.stringify(m.items, null, 1);
  $('cmpList').replaceChildren(...m.items.map((it) => {
    const c = compareRow(it);
    const label = it.kind === 'data' ? `${it.writer} seq ${it.seq}` : it.kind === 'error' ? `해석 오류: ${it.error}` : `${it.kind}${it.writer ? ` ${it.writer}` : ''}`;
    return el('li', { class: c ? (c.ok ? 'ok' : 'warn') : it.kind === 'error' ? 'bad' : '' }, el('b', { text: label }), el('span', { text: c ? c.text : it.kind === 'event' ? '이벤트 목록에 들어감' : it.kind === 'command' ? '명령 표에 들어감' : it.kind === 'meta' ? '자산 표 필드 이름·단위' : '' }));
  }));
}

function render() {
  if (!ui.dirty.size) return;
  const d = ui.dirty; ui.dirty = new Set();
  if (d.has('assets')) renderAssets();
  if (d.has('events')) renderEvents();
  if (d.has('commands')) renderCommands();
  if (d.has('fac')) renderFac();
  if (d.has('inspect') || d.has('assets')) renderInspect();
}

function buildFilter() {
  const box = $('evFilter');
  for (const lv of ['all', ...LEVELS]) {
    const b = el('button', { type: 'button', text: lv === 'all' ? '전체' : lv });
    if (lv === ui.level) b.classList.add('on');
    b.addEventListener('click', () => {
      ui.level = lv; mark('events');
      for (const x of box.children) x.classList.toggle('on', x === b);
      render();
    });
    box.append(b);
  }
}

// ── FAC (서버 대리 GET) ──
async function facGet(view, q = '') {
  const r = await fetch(`${apiPath('bFac')}/${view}${q}`, { cache: 'no-store' });
  const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  return { ok: r.ok, code: r.status, body };
}

async function pollFac() {
  try {
    const s = await facGet('status');
    if (!s.ok) throw new Error(s.body.detail ? `${s.body.error} (${s.body.detail})` : s.body.error);
    fac.error = null; fac.status = s.body;
    if (s.body.run !== fac.run) { fac.run = s.body.run; fac.next = 0; fac.events = []; fac.stock = null; }
    if (s.body.active) {
      const ev = await facGet('events', `?since=${fac.next}&limit=500`);
      if (ev.ok && ev.body.run === fac.run) {
        for (const e of ev.body.events ?? []) fac.events.unshift(e);
        if (fac.events.length > FAC_EVENTS_MAX) fac.events.length = FAC_EVENTS_MAX;
        fac.next = ev.body.next ?? fac.next;
      }
      const st = await facGet('stock');
      fac.stock = st.ok ? st.body : null;
    }
  } catch (e) {
    fac.error = e.message;
  }
  mark('fac');
}

function boot() {
  if (NO_SERVER || !apiPath('bStream')) {
    const n = $('note');
    n.textContent = '이 화면은 뷰어 서버(npm start)가 필요하다. 정적 호스팅(Pages)·file:// 에서는 MQTT·FAC를 구독할 수 없다.';
    n.classList.add('bad');
    $('footLine').textContent = '서버 없음';
    return;
  }
  buildFilter();
  connect();
  pollFac();
  pollInspect();
  $('inspCard').addEventListener('toggle', (e) => { insp.open = e.target.open; if (insp.open) pollInspect(); });
  setInterval(pollFac, 2000);
  setInterval(pollInspect, 1000);
  setInterval(render, 500);
}

boot();
