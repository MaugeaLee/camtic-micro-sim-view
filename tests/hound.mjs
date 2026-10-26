// 견마: 겹침·맞물림·끼임을 이상으로 보고, 출동해 차체를 밀어 간격을 연다.
import { Amr } from '../js/sim/fleet.js';
import { Hound, HOUND, PATROL, circleGap, eventKey, findAnomalies } from '../js/sim/hound.js';
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
  const a = bot('AMR-01', 0, 0, 0), b = bot('AMR-02', 1, 0.3, 0);
  const hits = findAnomalies([a, b]);
  check('겹친 두 대는 overlap 이상', hits.length === 1 && hits[0].kind === 'overlap' && eventKey(hits[0]) === 'overlap:AMR-01+AMR-02', JSON.stringify(hits));
  check('겹침 간격은 음수', circleGap(a, b) < 0, circleGap(a, b).toFixed(2));
}
{
  const a = bot('AMR-01', 0, 0, 0), b = bot('AMR-02', 1, 8, 0);
  check('떨어진 주차는 이상 아님', findAnomalies([a, b]).length === 0);
}
{
  const a = bot('AMR-01', 0, 0, 0, { steps: [{ until: () => false }], blockT: 20 });
  check('하역 대기(until)는 끼임이 아님', findAnomalies([a]).length === 0);
}
{
  const a = bot('AMR-01', 0, 0, 0, { steps: [{ go: [{ x: 4, z: 0 }] }], blockT: 9, moving: false });
  const b = bot('AMR-02', 1, 4, 0);
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
  for (let i = 0; i < 50; i++) s.step(0.1);
  check('시나리오 안에서도 순찰한다', s.plant.hound.mode === 'patrol' && s.plant.hound.gait > 0);
}

console.log(`  ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
