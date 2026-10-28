// 머리 위 라벨 문구·색(render/label-text.js). three·DOM 없음.
import { readFile } from 'node:fs/promises';
import { ViewerState } from '../js/sim/state.js';
import { amrTag, clip, equipTag, robotTag, siteTag, TAG_COLOR } from '../js/render/label-text.js';
import { labelEquip } from '../js/sim/equip.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('labels');
check('clip 짧으면 그대로', clip('대기', 22) === '대기');
check('clip 길면 자름', clip('키트 #12 실은 채 대기(받을 셀 없음)', 12).endsWith('…') && clip('키트 #12 실은 채 대기(받을 셀 없음)', 12).length === 12);

{
  const idle = amrTag({ id: 'AMR-01', task: '대기', battery: 80, moving: false, charging: false, load: null, halt: null, off: false });
  check('AMR 대기 = 노란 대기색', idle.title === 'AMR-01' && idle.sub === '대기' && idle.color === TAG_COLOR.wait);
  const move = amrTag({ id: 'AMR-02', task: 'SORT 로 이송', battery: 70, moving: true, charging: false, load: { id: 3 }, halt: null, off: false });
  check('AMR 이동 = 파랑 + 적재 번호', move.color === TAG_COLOR.move && move.sub.includes('#3') && move.sub.includes('SORT'));
  const chg = amrTag({ id: 'AMR-03', task: '대기', battery: 40, moving: false, charging: true, load: null, halt: null, off: false });
  check('AMR 충전 = 초록', chg.color === TAG_COLOR.charge);
  const low = amrTag({ id: 'AMR-04', task: '충전 복귀', battery: 20, moving: true, charging: false, load: null, halt: null, off: false });
  check('AMR 저배터리 = 빨강', low.color === TAG_COLOR.down);
  const halt = amrTag({ id: 'AMR-05', task: '이송', battery: 90, moving: false, charging: false, load: null, halt: { why: '구동 모터 이상(가정)' }, off: false });
  check('AMR 고장 정지 = 빨강 · 사유', halt.color === TAG_COLOR.down && halt.sub.includes('구동'));
  const off = amrTag({ id: 'AMR-06', task: '대기', battery: 50, off: true });
  check('AMR 운휴', off.sub === '운휴' && off.color === TAG_COLOR.idle);
  check('없는 AMR 거부', amrTag(null) === null);
}

{
  const fly = robotTag({ id: 'DRONE-01', task: '검사 이동 → PRESS', battery: 88, mode: 'fly', scanning: null });
  check('드론 비행 = 파랑', fly.title === 'DRONE-01' && fly.color === TAG_COLOR.move && fly.sub.includes('PRESS') && fly.sub.includes('88%'));
  const scan = robotTag({ id: 'DRONE-01', task: '비전 검사 · PRESS #2', battery: 80, mode: 'work', scanning: 'inspect' });
  check('드론 검사 = 초록', scan.color === TAG_COLOR.busy);
  const pad = robotTag({ id: 'DRONE-02', task: '대기 (패드 · 100%)', battery: 100, mode: 'idle', scanning: null });
  check('드론 패드 = 충전색', pad.color === TAG_COLOR.charge);
  const fault = robotTag({ id: 'DRONE-03', task: '현장 중계 · SCREW', battery: 60, mode: 'work', job: { kind: 'fault' }, scanning: null });
  check('드론 고장 중계 = 빨강', fault.color === TAG_COLOR.down);
  const hound = robotTag({ id: 'HOUND-01', task: '순찰', mode: 'patrol' });
  check('견마 순찰 = 파랑 · 배터리 없음', hound.title === 'HOUND-01' && hound.sub === '순찰' && hound.color === TAG_COLOR.move);
  const nudge = robotTag({ id: 'HOUND-01', task: '접촉 리커버리', mode: 'nudge' });
  check('견마 밀기 = 빨강', nudge.color === TAG_COLOR.down);
}

{
  check('자리 OUT', siteTag('OUT')?.sub === '완료품 적재' && siteTag('OUT').color === TAG_COLOR.idle);
  check('자리 PARTS', siteTag('PARTS')?.title === 'PARTS');
  check('자리 STORE', siteTag('STORE')?.sub === '원재료 창고');
  check('셀 id 는 자리 아님', siteTag('PRESS') === null);
}

{
  const doc = JSON.parse(await readFile(new URL('../src/process.default.json', import.meta.url), 'utf8'));
  const s = new ViewerState({ quiet: true, scenario: 'supply', process: doc });
  const r6 = s.equipOf('PRESS:R6');
  const idle = equipTag(r6, { cellState: 'IDLE', work: s.plant.work.PRESS });
  check('PRESS:R6 대기', idle.title === 'PRESS:R6' && idle.sub === '대기' && idle.color === TAG_COLOR.idle);
  const busy = equipTag(r6, { cellState: 'BUSY', work: { robots: { R6: { name: 'R6', op: {}, label: '압입' } } } });
  check('PRESS:R6 작업 중', busy.color === TAG_COLOR.busy && busy.sub === '압입');
  s.setCellState('PRESS', 'DOWN');
  const down = equipTag(s.equipOf('PRESS:R6'), { cellState: 'DOWN', work: s.plant.work.PRESS });
  check('셀 DOWN 이면 장비 라벨 빨강', down.color === TAG_COLOR.down);
  const lift = equipTag({ id: 'PRESS:LIFT', cell: 'PRESS', name: 'LIFT', kind: 'lift' }, { cellState: 'BUSY', work: { lift: { phase: 'rise' } } });
  check('리프트 올림', lift.sub === '올림' && lift.color === TAG_COLOR.busy);
  const body = equipTag(s.equipOf('SORT:Dual_arm_robot'), { cellState: 'IDLE', work: s.plant.work.SORT });
  check('SORT 양팔 라벨은 몸통', body.title === 'SORT:Dual_arm' && body.sub === '대기');
  const vis = labelEquip(s.equip).map((e) => e.id);
  check('SORT L/R 팔은 머리 위·목록에 안 그림', vis.includes('SORT:Dual_arm_robot') && !vis.includes('SORT:Dual_arm_L') && !vis.includes('SORT:Dual_arm_R'));
}

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
