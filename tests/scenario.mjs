// 시나리오: 셀 상태 구동, ACS 배송, 간섭, 재현성, 레이아웃 변경.
import { ViewerState } from '../js/sim/state.js';
import { AMR_MAX, DEFAULT_SCENARIO, SCENARIOS, validateScenario } from '../js/sim/scenario.js';
import { AMR } from '../js/sim/fleet.js';
import { bounds, defaultLayout } from '../js/sim/layout.js';
import { snapshot } from '../js/data/hub.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('scenario');
check('시나리오 정의 유효', Object.values(SCENARIOS).every((s) => validateScenario(s).length === 0));
check(`잘못된 시나리오 거부 (AMR ${AMR_MAX}대 초과)`, validateScenario({ ...SCENARIOS.supply, amr: AMR_MAX + 1 }).length > 0);
check('기본 시나리오는 고장 없음', DEFAULT_SCENARIO === 'supply' && SCENARIOS.supply.faults.length === 0);

// 헤드리스로 돌리며 기록한다. 셀 발자국 침범은 그 셀 잠금을 쥔 AMR만 허용한다.
export function run(key, seconds, { amr = null, layoutAt = null } = {}) {
  const s = new ViewerState({ scenario: key, quiet: false, amr });
  s.setRunning(true); s.setSpeed(30);
  const seen = Object.fromEntries(s.cells.map((c) => [c.id, new Set()]));
  let minGap = Infinity, intrude = 0, maxBlock = 0, battOk = true;
  let lay = defaultLayout();
  const fp = {};
  const refresh = () => { for (const id of Object.keys(lay.cells)) fp[id] = bounds(id, lay.cells[id]); };
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
      for (const [id, b] of Object.entries(fp)) {
        if (A.x > b.x0 + 0.3 && A.x < b.x1 - 0.3 && A.z > b.z0 + 0.3 && A.z < b.z1 - 0.3 && !s.acs.locks[id]?.inside.has(A)) intrude++;
      }
      for (let k = a + 1; k < as.length; k++) minGap = Math.min(minGap, Math.hypot(A.x - as[k].x, A.z - as[k].z));
    }
  }
  const passes = s.logs.filter((l) => l.title.includes('우선 통행')).length;
  return { s, seen, minGap, intrude, maxBlock, battOk, passes };
}

const r = run('supply', 1800);
const units = r.s.plant.summary().units;
check('기본 6대: 배송 발생', r.s.plant.delivered >= 40, `delivered=${r.s.plant.delivered}`);
check('SCREW·PRESS 모두 작업 완료', units.filter((u) => u.id !== 'SORT').every((u) => u.done > 0), units.map((u) => `${u.id}=${u.done}`).join(' '));
check('고장 없음(DOWN 안 나옴)', Object.values(r.seen).every((set) => !set.has('DOWN')));
check('AMR 모두 움직임', r.s.amrs.length === 6 && r.s.amrs.every((a) => a.dist > 20), r.s.amrs.map((a) => `${a.id}=${a.dist.toFixed(0)}m`).join(' '));
check('AMR 간 최소 간격 ≥ 차체 반경 합', r.minGap >= 2 * AMR.radius, `min=${r.minGap.toFixed(2)}m`);
check('잠금 없이 셀 안에 들어가지 않음', r.intrude === 0, `intrude=${r.intrude}`);
check('15초 넘게 막힌 AMR 없음 · 우선 통행 없음', r.maxBlock <= 15 && r.passes === 0, `maxBlock=${r.maxBlock.toFixed(1)}s passes=${r.passes}`);
check('배터리 0~100', r.battOk);

const r2 = run('supply', 1800);
const pos = (s) => s.amrs.map((a) => `${a.x.toFixed(4)},${a.z.toFixed(4)}`).join(';');
check('같은 입력이면 같은 결과(재현)', pos(r.s) === pos(r2.s) && r.s.plant.delivered === r2.s.plant.delivered);

const f = run('faults', SCENARIOS.faults.period);
const states = Object.entries(f.seen).map(([id, set]) => `${id}:${[...set].sort().join('/')}`).join(' ');
check('점검용 고장 시나리오: 셀 3개 × 상태 3종', Object.values(f.seen).every((set) => set.size === 3), states);
check('고장·복구 로그', f.s.logs.some((l) => l.title === 'PRESS 고장') && f.s.logs.some((l) => l.title === 'PRESS 복구'));
check('고장 중에도 간섭·침범 없음', f.minGap >= 2 * AMR.radius && f.intrude === 0, `min=${f.minGap.toFixed(2)}m intrude=${f.intrude}`);

// PRESS 를 아래로 내려도(접속선만 길어짐) 배송은 이어진다. 움직이던 AMR은 충전 자리로 돌아갔다가 다시 배차된다.
const moved = { ...defaultLayout(), cells: { ...defaultLayout().cells, PRESS: { x: 4, z: -4, rotY: 0 } } };
const re = run('supply', 900, { layoutAt: { t: 300, doc: moved } });
const at300 = run('supply', 300).s.plant.delivered;
check('레이아웃 변경 뒤에도 배송 계속', re.s.plant.delivered > at300 + 5 && re.intrude === 0 && re.passes === 0,
  `before=${at300} after=${re.s.plant.delivered} intrude=${re.intrude} passes=${re.passes}`);

const plain = new ViewerState();
plain.setRunning(true); plain.advance(1);
check('시나리오 없으면 셀 상태 그대로 · AMR 없음', plain.cells.every((c) => c.state === 'IDLE') && plain.amrs.length === 0 && plain.acs === null);
const snap = JSON.parse(JSON.stringify(snapshot(r.s)));
check('스냅샷에 AMR 위치', snap.amrs?.length === 6 && Number.isFinite(snap.amrs[0].x) && !('amrs' in snapshot(plain)));

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
