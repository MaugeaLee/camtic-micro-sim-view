// 운영자 주입(하단 패널): 설비 고장 · 자재 공급 차질 · 현장 이벤트 · AMR 플릿 속도/정지 · 복원 재생.
import { readFile } from 'node:fs/promises';
import { Incidents, specErrors, FLOOR_SCALE } from '../js/sim/incidents.js';
import { AMR } from '../js/sim/fleet.js';
import { ViewerState } from '../js/sim/state.js';
import { defaultLayout } from '../js/sim/layout.js';
import { dumpPlant, restoreTime, validatePlant } from '../js/data/plant.js';
import { equipmentStatus } from '../js/data/monitor.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('incidents');
const processDoc = JSON.parse(await readFile(new URL('../src/process.default.json', import.meta.url), 'utf8'));
const layout = defaultLayout();
const make = () => new ViewerState({ scenario: 'supply', quiet: false, layout, process: processDoc });
const run = (s, sec, each = null) => { for (let i = 0, n = Math.round(sec / 0.1); i < n; i++) { s.step(0.1); each?.(s); } };
const logged = (s, re) => s.logs.some((l) => re.test(l.title));

// ── 기록 단위 ──
check('잘못된 주입 거부', specErrors({ kind: 'x' }).length > 0 && specErrors({ kind: 'fault' }).length > 0
  && specErrors({ kind: 'supply', target: 'raw', mode: 'cut' }).length > 0 && specErrors({ kind: 'fault', target: 'PRESS', dur: -1 }).length > 0
  && specErrors({ kind: 'fleet', type: 'speed', target: 'trim', value: 3 }).length > 0 && specErrors({ kind: 'event', type: 'worker' }).length > 0);
const I = new Incidents();
const f1 = I.add({ kind: 'fault', target: 'PRESS:R6', dur: 30 }, 10);
check('셀 장비 고장 = 그 셀 정지 구간(넣은 다음 스텝부터 끝 스텝까지)', !I.cellStop('PRESS', 10) && I.cellStop('PRESS', 10.1) === f1 && I.cellStop('PRESS', 40) === f1 && !I.cellStop('PRESS', 40.1) && !I.cellStop('SCREW', 20));
check('복구는 지금 시각에 끝냄', I.clear(f1.no, 20) && !I.cellStop('PRESS', 20.1) && I.cellStop('PRESS', 15) === f1 && !I.clear(f1.no, 25) && !I.active(20).includes(f1));
I.add({ kind: 'fleet', type: 'speed', target: 'trim', value: 0.5 }, 5);
I.add({ kind: 'fleet', type: 'speed', target: 'trim', value: 0.75 }, 8);
I.add({ kind: 'event', type: 'floor', dur: 10 }, 9);
check('플릿 속도: 뒤 설정이 앞 설정을 끝냄 · 바닥 이상 감속 곱', I.fleetSpeed('trim', 6) === 0.5 && I.fleetSpeed('trim', 8) === 0.75 && I.fleetScale('trim', 10) === 0.75 * FLOOR_SCALE && I.fleetScale('trim', 20) === 0.75 && I.fleetScale('parts', 10) === FLOOR_SCALE);
const J = new Incidents();
check('저장본 다시 읽기(잘못된 줄 버림)', J.load([...I.dump(), { kind: 'nope', at: 1 }, { kind: 'fault', target: 'SORT', at: 'x' }]) === I.list.length && J.seq === I.seq);

// ── 셀 고장 주입 ──
const a = make();
run(a, 600);
let threw = false;
try { a.inject({ kind: 'fault', target: 'NOPE', dur: 30 }); } catch { threw = true; }
check('없는 대상 주입 거부', threw);
const fx = a.inject({ kind: 'fault', target: 'SCREW', dur: 60, why: '체결 토크 이상(가정)' });
let downAll = true;
run(a, 59, (s) => { if (s.cell('SCREW').state !== 'DOWN') downAll = false; });
check('셀 고장 주입 동안 DOWN', downAll && a.plant.units.SCREW.down === fx && logged(a, /SCREW 고장 주입/));
run(a, 2);
check('시간이 지나면 복구', a.cell('SCREW').state !== 'DOWN' && !a.plant.units.SCREW.down && logged(a, /SCREW 고장 주입 해제/));
const eq = a.equip.find((e) => e.cell === 'PRESS');
const fe = a.inject({ kind: 'fault', target: eq.id, why: `${eq.name} 로봇 충돌 감지(가정)`, dur: 300 });
run(a, 1);
const doc = equipmentStatus(a, eq.id);
check(`셀 장비(${eq.id}) 고장 = 셀 DOWN · 장비 모니터 사유`, a.cell('PRESS').state === 'DOWN' && doc.state === 'DOWN' && doc.fault?.why === fe.why);
a.clearIncident(fe.no);
run(a, 0.2);
check('복구 버튼(해제) 바로 반영', a.cell('PRESS').state !== 'DOWN');

// ── AMR 고장 · 플릿 정지 · 속도 ──
const b = make();
run(b, 900);
const mover = b.fleet('trim').amrs.find((x) => x.moving && !x.docked) ?? b.fleet('trim').amrs[0];
const p0 = { x: mover.x, z: mover.z };
b.inject({ kind: 'fault', target: mover.id, dur: 40 });
let still = true, minGap = Infinity;
run(b, 39, (s) => {
  if (Math.hypot(mover.x - p0.x, mover.z - p0.z) > 1e-6) still = false;
  for (const o of s.amrs) if (o !== mover && !o.off) minGap = Math.min(minGap, Math.hypot(o.x - mover.x, o.z - mover.z));
});
check(`AMR 고장(${mover.id}) 동안 제자리 · 모니터 DOWN`, still && equipmentStatus(b, mover.id).state === 'DOWN', `최근접 ${minGap.toFixed(2)} m`);
check('고장 AMR 를 다른 차가 뚫고 지나가지 않음(중심 간격 > 반경)', minGap > AMR.radius);
const dist0 = mover.dist;
run(b, 120);
check('고장이 풀리면 다시 달림', mover.dist > dist0 + 1 || mover.mode === 'park', `주행 +${(mover.dist - dist0).toFixed(1)} m`);

b.setFleetHalt('trim', true);
const trim = b.fleet('trim').amrs, at0 = trim.map((x) => [x.x, x.z]);
run(b, 30);
check('메인 AMR 전체 정지', trim.every((x, i) => x.x === at0[i][0] && x.z === at0[i][1]) && trim.every((x) => x.halt));
check('서브 AMR 은 그대로', b.fleet('parts').amrs.every((x) => !x.halt));
b.setFleetHalt('trim', false);
b.setFleetSpeed('trim', 0.5);
let vmax = 0;
run(b, 300, (s) => { for (const x of s.fleet('trim').amrs) vmax = Math.max(vmax, x.v); });
check('속도 ×0.5 이면 주행 상한 절반', vmax > 0.1 && vmax <= AMR.vEmpty * 0.5 + 1e-6, `최고 ${vmax.toFixed(2)} m/s`);
b.setFleetSpeed('trim', 1);

// ── 자재 공급 차질 ──
const c = make();
run(c, 300);
const S = c.plant.store, U = c.plant.supply;
c.inject({ kind: 'supply', target: 'raw', mode: 'stop', dur: 600 });
c.inject({ kind: 'supply', target: 'parts', mode: 'stop', dur: 600 });
run(c, 0.2);
const r0 = S.received, k0 = U.picked;
run(c, 590);
check('원재료 입고 중단 동안 재보충 0', S.received === r0, `받음 ${S.received - r0}`);
check('부품 창고 출고 중단 동안 적재 0 · 요청은 쌓임', U.picked === k0 && U.waiting.length > 0, `대기 라인 ${U.waiting.length}`);
run(c, 900);
check('중단이 풀리면 다시 채움', S.received > r0 && U.picked > k0, `원재료 +${S.received - r0} · 토트 +${U.picked - k0}`);
const r1 = S.received;
c.inject({ kind: 'supply', target: 'raw', mode: 'slow', dur: 1800 });
let gap = null;
run(c, 1700, () => { if (gap == null && S.received > r1) gap = S.next - c.time; });
check('원재료 입고 지연 ×3 = 다음 재보충까지 3배', gap != null && Math.abs(gap - S.def.restock * 3) < 0.2, `간격 ${gap?.toFixed(1)} s · 기본 ${S.def.restock} s`);

// ── 현장 이벤트 ──
const d = make();
run(d, 900);
d.inject({ kind: 'event', type: 'worker', target: 'PRESS', dur: 60 });
run(d, 1);
check('작업자 진입 = 그 셀 정지', d.cell('PRESS').state === 'DOWN' && d.cell('SCREW').state !== 'DOWN');
d.inject({ kind: 'event', type: 'aisle', dur: 30 });
const all = d.amrs.filter((x) => !x.off), pos = all.map((x) => [x.x, x.z]);
run(d, 25);
check('통로 통제 = 두 플릿 전체 정지', all.every((x, i) => x.x === pos[i][0] && x.z === pos[i][1]));
run(d, 10);
d.inject({ kind: 'event', type: 'floor', dur: 120 });
run(d, 0.2);
check('바닥 이상 = 세 플릿 감속', d.acs.scale === FLOOR_SCALE && d.plant.supply.acs.scale === FLOOR_SCALE && d.plant.jacks.scale === FLOOR_SCALE);
run(d, 200);
check('이벤트가 끝나면 원래 속도', d.acs.scale === 1 && d.cell('PRESS').state !== 'DOWN');

// ── 복원 재생: 주입 기록을 저장본에 두면 같은 시각에 같은 일이 난다 ──
const e1 = make();
run(e1, 400);
e1.inject({ kind: 'fault', target: 'SORT', dur: 90 });
run(e1, 200);
e1.setFleetSpeed('parts', 0.75);
e1.inject({ kind: 'event', type: 'aisle', dur: 20 });
run(e1, 300);
const dump = dumpPlant(e1, { process: true });
const v = validatePlant(dump);
const e2 = make();
restoreTime(e2, v.doc.t, v.doc.incidents);
const same = e2.amrs.every((x, i) => Math.abs(x.x - e1.amrs[i].x) < 1e-9 && Math.abs(x.z - e1.amrs[i].z) < 1e-9)
  && e2.plant.units.SORT.done === e1.plant.units.SORT.done && e2.plant.delivered === e1.plant.delivered;
check('저장본에 주입 기록 · 재생 결정론', v.ok && v.doc.incidents.length === 3 && same, `기록 ${v.doc.incidents.length}건`);
const e3 = make();
restoreTime(e3, v.doc.t);
check('주입 기록 없이 재생하면 다름(점검이 살아 있음)', e3.amrs.some((x, i) => Math.abs(x.x - e1.amrs[i].x) > 1e-6) || e3.plant.units.SORT.done !== e1.plant.units.SORT.done);

// ── 주입이 끝난 뒤 생산 계속(교착 없음) ──
const g = make();
run(g, 1200);
g.inject({ kind: 'fault', target: g.fleet('trim').amrs[0].id, dur: 120 });
g.inject({ kind: 'fault', target: 'PRESS', dur: 120 });
g.inject({ kind: 'supply', target: 'parts', mode: 'slow', dur: 600 });
g.inject({ kind: 'event', type: 'aisle', dur: 60 });
run(g, 700);
const done0 = g.plant.units.PRESS.done + g.plant.units.SCREW.done, out0 = g.plant.outbound;
run(g, 1500);
check('주입 뒤 25분 안에 PRESS·SCREW 완료 · 적재 계속', g.plant.units.PRESS.done + g.plant.units.SCREW.done > done0 && g.plant.outbound > out0, `완료 +${g.plant.units.PRESS.done + g.plant.units.SCREW.done - done0} · 적재 +${g.plant.outbound - out0}`);
check('엔티티 소유 위반 0', g.plant.parts.violationCount === 0);

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
