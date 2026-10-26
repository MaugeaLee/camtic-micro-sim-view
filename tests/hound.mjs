// 견마: 통로 겹침·맞물림·끼임만 이상으로 보고, 도크·충전 자리 정박은 제외. 출동해 차체를 밀어 간격을 연다.
import { Amr } from '../js/sim/fleet.js';
import { Hound, HOUND, PATROL, circleGap, eventKey, findAnomalies, insideKeepout, routeTo, worldOf } from '../js/sim/hound.js';
import { defaultLayout, bounds, placeOf } from '../js/sim/layout.js';
import { ViewerState } from '../js/sim/state.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

const bot = (id, i, x, z, extra = {}) => {
  const a = new Amr(id, i, { x, z, heading: 0 });
  Object.assign(a, extra);
  return a;
};

console.log('hound');
{
  const a = bot('AMR-01', 0, 0, 0, { mode: 'job', at: { kind: 'free' } });
  const b = bot('AMR-02', 1, 0.3, 0, { mode: 'job', at: { kind: 'free' } });
  const hits = findAnomalies([a, b]);
  check('통로에서 겹친 두 대는 overlap 이상', hits.length === 1 && hits[0].kind === 'overlap' && eventKey(hits[0]) === 'overlap:AMR-01+AMR-02', JSON.stringify(hits));
  check('겹침 간격은 음수', circleGap(a, b) < 0, circleGap(a, b).toFixed(2));
}
{
  const a = bot('AMR-01', 0, 0, 0), b = bot('AMR-02', 1, 0.3, 0);
  check('충전 자리 정박 겹침은 이상 아님', findAnomalies([a, b]).length === 0);
}
{
  const a = bot('AMR-01', 0, 0, 0), b = bot('AMR-02', 1, 8, 0);
  check('떨어진 주차는 이상 아님', findAnomalies([a, b]).length === 0);
}
{
  const a = bot('AMR-01', 0, 0, 0, {
    mode: 'job', at: { kind: 'cell', id: 'PRESS', stop: 0 }, inBranch: 'PRESS',
    ticket: { released: false }, steps: [{ until: () => false }],
  });
  const b = bot('AMR-02', 1, 0.25, 0, { mode: 'job', at: { kind: 'free' }, steps: [{ go: [{ x: 4, z: 0 }] }] });
  check('도크 정박과 겹쳐도 이상 아님', findAnomalies([a, b]).length === 0);
}
{
  const a = bot('AMR-01', 0, 0, 0, {
    mode: 'job', at: { kind: 'cell', id: 'PRESS', stop: 0 }, inBranch: 'PRESS',
    steps: [{ until: () => false }], blockT: 20,
  });
  check('도크 정박은 끼임이 아님', findAnomalies([a]).length === 0);
}
{
  const a = bot('AMR-01', 0, 0, 0, {
    mode: 'job', at: { kind: 'cell', id: 'PRESS', stop: 0 }, inBranch: 'PRESS',
    steps: [{ until: () => false }], blockT: 5,
  });
  const b = bot('AMR-02', 1, 4, 0, { mode: 'job', at: { kind: 'free' }, steps: [{ go: [{ x: 0, z: 0 }] }], blockT: 5 });
  a.blockedOn = b; b.blockedOn = a;
  check('도크 정박이 한쪽이면 jam 아님', findAnomalies([a, b]).length === 0);
}
{
  const a = bot('AMR-01', 0, 0, 0, { steps: [{ until: () => false }], blockT: 20 });
  check('하역 대기(until)는 끼임이 아님', findAnomalies([a]).length === 0);
}
{
  const a = bot('AMR-01', 0, 0, 0, { mode: 'job', at: { kind: 'free' }, steps: [{ go: [{ x: 4, z: 0 }] }], blockT: 9, moving: false });
  const b = bot('AMR-02', 1, 4, 0, { mode: 'job', at: { kind: 'free' }, steps: [{ go: [{ x: 0, z: 0 }] }] });
  a.blockedOn = b; b.blockedOn = a; a.blockT = 3; b.blockT = 3;
  const hits = findAnomalies([a, b]);
  check('서로 막히면 jam', hits.some((h) => h.kind === 'jam'), hits.map((h) => h.kind).join(','));
}
{
  const a = bot('AMR-01', 0, 0, 0), b = bot('AMR-02', 1, 0.25, 0);
  a.steps = [{ go: [{ x: 6, z: 0 }] }];
  b.steps = [{ go: [{ x: -6, z: 0 }] }];
  const host = { logs: [], ev: [], log(_l, t, b) { this.logs.push({ t, ...b }); }, emit(type, d) { this.ev.push({ type, ...d }); } };
  const dog = new Hound({ home: { x: 0, z: 3 } });
  const before = circleGap(a, b);
  for (let i = 0; i < 400 && dog.fixed < 1; i++) dog.step(0.1, [a, b], host);
  check('출동 후 접촉 리커버리로 간격이 열린다', dog.fixed === 1 && circleGap(a, b) > before && circleGap(a, b) > 0, `fixed ${dog.fixed} gap ${before.toFixed(2)}→${circleGap(a, b).toFixed(2)}`);
  check('이상을 Event 로 전파(log·emit)', host.ev.some((e) => e.type === 'hound:event' && e.kind === 'overlap') && host.ev.some((e) => e.type === 'hound:recover'), host.ev.map((e) => e.type).join(','));
  check('passT 를 줘 다시 붙지 않게', a.passT >= 3 && b.passT >= 3);
}
{
  const dog = new Hound();
  const x0 = dog.x, z0 = dog.z;
  for (let i = 0; i < 80; i++) dog.step(0.1, [], null);
  check('이상 없으면 순찰 경로를 돈다', dog.mode === 'patrol' && Math.hypot(dog.x - x0, dog.z - z0) > 2, `${dog.mode} ${Math.hypot(dog.x - x0, dog.z - z0).toFixed(2)} m`);
  check('순찰 기점은 통로 사각형', PATROL.length === 4 && PATROL.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)));
}
{
  const s = new ViewerState({ scenario: 'supply', quiet: true });
  check('플랜트에 견마 1대', s.plant.hound?.id === HOUND.id);
  s.follow('HOUND-01');
  check('견마를 따라갈 수 있다', s.followed === 'HOUND-01');
  const x0 = s.plant.hound.x, z0 = s.plant.hound.z;
  for (let i = 0; i < 80; i++) s.step(0.1);
  check('시나리오 안에서도 순찰한다', s.plant.hound.mode === 'patrol' && Math.hypot(s.plant.hound.x - x0, s.plant.hound.z - z0) > 2, `${s.plant.hound.mode} ${Math.hypot(s.plant.hound.x - x0, s.plant.hound.z - z0).toFixed(2)} m`);
}
{
  const layout = defaultLayout();
  const world = worldOf(layout);
  const press = placeOf(layout, 'PRESS');
  const pb = bounds('PRESS', press);
  const sort = placeOf(layout, 'SORT');
  const sb = bounds('SORT', sort);
  const aisleX = world.patrol.some((p) => p.x > sb.x1 && p.x < pb.x0);
  check('순찰이 셀 사이 통로를 포함한다', aisleX && world.patrol.every((p) => p.z < 8.2 && p.z > -12), JSON.stringify(world.patrol));
  const dog = new Hound({ layout });
  let clip = 0, maxStep = 0, travel = 0, px = dog.x, pz = dog.z, minCell = Infinity;
  for (let i = 0; i < 800; i++) {
    dog.step(0.1, [], null, layout);
    const d = Math.hypot(dog.x - px, dog.z - pz);
    maxStep = Math.max(maxStep, d);
    travel += d;
    px = dog.x; pz = dog.z;
    if (insideKeepout(dog.x, dog.z, layout)) clip++;
    minCell = Math.min(minCell, Math.hypot(dog.x - press.x, dog.z - press.z), Math.hypot(dog.x - sort.x, dog.z - sort.z));
  }
  check('순찰이 셀·창고를 뚫지 않는다', clip === 0, `clip ${clip}`);
  check('관제 보행은 출동 속도 이하', maxStep <= HOUND.sprint * 0.1 + 1e-6, `step ${maxStep.toFixed(3)} m`);
  check('팩토리 통로를 실제로 걷는다', travel > 20 && minCell < 14, `travel ${travel.toFixed(1)} m · 셀까지 ${minCell.toFixed(1)} m`);
}
{
  const layout = defaultLayout();
  const from = worldOf(layout).patrol[0];
  const press = placeOf(layout, 'PRESS');
  const path = routeTo(from, { x: press.x, z: press.z }, layout);
  const through = path.some((p) => insideKeepout(p.x, p.z, layout));
  const b = bounds('PRESS', press);
  check('셀 안 목표는 경계 밖에서 접근', path.length >= 1 && !through && (path.at(-1).x <= b.x0 || path.at(-1).x >= b.x1 || path.at(-1).z <= b.z0 || path.at(-1).z >= b.z1));
}
{
  const dog = new Hound({ home: PATROL[0] });
  const wall = bot('AMR-01', 0, -11, 12, { mode: 'job', at: { kind: 'free' }, steps: [{ go: [{ x: 8, z: 12 }] }] });
  wall.heading = Math.PI / 2;
  for (let i = 0; i < 40; i++) dog.step(0.1, [wall], null);
  check('앞차에는 서서 양보한다', Math.hypot(dog.x - wall.x, dog.z - wall.z) >= HOUND.radius + 0.62 + HOUND.gap - 0.05, `gap ${Math.hypot(dog.x - wall.x, dog.z - wall.z).toFixed(2)}`);
}
{
  const s = new ViewerState({ scenario: 'supply', quiet: true });
  let clip = 0, maxV = 0, travel = 0;
  const start = { x: s.plant.hound.x, z: s.plant.hound.z };
  for (let i = 0; i < 600; i++) {
    const x0 = s.plant.hound.x, z0 = s.plant.hound.z;
    s.step(0.1);
    const h = s.plant.hound;
    const d = Math.hypot(h.x - x0, h.z - z0);
    travel += d;
    maxV = Math.max(maxV, d / 0.1);
    if (insideKeepout(h.x, h.z, s.layout)) clip++;
  }
  check('시나리오 순찰도 발자국 밖', clip === 0, `clip ${clip}`);
  check('시나리오 속도 ≤ 출동', maxV <= HOUND.sprint + 0.05, `v ${maxV.toFixed(2)}`);
  check('시나리오에서도 제자리가 아니다', travel > 15 && Math.hypot(s.plant.hound.x - start.x, s.plant.hound.z - start.z) > 4, `travel ${travel.toFixed(1)} m`);
}

console.log(`  ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
