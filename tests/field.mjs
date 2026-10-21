// 필드 정의: 치수 검증 · 통로가 바닥 안 · 기둥 간격.
import { FIELD, validateField, columnXs } from '../js/render/field-def.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const with_ = (patch) => ({ ...FIELD, ...patch });

console.log('field');
const errs = validateField(FIELD);
check('기본 필드 정의 통과', errs.length === 0, errs.join(' · '));
check('가정 표시', FIELD.assumed === true);
check('앞면은 열려 있음(카메라 쪽)', !FIELD.wall.sides.includes('front'));

check('음수 크기 거부', validateField(with_({ size: { w: -1, d: 30 } })).length > 0);
check('모르는 벽 면 거부', validateField(with_({ wall: { ...FIELD.wall, sides: ['north'] } })).length > 0);
check('벽보다 높은 띠 거부', validateField(with_({ band: { ...FIELD.band, y: FIELD.wall.h } })).length > 0);
check('바닥 밖 통로 거부', validateField(with_({ lanes: [{ x: FIELD.size.w / 2, z: 0, w: 4, d: 2 }] })).length > 0);
check('정의가 없으면 거부', validateField(null).length > 0);

const xs = columnXs(FIELD), p = FIELD.column.pitch, half = FIELD.size.w / 2;
check('기둥 간격 = pitch', xs.every((x, i) => i === 0 || Math.abs(x - xs[i - 1] - p) < 1e-9), xs.join(','));
check('기둥 좌우 대칭', Math.abs(xs[0] + xs[xs.length - 1]) < 1e-9);
check('끝 기둥이 옆벽에서 pitch/2 이상', half - Math.max(...xs.map(Math.abs)) >= p / 2 - 1e-9);
check('폭이 pitch보다 좁으면 가운데 1개', columnXs(with_({ size: { w: 5, d: 10 } })).join() === '0');

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
