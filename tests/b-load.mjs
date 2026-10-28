// 장 B 누적 오버헤드·수신 점검·데모 소스: 배치 합치기, 상한, 느린 SSE 건너뛰기, seq 누락·해석 오류 잡기, 데모 끝까지.
import { BStore, LIMITS, TopicStats, coalesce, decode } from '../js/data/pubsub.js';
import { ChapterB } from '../server/chapter-b.mjs';
import { startBDemo, topicMatch } from '../server/b-demo.mjs';
import { startServer } from '../server/app-server.mjs';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(50); }
  return false;
}

console.log('b-load');

const D = 'opcua/json/data/p/G/';
const dataMsg = (w, seq, vals) => JSON.stringify({ MessageType: 'ua-data', PublisherId: 'p', Messages: [{ DataSetWriterName: w, SequenceNumber: seq, Timestamp: 't',
  Payload: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, { Value: v, SourceTimestamp: 't' }])) }] });
const evMsg = (seq) => JSON.stringify({ MessageType: 'ua-data', PublisherId: 'p', Messages: [{ DataSetWriterName: 'Events', SequenceNumber: seq, MessageType: 'ua-event',
  Payload: { EventType: { Value: 'x.warn' }, Message: { Value: { Text: `e${seq}` } } } }] });

// ── 합치기 ──
{
  const items = [];
  for (let i = 1; i <= 1000; i++) items.push(...decode(`${D}W${i % 3}`, dataMsg(`W${i % 3}`, i, { A: i, [`K${i % 5}`]: i })));
  items.splice(500, 0, ...decode(`${D}Events`, evMsg(1)), ...decode(`${D}Events`, evMsg(2)));
  const c = coalesce(items);
  check('배치 합치기: 1002 → 자산 3 + 이벤트 2', c.length === 5 && c.filter((x) => x.kind === 'event').length === 2, `${c.length}`);
  const raw = new BStore(), merged = new BStore();
  for (const it of items) raw.apply(it);
  for (const it of c) merged.apply(it);
  const same = ['W0', 'W1', 'W2'].every((w) => JSON.stringify(raw.assets[w].values) === JSON.stringify(merged.assets[w].values)
    && raw.assets[w].count === merged.assets[w].count && raw.assets[w].seq === merged.assets[w].seq);
  check('합친 배치를 적용해도 자산 값·건수·seq 같음', same);
  check('이벤트 순서 유지', merged.events.map((e) => e.text).join() === raw.events.map((e) => e.text).join());
}

// ── 상한 ──
{
  const st = new BStore();
  for (let i = 0; i < LIMITS.assets + 100; i++) st.apply({ kind: 'data', writer: `W${i}`, values: { a: { v: i } }, seq: 1 });
  check('자산 상한 · 넘친 건 dropped', st.nAssets === LIMITS.assets && st.counts.dropped === 100, `${st.nAssets} / ${st.counts.dropped}`);
  const one = new BStore();
  for (let i = 0; i < LIMITS.fields * 3; i++) one.apply({ kind: 'data', writer: 'X', values: { [`f${i}`]: { v: i } }, seq: i });
  check('필드 합집합 상한', Object.keys(one.assets.X.values).length === LIMITS.fields);
}

// ── 수신 점검 통계 ──
{
  const ts = new TopicStats();
  let now = 1_000_000;
  for (const seq of [1, 2, 3, 6, 7, 2]) { const p = dataMsg('A', seq, { v: seq }); ts.add(`${D}A`, p, decode(`${D}A`, p), (now += 100)); }
  ts.add(`${D}N`, 'nope', decode(`${D}N`, 'nope'), (now += 100));
  const v = ts.view(now);
  const A = v.topics.find((t) => t.topic === `${D}A`), N = v.topics.find((t) => t.topic === `${D}N`);
  check('seq 누락 = 3→6 사이 2건 · 되감기 1건(재시작)', A.gaps === 2 && A.restarts === 1, JSON.stringify({ gaps: A.gaps, restarts: A.restarts }));
  check('JSON 아님 = 해석 오류', N.errors === 1 && v.ring[0].items[0].kind === 'error');
  check('속도(EWMA) ≈ 10/s', Math.abs(A.rate - 10) < 0.5, A.rate.toFixed(2));
  for (let i = 0; i < LIMITS.topics + 50; i++) ts.add(`t/${i}`, '{}', [{ kind: 'other' }], now);
  const big = 'x'.repeat(LIMITS.raw * 3);
  ts.add(`${D}big`, Buffer.from(big), [{ kind: 'error' }], now);
  check('토픽 상한 · 링 50 · 원문 4 KB 자름', ts.topics.size === LIMITS.topics && ts.overflow > 0 && ts.ring.length === LIMITS.ring
    && ts.ring[0].raw.length === LIMITS.raw && ts.ring[0].cut, `${ts.topics.size} +${ts.overflow} · ring ${ts.ring.length}`);
}

// ── 부하: 20만 메시지 · 자산 50 × 필드 20 ──
{
  const B = new ChapterB({ mqttUrl: 'mqtt://127.0.0.1:1', topics: ['#'], facUrl: 'http://127.0.0.1:1' });
  const fields = Object.fromEntries(Array.from({ length: 20 }, (_, k) => [`F${k}`, k * 1.5]));
  const payloads = Array.from({ length: 50 }, (_, w) => dataMsg(`W${w}`, 1, fields));
  globalThis.gc?.();
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  let maxPending = 0, flushes = 0, batchItems = 0;
  const N = 200_000;
  for (let i = 0; i < N; i++) {
    const w = i % 50;
    B.onMessage(i % 100 === 99 ? `${D}Events` : `${D}W${w}`, i % 100 === 99 ? evMsg(i) : payloads[w]);
    maxPending = Math.max(maxPending, B.pending.length);
    if (i % 5000 === 4999) {
      batchItems = Math.max(batchItems, coalesce(B.pending).length);
      clearTimeout(B.flushTimer); B.flush(); flushes++;
    }
  }
  const ms = performance.now() - t0;
  globalThis.gc?.();
  const heap1 = process.memoryUsage().heapUsed;
  const snap = JSON.stringify(B.store.snapshot()).length;
  const insp = JSON.stringify(B.inspect()).length;
  B.close();
  console.log(`    20만 건 ${ms.toFixed(0)} ms (${(ms / N * 1000).toFixed(1)} µs/건) · 플러시 ${flushes} · 배치 최대 ${batchItems}항목 · 대기 최대 ${maxPending} · 스냅샷 ${(snap / 1024).toFixed(0)} KB · 점검 ${(insp / 1024).toFixed(0)} KB · 힙 +${((heap1 - heap0) / 1048576).toFixed(1)} MB${globalThis.gc ? '' : ' (gc 없음: 참고값)'}`);
  check('플러시 전 대기는 합치기 상한 근처에서 멈춤', maxPending <= 2001 + 50 + 50, String(maxPending));
  check('5000건 배치 → 자산 50 + 이벤트 50 이하', batchItems <= 100, String(batchItems));
  check('저장소 크기 일정: 자산 50 · 이벤트 300', B.store.nAssets === 50 && B.store.events.length === LIMITS.events);
  check('스냅샷 < 512 KB · 점검 응답 < 512 KB', snap < 512 * 1024 && insp < 512 * 1024, `${(snap / 1024).toFixed(0)} / ${(insp / 1024).toFixed(0)} KB`);
  check('건당 처리 < 100 µs', ms / N * 1000 < 100, `${(ms / N * 1000).toFixed(1)} µs`);
}

// ── 느린 SSE 클라이언트: 건너뛰고 따라잡으면 스냅샷 ──
{
  const B = new ChapterB({ mqttUrl: 'mqtt://127.0.0.1:1', topics: ['#'], facUrl: 'http://127.0.0.1:1' });
  const fake = (lag) => ({ writableLength: lag, got: [], write(l) { this.got.push(l.slice(0, l.indexOf('\n'))); return true; } });
  const fast = fake(0), slow = fake(2 << 20);
  B.clients.add(fast); B.clients.add(slow);
  B.onMessage(`${D}A`, dataMsg('A', 1, { v: 1 })); clearTimeout(B.flushTimer); B.flush();
  check('밀린 클라이언트는 batch 건너뜀', fast.got.join() === 'event: batch' && slow.got.length === 0 && B.lagSkips === 1);
  slow.writableLength = 0;
  B.onMessage(`${D}A`, dataMsg('A', 2, { v: 2 })); clearTimeout(B.flushTimer); B.flush();
  check('따라잡으면 batch 대신 snapshot 한 번', slow.got.join() === 'event: snapshot' && fast.got.length === 2 && B.resyncs === 1);
  B.onMessage(`${D}A`, dataMsg('A', 3, { v: 3 })); clearTimeout(B.flushTimer); B.flush();
  check('그 뒤로는 batch', slow.got.at(-1) === 'event: batch');
  B.clients.clear(); B.close();
}

check('토픽 필터', topicMatch('opcua/json/#', 'opcua/json/data/a/b/c') && topicMatch('aas/+/environment', 'aas/demo/environment')
  && !topicMatch('aas/+/environment', 'aas/demo/x/environment') && !topicMatch('a/b', 'a'));

// ── 데모 소스 끝까지: 데모 브로커 → MqttSub → 수신 점검 · FAC 대리 ──
{
  const demo = await startBDemo({ interval: 100, speed: 40 });
  const { server, cfg } = await startServer({ host: '127.0.0.1', port: 0, b: demo.conf });
  const base = `http://127.0.0.1:${cfg.port}`;
  const get = async (p) => { const r = await fetch(base + p); return { code: r.status, body: await r.json() }; };
  try {
    let v = null;
    const ok = await until(async () => {
      v = (await get(cfg.api.bInspect)).body;
      return v.n > 0 && v.topics.some((t) => t.gaps > 0) && v.topics.some((t) => t.errors > 0);
    }, 12000);
    const names = v.topics.map((t) => t.topic.split('/').at(-1));
    check('데모: 셀·AMR·견마·드론 값이 들어옴', ['Cell_SORT', 'Plant', 'Robot_HOUND-02', 'Robot_DRONE-01'].every((n) => names.includes(n)) && names.some((n) => n.startsWith('AMR_')), names.slice(0, 8).join(','));
    check('데모: 일부러 섞은 seq 누락·깨진 JSON 을 점검이 잡음', ok, `누락 ${v.topics.reduce((n, t) => n + t.gaps, 0)} · 오류 ${v.topics.reduce((n, t) => n + t.errors, 0)} (주입 ${demo.pub.injected.gaps}/${demo.pub.injected.junk})`);
    const bs = (await get(cfg.api.bStatus)).body;
    check('데모 표시', v.demo === true && bs.demo === true);
    check('데모: 시뮬 로그 → 이벤트 · 렌더 이벤트는 쌓이지 않음', bs.counts.event > 0 && demo.pub.state.events.length === 0, `이벤트 ${bs.counts.event}`);
    const meta = v.topics.filter((t) => t.topic.includes('/metadata/')).length;
    check('데모: 메타데이터 retained 수신', meta >= 5, String(meta));
    const st = (await get(`${cfg.api.bFac}/status`)).body;
    check('데모 FAC: 운전 중 · 시뮬 시각 흐름', st.active === true && st.t > 0 && /^demo-/.test(st.run), `${st.run} t=${st.t?.toFixed(0)}`);
    const sk = await get(`${cfg.api.bFac}/stock`);
    check('데모 FAC 재고 모양', sk.code === 200 && typeof sk.body.data.stock.OUT.KIT === 'number');
    check('데모 FAC 없는 조회 404', (await get(`${cfg.api.bFac}/po`)).code === 404);
    const sameSeq = v.ring.find((m) => m.items[0]?.kind === 'data');
    check('점검 링: 원문 + 푼 항목 같이', !!sameSeq && JSON.parse(sameSeq.raw).Messages[0].SequenceNumber === sameSeq.items[0].seq);
  } finally {
    await new Promise((r) => server.close(r));
    await demo.close();
  }
}

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
