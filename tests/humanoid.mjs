// 창고 휴머노이드: PARTS·STORE 선반 → AMR 적재. 자리 로컬, GLB 없음.
import { readFile } from 'node:fs/promises';
import { Parts } from '../js/sim/parts.js';
import { HumanoidWork, humanoidDef } from '../js/sim/humanoid.js';
import { FOOTPRINT } from '../js/sim/layout.js';
import { ViewerState } from '../js/sim/state.js';
import { validateProcess } from '../js/sim/process.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('humanoid');
const doc = JSON.parse(await readFile(new URL('../src/process.default.json', import.meta.url), 'utf8'));
const spec = humanoidDef(doc.supply.humanoid, { time: doc.supply.load });
check('기본 보행 구역은 PARTS 발자국 안',
  Math.abs(spec.base.x) <= FOOTPRINT.PARTS.w / 2 && spec.zone.x[1] - spec.zone.x[0] < FOOTPRINT.PARTS.w
  && spec.zone.z[1] <= FOOTPRINT.PARTS.d / 2 && spec.zone.z[0] >= -FOOTPRINT.PARTS.d / 2,
  `x ${spec.zone.x.join('..')} z ${spec.zone.z.join('..')}`);
check('STORE 휴머노이드 정의', !!doc.cells.SORT.inbound.store.humanoid?.zone);

{
  const w = new HumanoidWork('STORE', spec, new Parts());
  const pts = [
    ...doc.cells.SORT.inbound.store.slots.map((s) => [s.x, s.y, s.z]),
    [doc.cells.SORT.inbound.store.receive.x, doc.cells.SORT.inbound.store.receive.y, doc.cells.SORT.inbound.store.receive.z],
    ...doc.supply.bins.map((s) => [s.x, s.y, s.z]),
    [0, 1.11, 1.3],
  ];
  let out = 0;
  for (const p of pts) {
    const s = w.stance(p);
    if (s.x < spec.zone.x[0] - 1e-9 || s.x > spec.zone.x[1] + 1e-9 || s.z < spec.zone.z[0] - 1e-9 || s.z > spec.zone.z[1] + 1e-9) out++;
  }
  check('선반·팔레트·도크 스탠스는 구역 안', out === 0, `밖 ${out}/${pts.length}`);
}

{
  const parts = new Parts();
  const w = new HumanoidWork('STORE', spec, parts);
  const e = parts.add('kit', { k: 'drop', cell: 'STORE', at: [0, 0.12, -0.45] }, { size: [1.2, 0.16, 0.6], h: 0.21 });
  const T = w.offer([{ e, from: [0, 0.12, -0.45], to: { k: 'amr', id: 'P-AMR-01' }, toAt: [-1.5, 1.11, 1.3], time: 5 }]);
  check('offer 티켓', !!T && !T.released);
  let saw = { human: 0, amr: 0, walk: 0 };
  let prev = { ...w.car };
  for (let i = 0; i < 80; i++) {
    w.step(0.1);
    if (e.holder.k === 'human') saw.human++;
    if (e.holder.k === 'amr') saw.amr++;
    if (Math.hypot(w.car.x - prev.x, w.car.z - prev.z) > 1e-4) saw.walk++;
    prev = { ...w.car };
  }
  check('키트는 휴머노이드를 거쳐 AMR 로 · 걷고 · 위반 0',
    saw.human > 0 && saw.amr > 0 && saw.walk > 0 && e.holder.k === 'amr' && T.released && parts.violationCount === 0,
    `human ${saw.human} amr ${saw.amr} walk ${saw.walk} viol ${parts.violationCount}`);
}

{
  const parts = new Parts();
  const w = new HumanoidWork('PARTS', spec, parts);
  const e = parts.add('tote', { k: 'drop', cell: 'PARTS', at: [0, 0.91, -0.55] }, { size: [0.5, 0.25, 0.4], h: 0.25 });
  w.offer([{ e, from: [0, 0.91, -0.55], to: { k: 'amr', id: 'P-AMR-02' }, toAt: [0, 1.11, 1.3], time: 6 }]);
  for (let i = 0; i < 80; i++) w.step(0.1);
  check('토트도 AMR 로', e.holder.k === 'amr' && w.ticket.released && parts.violationCount === 0);
}

{
  const s = new ViewerState({ scenario: 'supply', quiet: true, process: doc });
  check('공장에 STORE·PARTS 휴머노이드',
    !!s.plant.store?.arm && !!s.plant.supply?.depot && s.plant.siteWork('STORE') === s.plant.store.arm
    && s.plant.siteWork('PARTS') === s.plant.supply.depot);
  let storeH = 0, partsH = 0;
  for (let i = 0; i < 4000; i++) {
    s.step(0.1);
    for (const e of s.plant.parts.list()) {
      if (e.holder.k === 'human' && e.holder.cell === 'STORE') storeH++;
      if (e.holder.k === 'human' && e.holder.cell === 'PARTS') partsH++;
    }
    if (storeH && partsH) break;
  }
  check('공장에서 휴머노이드가 도어트림·토트를 듦', storeH > 0 && partsH > 0, `STORE ${storeH} PARTS ${partsH}`);
  check('소유 위반 0', s.plant.parts.violationCount === 0 && s.plant.parts.audit().length === 0);
}

{
  const bad = JSON.parse(JSON.stringify(doc));
  bad.supply.humanoid.grip = 0;
  check('supply humanoid.grip 0 은 오류', validateProcess(bad).some((e) => e.includes('supply humanoid.grip')));
  const b2 = JSON.parse(JSON.stringify(doc));
  b2.cells.SORT.inbound.store.humanoid.zone = { x: [1, 0], z: [0, 1] };
  check('store humanoid.zone.x lo≥hi 는 오류', validateProcess(b2).some((e) => e.includes('inbound.store humanoid.zone.x')));
}

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
