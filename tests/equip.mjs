// 셀 안 장비 id(sim/equip.js): 로봇·직교이송·리프트·몸통을 AMR처럼 고를 수 있다.
import { readFile } from 'node:fs/promises';
import { ViewerState } from '../js/sim/state.js';
import { findEquip, listEquip, parseEquipId } from '../js/sim/equip.js';
import { equipmentIds, equipmentStatus } from '../js/data/monitor.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const sig = (d, id) => d.signals.find((s) => s.id === id);

const doc = JSON.parse(await readFile(new URL('../src/process.default.json', import.meta.url), 'utf8'));

console.log('equip');
{
  check('PRESS:R6 파싱', parseEquipId('PRESS:R6')?.cell === 'PRESS' && parseEquipId('PRESS:R6')?.name === 'R6');
  check('셀 id·빈 값 거부', parseEquipId('PRESS') === null && parseEquipId('') === null && parseEquipId(':R6') === null);
}

{
  const s = new ViewerState({ quiet: true, scenario: 'supply', process: doc });
  const ids = listEquip(s).map((e) => e.id);
  check('PRESS 로봇 R6–R10', ['R6', 'R7', 'R8', 'R9', 'R10'].every((n) => ids.includes(`PRESS:${n}`)), ids.filter((x) => x.startsWith('PRESS:R')).join(','));
  check('SCREW 로봇·라인·리프트', ['SCREW:R1', 'SCREW:L01', 'SCREW:LIFT'].every((id) => ids.includes(id)));
  check('SORT 양팔·몸통', ['SORT:Dual_arm_L', 'SORT:Dual_arm_R', 'SORT:Dual_arm_robot'].every((id) => ids.includes(id)));
  check('OUT 은 셀 장비가 아님', !ids.some((id) => id.startsWith('OUT:')));
  check('state.equip = listEquip', s.equip.length === ids.length && s.equipOf('PRESS:R6')?.kind === 'arm');
  check('없는 장비 follow 거부', throws(() => s.follow('PRESS:NOPE')));
  s.follow('PRESS:R6');
  check('셀 장비 follow · 셀 선택 해제', s.followed === 'PRESS:R6' && s.selected === null);
  s.select('SORT');
  check('셀 선택하면 follow 해제', s.selected === 'SORT' && s.followed === null);
}

{
  const s = new ViewerState({ quiet: true, scenario: 'supply', process: doc });
  const all = equipmentIds(s);
  check('장비 목록에 셀 장비 포함', all.includes('PRESS:R6') && all.includes('PRESS:LIFT') && all.includes('SORT:Dual_arm_L'));
  const first = Object.fromEntries(all.filter((id) => id.includes(':')).map((id) => [id, equipmentStatus(s, id).signals.map((x) => x.id).join(',')]));
  const seen = { armBusy: 0, liftBusy: 0, shape: [] };
  for (let t = 0; t < 900; t += 0.1) {
    s.step(0.1);
    if (Math.round(t * 10) % 20) continue;
    for (const id of Object.keys(first)) {
      const d = equipmentStatus(s, id);
      if (d.signals.map((x) => x.id).join(',') !== first[id]) seen.shape.push(`${id}@${t.toFixed(0)}`);
    }
    const r6 = equipmentStatus(s, 'PRESS:R6');
    if (r6.kind !== 'arm' || r6.cell !== 'PRESS' || !sig(r6, 'CELL') || sig(r6, 'CELL').value !== 'PRESS') seen.shape.push('R6 머리');
    if (sig(r6, 'BUSY').value) seen.armBusy++;
    const lf = equipmentStatus(s, 'PRESS:LIFT');
    if (sig(lf, 'BUSY').value) seen.liftBusy++;
  }
  check('셀 장비 신호 목록 시간 불변', !seen.shape.length, seen.shape.slice(0, 3).join(' · '));
  check('로봇·리프트 BUSY 가 실제로 나타남', seen.armBusy > 0 && seen.liftBusy > 0, JSON.stringify(seen));
  const r6 = equipmentStatus(s, 'PRESS:R6');
  check('로봇 문서 관절 5 · TCP 필드', ['J1', 'J2', 'J3', 'J4', 'J5', 'TCP.X', 'RAIL'].every((id) => sig(r6, id)), r6.signals.map((x) => x.id).join(','));
}

{
  const s = new ViewerState({ quiet: true, scenario: 'faults', process: doc });
  for (let t = 0; t < 120; t += 0.1) s.step(0.1);
  const d = equipmentStatus(s, 'PRESS:R6');
  check('셀 고장이면 안 장비 FAULT', d.state === 'DOWN' && sig(d, 'FAULT').value === true && d.fault, `${d.state}`);
}

{
  const s = new ViewerState({ quiet: true, scenario: 'supply' });
  check('공정 정의 없으면 셀 장비 목록 비움', listEquip(s).length === 0 && findEquip(s, 'PRESS:R6') === null);
  const n = new ViewerState({ quiet: true });
  check('시나리오 없으면 셀 장비 없음', n.equip.length === 0 && equipmentStatus(n, 'PRESS:R6') === null);
}

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
