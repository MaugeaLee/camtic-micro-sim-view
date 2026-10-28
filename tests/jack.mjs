// 지개차 AMR: STORE → SORT:RAW 원재료(도어트림+지그). 부품 AMR 과 도크를 나누고 남쪽 통로는 같이 쓴다.
import { readFile } from 'node:fs/promises';
import { JACK } from '../js/sim/amrdata.js';
import { defaultLayout, jackLayout, partsLayout } from '../js/sim/layout.js';
import { mapOf, routeGeo } from '../js/sim/acs.js';
import { ViewerState } from '../js/sim/state.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('jack');
const doc = JSON.parse(await readFile(new URL('../src/process.default.json', import.meta.url), 'utf8'));
const L = defaultLayout();
const jmap = mapOf(routeGeo(jackLayout(L)));
const pmap = mapOf(routeGeo(partsLayout(L)));
check('지개차 지도: STORE·SORT:RAW 만 · 부품 지도에는 그 도크 없음',
  ['STORE', 'SORT:RAW'].every((id) => jmap.cells.some((c) => c.id === id && !c.bad))
  && jmap.cells.length === 2 && jmap.homes.length === 2
  && !pmap.cells.some((c) => c.id === 'STORE' || c.id === 'SORT:RAW'));

const s = new ViewerState({ scenario: 'supply', quiet: true, process: doc });
const P = s.plant;
check('입고 ACS = 지개차 · 적재면 = 포크 윗면', P.inCarrier === P.jacks && P.jacks.amrs.length === 2
  && P.jacks.amrs.every((a) => a.id.startsWith('F-AMR-') && a.deck === JACK.deck));
check('부품 ACS 는 STORE·SORT:RAW 잠금 없음 · 지개차와 peers',
  !P.supply.acs.cells.STORE && !P.supply.acs.cells['SORT:RAW']
  && P.supply.acs.peers.includes(P.jacks) && P.jacks.peers.includes(P.supply.acs)
  && P.supply.acs.peers.includes(P.acs));

const dock = P.jacks.cells.STORE.stops.at(-1);
let pick = null, raw = null;
for (let i = 0; i < 8000 && (!pick || !raw); i++) {
  s.step(0.1);
  const a = P.jacks.amrs.find((x) => x.mission?.raw && x.ticket && !x.ticket.released && !x.load);
  if (a && !pick) pick = { id: a.id, x: a.x, z: a.z };
  const u = P.work.SORT.ticket;
  const b = P.jacks.amrs.find((x) => u && u.kind === 'unload' && x.ticket === u && u.started);
  if (b && !raw) raw = { id: b.id, deck: u.deck };
}
check('지개차가 STORE 도크에서 싣는다', !!pick && Math.hypot(pick.x - dock.x, pick.z - dock.z) < 0.15,
  pick ? `${pick.id} ${pick.x.toFixed(2)},${pick.z.toFixed(2)}` : '없음');
check('SORT 양팔 입고 집은 높이는 지개차 적재면', !!raw && raw.deck === JACK.deck && raw.id.startsWith('F-AMR'),
  raw ? `${raw.id} deck ${raw.deck}` : '없음');
check('부품 AMR 은 원재료 미션을 안 맡는다', !P.supply.acs.amrs.some((a) => a.mission?.raw));

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
