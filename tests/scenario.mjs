// 시나리오·공급 AMR 플릿: 상태 구동, 배차, 간섭, 재현성.
import { ViewerState } from '../js/sim/state.js';
import { AMR_MAX, SCENARIOS, validateScenario } from '../js/sim/scenario.js';
import { AISLE, AMR, dockOf, docksOf } from '../js/sim/fleet.js';
import { bounds, defaultLayout } from '../js/sim/layout.js';
import { FIELD } from '../js/render/field-def.js';
import { snapshot } from '../js/data/hub.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('scenario');
const lane = FIELD.lanes[0];
check('AISLE = field-def lanes[0]', AISLE.z === lane.z && AISLE.half === lane.d / 2);

const layout = defaultLayout();
const docks = docksOf(layout);
check('기본 자리 도크 3개 모두 도달 가능', Object.values(docks).every((d) => d.ok));
check('도크는 셀 앞 모서리 밖·통로 안쪽', Object.values(docks).every((d) => d.z > bounds(d.id, layout.cells[d.id]).z1 && d.queue < AISLE.z - AISLE.half));
check('통로에 붙인 셀은 도달 불가로 표시', dockOf('SCREW', { x: 0, z: 6, rotY: 0 }).ok === false);
check('시나리오 정의 유효', Object.values(SCENARIOS).every((s) => validateScenario(s).length === 0));
check(`잘못된 시나리오 거부 (AMR ${AMR_MAX}대 초과)`, validateScenario({ ...SCENARIOS.supply, amr: AMR_MAX + 1 }).length > 0);

// 헤드리스로 돌리며 기록한다.
function run(key, seconds, { amr = null, layoutAt = null } = {}) {
  const s = new ViewerState({ scenario: key, quiet: false, amr });
  s.setRunning(true); s.setSpeed(30);
  const seen = Object.fromEntries(s.cells.map((c) => [c.id, new Set()]));
  let minGap = Infinity, intrude = 0, maxBlock = 0, battOk = true;
  const fp = Object.fromEntries(s.cells.map((c) => [c.id, null]));
  let lay = defaultLayout();
  const refresh = () => { for (const id of Object.keys(fp)) fp[id] = bounds(id, lay.cells[id]); };
  refresh();
  const steps = Math.round(seconds / 0.1);
  for (let i = 0; i < steps; i++) {
    if (layoutAt && i === Math.round(layoutAt.t / 0.1)) { lay = layoutAt.doc; s.setLayout(lay); refresh(); }
    s.step(0.1);
    for (const c of s.cells) seen[c.id].add(c.state);
    const as = s.amrs;
    for (let a = 0; a < as.length; a++) {
      const A = as[a];
      maxBlock = Math.max(maxBlock, A.blockT);
      if (!(A.battery >= 0 && A.battery <= 100)) battOk = false;
      for (const b of Object.values(fp)) if (A.x > b.x0 + 0.3 && A.x < b.x1 - 0.3 && A.z > b.z0 + 0.3 && A.z < b.z1 - 0.3) intrude++;
      for (let k = a + 1; k < as.length; k++) minGap = Math.min(minGap, Math.hypot(A.x - as[k].x, A.z - as[k].z));
    }
  }
  return { s, seen, minGap, intrude, maxBlock, battOk };
}

const r = run('faults', SCENARIOS.faults.period);
const states = Object.entries(r.seen).map(([id, set]) => `${id}:${[...set].sort().join('/')}`).join(' ');
check('고장 시나리오 한 주기: 셀 3개 × 상태 3종 모두 나옴', Object.values(r.seen).every((set) => set.size === 3), states);
const units = r.s.plant.summary().units;
check('SCREW·PRESS 모두 작업 완료', units.filter((u) => u.id !== 'SORT').every((u) => u.done > 0), units.map((u) => `${u.id}=${u.done}`).join(' '));
check('공급 AMR 배송 발생', r.s.plant.delivered >= 6, `delivered=${r.s.plant.delivered}`);
check('AMR 둘 다 움직임', r.s.amrs.every((a) => a.dist > 20), r.s.amrs.map((a) => `${a.id}=${a.dist.toFixed(0)}m`).join(' '));
check('AMR 간 최소 간격 ≥ 차체 반경 합', r.minGap >= 2 * AMR.radius, `min=${r.minGap.toFixed(2)}m`);
check('셀 발자국 안으로 들어가지 않음', r.intrude === 0, `intrude=${r.intrude}`);
check('15초 넘게 막힌 AMR 없음', r.maxBlock <= 15, `maxBlock=${r.maxBlock.toFixed(1)}s`);
check('배터리 0~100', r.battOk);
check('고장·복구 로그', r.s.logs.some((l) => l.title === 'PRESS 고장') && r.s.logs.some((l) => l.title === 'PRESS 복구'));

const r2 = run('faults', SCENARIOS.faults.period);
const pos = (s) => s.amrs.map((a) => `${a.x.toFixed(4)},${a.z.toFixed(4)}`).join(';');
check('같은 입력이면 같은 결과(재현)', pos(r.s) === pos(r2.s) && r.s.plant.delivered === r2.s.plant.delivered);

const many = run('supply', 900, { amr: 5 });
check('5대: 간섭 없음', many.minGap >= 2 * AMR.radius && many.intrude === 0, `min=${many.minGap.toFixed(2)}m intrude=${many.intrude}`);
check('5대: 교착 없음', many.maxBlock <= 15 && many.s.plant.delivered >= 10, `maxBlock=${many.maxBlock.toFixed(1)}s delivered=${many.s.plant.delivered}`);

const moved = { ...defaultLayout(), cells: { ...defaultLayout().cells, PRESS: { x: -16, z: -4, rotY: 90 } } };
const re = run('supply', 600, { layoutAt: { t: 200, doc: moved } });
const before = re.s.plant.delivered;
check('레이아웃 변경 뒤에도 배송 계속', before >= 6 && re.intrude === 0, `delivered=${before} intrude=${re.intrude}`);

const plain = new ViewerState();
plain.setRunning(true); plain.advance(1);
check('시나리오 없으면 셀 상태 그대로', plain.cells.every((c) => c.state === 'IDLE') && plain.amrs.length === 0);
const snap = JSON.parse(JSON.stringify(snapshot(r.s)));
check('스냅샷에 AMR 위치', snap.amrs?.length === 2 && Number.isFinite(snap.amrs[0].x) && !('amrs' in snapshot(plain)));

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
