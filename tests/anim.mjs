// 관절 파형·벤치 대상. three 없이 판정.
import { BENCH, recipeFor, jointWave, travelWave, spinWave, gantryWave } from '../js/assets/anim.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

console.log('anim');
check('PRESS 벤치 대상', BENCH.PRESS.name === 'R8');
check('recipeFor PRESS', recipeFor('PRESS').name === 'R8');
check('recipeFor 덮어쓰기', recipeFor('PRESS', { name: 'R6' }).name === 'R6');
check('recipeFor 빈 값은 기본 유지', recipeFor('PRESS', { name: undefined }).name === 'R8' && recipeFor('PRESS', { name: '' }).name === 'R8');
check('SCREW·SORT 벤치', BENCH.SCREW.name === 'R1' && BENCH.SORT.name === 'Dual_arm_L');
check('없는 에셋 기본', recipeFor('NOPE').name === '');

const q = jointWave(0, 5);
check('관절 수만큼', q.length === 5 && jointWave(1, 9).length === 9);
check('t=0 J1 0', near(q[0], 0));
check('관절마다 위상 다름', !near(q[1], q[2]));
check('진폭 한계', Array.from({ length: 200 }, (_, i) => jointWave(i * 0.1, 6)).every((v) => v.every((x, j) => Math.abs(x) <= [0.35, 0.25, 0.3, 0.3, 0.6, 0.5][j] + 1e-12)));
check('결정론', jointWave(3.3, 5).join() === jointWave(3.3, 5).join());
check('travel 왕복', near(travelWave(0), 0) && travelWave(1) !== travelWave(2));
check('spin 누적', spinWave(2) > spinWave(1));
const gw = gantryWave(0);
check('직교 파형 두 축', near(gw.x, 0) && near(gw.z, travelWave(0, { amp: 0.08, rate: 0.7 * 0.85, phase: 0.9 })));
check('직교 진폭 한계', Array.from({ length: 80 }, (_, i) => gantryWave(i * 0.2)).every((v) => Math.abs(v.x) <= 0.28 + 1e-12 && Math.abs(v.z) <= 0.08 + 1e-12));

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
