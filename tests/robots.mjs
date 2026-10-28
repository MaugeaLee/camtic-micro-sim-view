// 순찰·점검 로봇(가정): 설비 점검 견마(HOUND-02) · 공정 검사 드론 2 · 재고 실사 드론 1. 생산 흐름은 바꾸지 않는다.
import { readFileSync } from 'node:fs';
import { CellHealth, INSPECT, scanPoint } from '../js/sim/patrol.js';
import { DRONE, unit } from '../js/sim/drone.js';
import { HOUND, insideKeepout } from '../js/sim/hound.js';
import { FIELD_SIZE, defaultLayout } from '../js/sim/layout.js';
import { ViewerState } from '../js/sim/state.js';
import { snapshot } from '../js/data/hub.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const process_ = JSON.parse(readFileSync(new URL('../src/process.default.json', import.meta.url), 'utf8'));
const mk = (o = {}) => new ViewerState({ scenario: 'supply', quiet: true, process: process_, ...o });

console.log('robots');

// ── 설비 건강도(가정 모델) ──
{
  const H = new CellHealth(['PRESS']);
  for (let i = 0; i < 2000; i++) H.step(1, { PRESS: { id: 'PRESS', state: 'BUSY' } });
  H.step(1000, { PRESS: { id: 'PRESS', state: 'IDLE' } });
  const c = H.cells.PRESS;
  check('BUSY 에서만 닳는다', Math.abs(c.health - (100 - 2000 * 0.0045)) < 1e-6 && c.busy === 2000, c.health.toFixed(2));
  for (let i = 0; i < 5000; i++) H.step(1, { PRESS: { id: 'PRESS', state: 'BUSY' } });
  const r = H.judge('PRESS', 10);
  check('임계 아래면 예지정비 권고 → 회복', r.result === '예지정비' && H.cells.PRESS.health === 100, JSON.stringify(r));
  H.cells.PRESS.drift = 0.2;
  check('드리프트 넘으면 재보정', H.judge('PRESS', 11).result === '재보정' && H.cells.PRESS.drift === 0);
  check('정상', H.judge('PRESS', 12).result === '정상');
}

// ── 스캔 자리: 발자국 밖 통로 ──
{
  const L = defaultLayout();
  for (const id of ['SORT', 'PRESS', 'SCREW']) {
    const p = scanPoint(L, id);
    if (!p || insideKeepout(p.x, p.z, L)) check(`${id} 스캔 자리 통로`, false, JSON.stringify(p));
  }
  check('스캔 자리는 셀 발자국(+여유) 밖', true);
}

check('결정론 해시 [0,1)', [...Array(200)].every((_, i) => { const u = unit(`X#${i}`); return u >= 0 && u < 1; }) && unit('A#1') === unit('A#1') && unit('A#1') !== unit('A#2'));

// ── 2시간 소크 ──
const s = mk();
const P = s.plant;
check('로봇 6대: 견마 2 + 드론 3', P.robots.length === 5 && P.robots.filter((r) => r.role === 'process').length === 2 && P.robots.some((r) => r.role === 'stock') && P.robots.some((r) => r.role === 'inspect'), P.robots.map((r) => `${r.id}:${r.role}`).join(','));
s.follow('DRONE-02'); s.follow('HOUND-02');
check('드론·점검 견마를 따라갈 수 있다', s.followed === 'HOUND-02');

let houndMin = Infinity, droneMin = Infinity, sameLayer = Infinity, maxDog = 0, maxDrone = 0, maxAlt = 0, minAlt = Infinity, inBox = 0, outField = 0, lowShare = 0;
let charged = false, scanned = new Set(), dogLow = 100, droneLow = 100;
const last = new Map();
const W = FIELD_SIZE.w / 2, D = FIELD_SIZE.d / 2;
const windows = [];
let win = { h1: 0, h2: 0, charge: 0 };
for (let i = 0; i < 72000; i++) {
  s.step(0.1);
  const dogs = [P.hound, P.inspector];
  houndMin = Math.min(houndMin, Math.hypot(dogs[0].x - dogs[1].x, dogs[0].z - dogs[1].z));
  for (const d of dogs) {
    const L0 = last.get(d.id);
    if (L0) {
      const m = Math.hypot(d.x - L0.x, d.z - L0.z);
      maxDog = Math.max(maxDog, m);
      win[d.id === 'HOUND-01' ? 'h1' : 'h2'] += m;
    }
    last.set(d.id, { x: d.x, z: d.z });
  }
  if (insideKeepout(P.inspector.x, P.inspector.z, P.layout, HOUND.pad - 0.05)) inBox++;
  if (P.inspector.mode === 'charge') { charged = true; win.charge++; }
  if (P.inspector.mode === 'scan') scanned.add(P.inspector.target.id);
  dogLow = Math.min(dogLow, P.inspector.battery);
  const ds = P.drones.drones;
  for (const d of ds) {
    const L0 = last.get(d.id);
    if (L0) maxDrone = Math.max(maxDrone, Math.hypot(d.x - L0.x, d.y - L0.y, d.z - L0.z));
    last.set(d.id, { x: d.x, y: d.y, z: d.z });
    maxAlt = Math.max(maxAlt, d.y);
    if (d.flying && d.mode === 'work') minAlt = Math.min(minAlt, d.y);
    if (Math.abs(d.x) > W || Math.abs(d.z) > D) outField++;
    droneLow = Math.min(droneLow, d.battery);
  }
  for (let a = 0; a < ds.length; a++) for (let b = a + 1; b < ds.length; b++) {
    if (!ds[a].flying || !ds[b].flying) continue;
    const A = ds[a], B = ds[b], hz = Math.hypot(A.x - B.x, A.z - B.z);
    droneMin = Math.min(droneMin, Math.hypot(hz, A.y - B.y));
    if (Math.abs(A.y - B.y) < DRONE.layer) sameLayer = Math.min(sameLayer, hz);
    if (A.y < 4 && B.y < 4 && hz < DRONE.sep - 0.05) lowShare++;
  }
  if (i % 6000 === 5999) { windows.push(win); win = { h1: 0, h2: 0, charge: 0 }; }
}
const v = P.drones.view();
const st = v.drones.map((d) => d.stats);
const inspected = st.reduce((a, x) => a + x.inspected, 0);
const made = P.lifts.reduce((a, id) => a + P.work[id].done, 0) + P.work.OUT.stored;
console.log(`    2h: 키트 적재 ${P.work.OUT.stored} · 검사 ${inspected}/${made} (건너뜀 ${v.skipped}, 대기 ${v.queue}) · 재검 ${st.reduce((a, x) => a + x.ng, 0)} · 실사 ${st[2].counts} · 점검 견마 스캔 ${P.inspector.scans} ${JSON.stringify(P.inspector.counts)}`);

check('점검 견마: 셀 3곳 모두 스캔', ['SORT', 'PRESS', 'SCREW'].every((id) => scanned.has(id)) && P.inspector.scans >= 30, `${[...scanned]} · ${P.inspector.scans}회`);
check('점검 견마: 셀 발자국 안에 들어가지 않음', inBox === 0, `${inBox} 스텝`);
check('점검 견마: 30 % 아래에서 충전 자리로 가서 충전', charged && dogLow > 20, `최저 ${dogLow.toFixed(1)}%`);
check('견마 스텝 ≤ 0.25 m(순간이동 없음)', maxDog <= 0.25, maxDog.toFixed(3));
check('견마 둘 사이 간격 ≥ 반경 합', houndMin >= 2 * HOUND.radius - 0.02, houndMin.toFixed(2));
check('견마 둘 다 10분 창마다 움직임(교착 없음, 점검 견마는 충전 창 제외)', windows.every((w) => w.h1 > 20 && (w.h2 > 5 || w.charge > 5000)), windows.map((w) => `${w.h1.toFixed(0)}/${w.h2.toFixed(0)}${w.charge ? 'c' : ''}`).join(' '));

check('드론: 공정 검사 = 끝난 pass·적재 − 건너뜀 − 대기(±진행 중 2)', Math.abs(made - v.skipped - v.queue - inspected) <= 2 && inspected > 50, `${inspected} vs ${made} − ${v.skipped} − ${v.queue}`);
check('드론: 건너뛴 검사 ≤ 5 %', v.skipped <= made * 0.05, `${v.skipped}`);
check('드론: 재고 실사 불일치 0', st[2].counts >= 20 && st[2].mismatch === 0, `실사 ${st[2].counts} · 불일치 ${st[2].mismatch}`);
check('드론 스텝 ≤ 0.25 m', maxDrone <= 0.25, maxDrone.toFixed(3));
check('드론 고도: 벽(8 m) 아래 · 작업은 셀(2.4 m) 위', maxAlt <= 6.45 && minAlt >= DRONE.low - 0.06, `${minAlt.toFixed(2)}~${maxAlt.toFixed(2)}`);
check('드론 필드 밖 0', outField === 0);
check('드론끼리 3D 간격 ≥ 0.75 m', droneMin >= 0.75, droneMin.toFixed(2));
check('같은 층(고도 차 < 0.75)이면 수평 ≥ 1.2 m', sameLayer >= 1.2, sameLayer.toFixed(2));
check('저고도 한 자리에 한 대', lowShare === 0, `${lowShare}`);
check('드론 배터리 0 없음 · 25 % 아래면 귀환', droneLow > 15 && v.drones.every((d) => d.stats.flight > 300), `최저 ${droneLow.toFixed(1)}% · 비행 ${v.drones.map((d) => d.stats.flight.toFixed(0)).join('/')} s`);

const snap = snapshot(s);
check('hub 스냅샷에 로봇 5대', snap.robots?.length === 5 && snap.robots.every((r) => Number.isFinite(r.x) && r.task));

// ── 고장 → 드론 우선 출동·중계 ──
{
  const f = mk({ scenario: 'faults' });
  let arrive = null, relayed = false, down = null;
  for (let i = 0; i < 2400; i++) {
    f.step(0.1);
    const u = f.plant.units.PRESS;
    if (u.down && down == null) down = f.time;
    const d = f.plant.drones.drones.find((x) => x.job?.kind === 'fault' && x.job.cell === 'PRESS');
    if (d && d.mode === 'work' && arrive == null) arrive = f.time;
    if (d && d.mode === 'work' && u.down) relayed = true;
    if (down != null && !u.down && f.time > down + 1) break;
  }
  check('PRESS 고장(110 s) → 드론이 30 s 안에 상공 도착', down != null && arrive != null && arrive - down <= 30, `고장 ${down?.toFixed(0)} s · 도착 ${arrive?.toFixed(1)} s`);
  check('복구 전까지 중계', relayed);
  for (let i = 0; i < 100; i++) f.step(0.1);
  check('복구 뒤 중계 끝', !f.plant.drones.drones.some((x) => x.job?.kind === 'fault'));
}

// ── 생산 흐름 불변 · 결정론 ──
{
  const run = (o) => { const x = mk(o); for (let i = 0; i < 18000; i++) x.step(0.1); return x.plant; };
  const a = run({ drones: 0, inspect: false }), b = run({ drones: 3, inspect: false });
  check('드론은 생산 흐름을 바꾸지 않는다(30분 같은 결과)', a.work.OUT.stored === b.work.OUT.stored && a.delivered === b.delivered && JSON.stringify(a.allAmrs.map((m) => [m.x.toFixed(3), m.z.toFixed(3)])) === JSON.stringify(b.allAmrs.map((m) => [m.x.toFixed(3), m.z.toFixed(3)])), `${a.work.OUT.stored} vs ${b.work.OUT.stored}`);
  const c = run({}), d = run({});
  check('결정론: 같은 입력 같은 로봇 위치', JSON.stringify(c.robots.map((r) => [r.x, r.z, r.y ?? 0])) === JSON.stringify(d.robots.map((r) => [r.x, r.z, r.y ?? 0])));
  check('drones 0~3 검사', (() => { try { mk({ drones: 4 }); return false; } catch { return true; } })());
}

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
