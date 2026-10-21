// ViewerState: 배속 분할 스텝, 셀 상태, 로그·이벤트 버퍼.
import { ViewerState } from '../js/sim/state.js';
import { CELLS } from '../js/sim/cells.js';
import { MAX_STEP } from '../js/core/env.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

console.log('state');
const s = new ViewerState();
check('셀 3개 (PRESS/SCREW/SORT)', s.cells.map((c) => c.id).join() === CELLS.map((c) => c.id).join() && s.cells.length === 3);
check('정지 상태에서는 시간 안 흐름', s.advance(1) === 0 && s.time === 0);

s.setRunning(true);
s.setSpeed(30);
const steps = s.advance(0.1);
check('30× · 0.1s → 3.0s', Math.abs(s.time - 3) < 1e-9, `t=${s.time}`);
check(`스텝은 ${MAX_STEP}s 상한으로 분할`, steps === Math.ceil(3 / MAX_STEP - 1e-9), `steps=${steps}`);
check('지원 안 하는 배속 거부', throws(() => s.setSpeed(7)));

s.drainEvents();
s.setCellState('PRESS', 'BUSY');
s.setCellState('PRESS', 'BUSY');
const ev = s.drainEvents();
check('상태 변경 이벤트 1건(중복 무시)', ev.length === 1 && ev[0].type === 'cell:state' && ev[0].from === 'IDLE' && ev[0].to === 'BUSY');
check('drain 후 비어 있음', s.drainEvents().length === 0);
check('없는 셀/상태 거부', throws(() => s.setCellState('A-3-1', 'BUSY')) && throws(() => s.setCellState('SORT', 'RUN')));

s.select('SORT');
check('선택', s.selected === 'SORT');
s.select(null);
check('선택 해제', s.selected === null);

for (let i = 0; i < 400; i++) s.log('info', `l${i}`);
check('로그 링버퍼 160', s.logs.length === 160 && s.logs[0].title === 'l399');

const q = new ViewerState({ quiet: true });
q.setRunning(true); q.setCellState('SCREW', 'DOWN');
check('quiet 모드는 로그·이벤트 없음', q.logs.length === 0 && q.events.length === 0);

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
