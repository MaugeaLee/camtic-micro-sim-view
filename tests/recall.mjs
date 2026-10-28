// 이동체 위치 초기화: AMR 은 충전 자리, 견마는 순찰 출발, 드론은 이착륙장. 미션·잠금은 거둠.
import { readFile } from 'node:fs/promises';
import { ViewerState } from '../js/sim/state.js';
import { defaultLayout } from '../js/sim/layout.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('recall');
const doc = JSON.parse(await readFile(new URL('../src/process.default.json', import.meta.url), 'utf8'));
const s = new ViewerState({ scenario: 'supply', quiet: true, process: doc });
const homes = defaultLayout().amr.homes;

check('셀·없는 id 는 false', s.recall('PRESS') === false && s.recall('NOPE') === false && s.recall('PRESS:R6') === false);

{
  let a = null;
  for (let i = 0; i < 8000 && !a; i++) {
    s.step(0.1);
    a = s.amrs.find((x) => x.id.startsWith('AMR-') && !x.off && x.inBranch)
      ?? s.amrs.find((x) => x.id.startsWith('AMR-') && !x.off && (x.at?.kind !== 'home' || x.mission));
  }
  check('도어트림 AMR 이 충전 자리를 떠남', !!a, a ? `${a.id} ${a.task} @${a.at?.kind}` : '없음');
  if (a) {
    const id = a.id, home = homes[a.idx], held = a.inBranch, zone = s.acs.zones.some((Z) => Z.holder === a);
    const ok = s.recall(id);
    check('AMR 위치 초기화', ok && a.mode === 'park' && a.at?.kind === 'home' && !a.mission && !a.load && !a.ticket
      && !a.inBranch && !a.waitFor && Math.hypot(a.x - home.x, a.z - home.z) < 1e-9
      && Object.values(s.acs.locks).every((L) => !L.inside.has(a) && !L.line.includes(a) && !L.stops.includes(a))
      && s.acs.zones.every((Z) => Z.holder !== a),
      `${a.id} ${a.mode} ${a.at?.kind} lockWas ${held} zoneWas ${zone}`);
  }
}

{
  const p = s.amrs.find((x) => x.id.startsWith('P-AMR-') && !x.off);
  const j = s.amrs.find((x) => x.id.startsWith('F-AMR-') && !x.off);
  const ph = s.plant.supply.acs.homes[p.idx], jh = s.plant.jacks.homes[j.idx];
  for (let i = 0; i < 4000; i++) s.step(0.1);
  check('부품 AMR 초기화 → 창고 줄 충전 자리', s.recall(p.id) && Math.hypot(p.x - ph.x, p.z - ph.z) < 1e-9 && p.mode === 'park');
  check('지개차 AMR 초기화 → 충전 자리', s.recall(j.id) && Math.hypot(j.x - jh.x, j.z - jh.z) < 1e-9 && j.mode === 'park');
}

{
  const h = s.plant.hound, home = h.home;
  h.x = home.x + 8; h.z = home.z - 3; h.mode = 'sprint'; h.job = { kind: 'stuck' };
  check('견마 초기화 → 순찰 출발', s.recall(h.id) && Math.hypot(h.x - home.x, h.z - home.z) < 1e-9 && !h.job && h.mode === 'patrol');
  const d = s.plant.drones.drones[0], pad = d.pad, stats = d.stats.inspected;
  d.x = pad.x - 10; d.z = pad.z - 4; d.y = 5; d.mode = 'fly'; d.job = { kind: 'inspect' };
  check('드론 초기화 → 이착륙장 · 누적 유지', s.recall(d.id) && Math.hypot(d.x - pad.x, d.z - pad.z) < 1e-9 && d.y === 0 && d.mode === 'idle' && !d.job && d.stats.inspected === stats);
  const ins = s.plant.inspector;
  if (ins) {
    const ih = ins.home;
    ins.x = ih.x - 6; ins.mode = 'scan';
    check('점검 견마 초기화 → 충전 자리', s.recall(ins.id) && Math.hypot(ins.x - ih.x, ins.z - ih.z) < 1e-9);
  }
}

{
  const before = s.plant.delivered;
  for (let i = 0; i < 3000; i++) s.step(0.1);
  check('초기화 뒤에도 배송이 이어진다', s.plant.delivered > before && s.plant.parts.violationCount === 0, `delivered ${before}→${s.plant.delivered} viol ${s.plant.parts.violationCount}`);
}

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
