// 레이아웃: 스냅·바닥 안·겹침. 기본 자리가 통과하는지.
import { CELLS } from '../js/sim/cells.js';
import { FIELD } from '../js/render/field-def.js';
import {
  DEFAULT_POSES, FIELD_SIZE, LAYOUT_VERSION, SNAP, canPlace, defaultLayout, moveCell,
  normalizeLayout, poseOf, snapCoord, snapRot, validateLayout,
} from '../js/sim/layout.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('layout');
const ids = CELLS.map((c) => c.id).join();
check('셀 3개 자리', Object.keys(DEFAULT_POSES).sort().join() === 'PRESS,SCREW,SORT' && ids === 'PRESS,SCREW,SORT');
check('필드 크기 = field-def', FIELD_SIZE.w === FIELD.size.w && FIELD_SIZE.d === FIELD.size.d);

const base = defaultLayout();
check('기본 레이아웃 통과', validateLayout(base).length === 0, validateLayout(base).join(' · '));
check('버전·스냅', base.version === LAYOUT_VERSION && base.snap === SNAP);
check('스냅 반올림', snapCoord(1.4) === 1 && snapCoord(1.6) === 2);
check('회전 스냅', snapRot(40) === 0 && snapRot(50) === 90 && snapRot(-10) === 0 && snapRot(270) === 270);

check('음수 스냅 거부', validateLayout({ ...base, snap: 0 }).length > 0);
check('셀 빠지면 거부', validateLayout({ ...base, cells: { PRESS: base.cells.PRESS, SCREW: base.cells.SCREW } }).length > 0);
check('바닥 밖 거부', validateLayout({ ...base, cells: { ...base.cells, PRESS: poseOf(-40, 0) } }).length > 0);

const clash = moveCell(base, 'PRESS', poseOf(0, -2));
check('겹치면 거부', clash.ok === false && clash.errors.some((e) => e.includes('겹침')));

const ok = moveCell(base, 'PRESS', poseOf(-14, 6));
check('빈 칸 이동', ok.ok === true && ok.doc.cells.PRESS.z === 6 && validateLayout(ok.doc).length === 0);

const rot = poseOf(-14, -2, 90);
check('90°는 발자국 교환 후에도 기본 자리 안', canPlace({ ...base, cells: { ...base.cells, PRESS: rot } }, 'PRESS', rot).length === 0);
check('모르는 셀 거부', canPlace(base, 'A-3-1', poseOf(0, 0)).length > 0);

const n = normalizeLayout({ version: 1, snap: 1, cells: { PRESS: { x: -13.6, z: -1.8, rotY: 10 }, SCREW: base.cells.SCREW, SORT: base.cells.SORT } });
check('정규화 스냅', n.cells.PRESS.x === -14 && n.cells.PRESS.z === -2 && n.cells.PRESS.rotY === 0);

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
