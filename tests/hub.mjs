// DataHub: 시뮬 시간 기준 주기 스냅샷.
import { ViewerState } from '../js/sim/state.js';
import { DataHub, snapshot } from '../js/data/hub.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('hub');
const s = new ViewerState({ quiet: true });
const hub = new DataHub({ period: 10 });

check('첫 틱은 즉시 스냅샷', hub.tick(s) !== null);
check('주기 전에는 없음', hub.tick(s) === null);

s.setRunning(true); s.setSpeed(10);
for (let i = 0; i < 10; i++) s.advance(0.1);
const snap = hub.tick(s);
check('10s 뒤 다음 스냅샷', snap !== null && Math.abs(snap.t - 10) < 1e-6, `t=${snap?.t}`);

s.setCellState('SORT', 'DOWN');
const one = snapshot(s);
check('스냅샷은 JSON 직렬화 가능', JSON.parse(JSON.stringify(one)).cells.find((c) => c.id === 'SORT').state === 'DOWN');
check('스냅샷에 라벨·로그 없음', !('logs' in one) && !('label' in one.cells[0]));

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
