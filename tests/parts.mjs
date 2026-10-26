// 부품·키트 엔티티 등록부: 소유자 하나 · 옮김 점검 · 자리 중복 · 키트와 같이 지워짐.
import { holderKey, Parts } from '../js/sim/parts.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('parts');
const P = new Parts();
const kit = P.add('kit', { k: 'rack', cell: 'SORT', i: 0 });
check('추가: id·소유자', kit.id === 1 && holderKey(kit.holder) === 'rack:SORT:0');
check('옮김: 예상 소유자 맞으면 위반 없음', P.hold(kit, { k: 'amr', id: 'AMR-01' }, { k: 'rack', cell: 'SORT', i: 0 }) && P.violationCount === 0);
P.hold(kit, { k: 'station', cell: 'PRESS', st: 'S1' }, { k: 'rack', cell: 'SORT', i: 0 });
check('옮김: 예상 소유자 다르면 위반 1', P.violationCount === 1 && /소유자 불일치/.test(P.violations[0].why));
const k2 = P.add('kit', { k: 'station', cell: 'PRESS', st: 'S1' });
check('같은 자리 둘 → 위반 · audit 에 걸림', P.violationCount === 2 && P.audit().length === 1, P.audit().join(' '));
P.hold(k2, { k: 'station', cell: 'PRESS', st: 'S2' }, k2.holder);
check('비우면 audit 정상', P.audit().length === 0);
const a = P.add('P_HDL', { k: 'kit', kit: kit.id, at: [-0.1, 0] });
const b = P.add('PW_SW', { k: 'kit', kit: kit.id, at: [0.1, 0] });
P.add('Fastener', { k: 'line', cell: 'PRESS', line: 'L02', s: 0 });
P.add('Fastener', { k: 'line', cell: 'PRESS', line: 'L02', s: 0.4 });
check('줄 위 여럿·키트 위 다른 자리는 중복 아님', P.audit().length === 0 && P.kitParts(kit).length === 2);
P.remove(kit);
check('키트 지우면 위 부품도 같이', !P.get(kit.id) && !P.get(a.id) && !P.get(b.id) && P.items.size === 3);
check('없는 엔티티 옮김은 위반', !P.hold(a, { k: 'robot', cell: 'PRESS', r: 'R6' }) && P.violationCount === 3);
const lone = P.add('x', { k: 'kit', kit: 999, at: [0, 0] });
check('없는 키트 위 부품은 audit 에 걸림', P.audit().some((s) => s.includes(`#${lone.id}`)));

console.log(`  ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
