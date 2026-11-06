// 운영 오퍼레이터: 물리 셀이 아니다. 셀이 일하는 동안 반출·다음 투입을 병렬로 낸다.
import { readFile } from 'node:fs/promises';
import { ViewerState } from '../js/sim/state.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('ops');
const doc = JSON.parse(await readFile(new URL('../src/process.default.json', import.meta.url), 'utf8'));
const s = new ViewerState({ scenario: 'supply', quiet: true, process: doc });
const P = s.plant;
check('오퍼레이터는 셀이 아니다', P.ops && !P.work.OPS && !P.units.OPS);
check('시작 때는 반출을 걸지 않는다', P.ops.due('SCREW') === false && P.ops.due('PRESS') === false);

const cw = P.work.SCREW;
cw.lift.kit = { id: 'k' };
cw.lift.phase = 'work';
cw.lift.pass = 0;
cw.lift.el = 0;
cw.ticket = { kit: cw.lift.kit };
check('실은 차가 아직 셀에 있으면 픽업을 보내지 않는다', P.ops.due('SCREW') === false);
cw.ticket = null;
check('실은 차가 빠진 뒤 작업 중이면 픽업을 보낸다', P.ops.due('SCREW') === true);
check('지그를 든 리프트에는 실은 차를 들이지 않는다', P.ops.blockEntry('SCREW', { load: { id: 1 } }) === true);
check('빈 차(반출)는 들어간다', P.ops.blockEntry('SCREW', { load: null }) === false);
const pocket = P.acs.sidePocket('SCREW');
const entry = P.acs.cells.SCREW.entry;
const homesX = P.acs.homes.reduce((n, h) => n + h.x, 0) / P.acs.homes.length;
check('대기 자리는 입구 지선이 아니라 충전 자리 반대편 통로다', pocket && Math.abs(pocket.z - entry.z) > 8
  && Math.sign(pocket.x - entry.x) !== Math.sign(homesX - entry.x), JSON.stringify({ pocket, entry, homesX }));

cw.lift.phase = 'empty';
cw.lift.kit = null;
check('리프트가 비면 반출을 걸지 않는다', P.ops.due('SCREW') === false);
check('빈 리프트는 실은 차도 막지 않는다', P.ops.blockEntry('SCREW', { load: { id: 1 } }) === false);

const run = new ViewerState({ scenario: 'supply', quiet: true, process: doc });
let bothMove = 0, pocketWait = 0;
for (let i = 0; i < 18000; i++) {
  run.step(0.1);
  const amrs = run.plant.acs.amrs;
  for (const id of ['SCREW', 'PRESS']) {
    const hop = amrs.some((a) => !a.load && a.mission?.hop && a.mission.from === id && (a.moving || a.waitFor === id || a.inBranch === id));
    const inbound = amrs.some((a) => a.load?.dest === id && (a.moving || a.waitFor === id || a.inBranch === id));
    if (hop && inbound) bothMove++;
  }
  if (amrs.some((a) => String(a.task).includes('작업 끝날 때까지'))) pocketWait++;
}
const Q = run.plant;
const both = Q.work.PRESS.done > 0 && Q.work.SCREW.done > 0 && Q.outbound > 0;
check('30분 동안 두 셀이 같이 끝나고 적재까지 간다', both, `PRESS ${Q.work.PRESS.done} SCREW ${Q.work.SCREW.done} OUT ${Q.outbound}`);
check('픽업은 투입 차가 빠진 뒤에만 나간다', Q.ops.pulls > 5 && Q.ops.pushes === 0, JSON.stringify(Q.ops.view()));
check('실은 차와 픽업 차가 같은 셀로 동시에 움직이지 않는다', bothMove === 0, `겹친 스텝 ${bothMove}`);
check('통로에서 작업 끝날 때까지 기다리는 차가 없다', pocketWait === 0, `대기 스텝 ${pocketWait}`);

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
