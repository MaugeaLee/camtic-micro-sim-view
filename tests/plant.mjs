// 공장 이어가기: dump/validate · 결정론 복원 · 레이아웃·공정이 바뀌면 거부.
import { readFile } from 'node:fs/promises';
import { dumpPlant, fingerprint, pickPlant, readLocal, restoreOk, restoreTime, validatePlant, writeLocal, clearLocal, LOCAL_KEY } from '../js/data/plant.js';
import { ViewerState } from '../js/sim/state.js';
import { defaultLayout, layoutStamp } from '../js/sim/layout.js';
import { SPEEDS } from '../js/core/env.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('plant');
const processDoc = JSON.parse(await readFile(new URL('../src/process.default.json', import.meta.url), 'utf8'));
const layout = defaultLayout();
const extra = {
  amr: null, drones: null, inspect: null, process: true,
  layoutFp: fingerprint(layoutStamp(layout)),
  processFp: fingerprint(processDoc),
};

const bad = validatePlant({ v: 2, t: -1, scenario: 'supply', running: 'yes', speed: 2, process: 1 });
check('잘못된 문서 거부', !bad.ok && bad.errors.length >= 4, bad.errors.join(' · '));
check('없음 거부', !validatePlant(null).ok && validatePlant(null).errors[0] === '없음');

const a = new ViewerState({ scenario: 'supply', quiet: true, layout, process: processDoc });
for (let i = 0; i < 200; i++) a.step(0.1);
const dump = dumpPlant(a, extra);
check('dump 검증 통과', validatePlant(dump).ok && dump.t === Number(a.time.toFixed(3)) && dump.scenario === 'supply' && SPEEDS.includes(dump.speed));
check('fingerprint 안정', extra.layoutFp === fingerprint(layoutStamp(layout)) && extra.layoutFp !== extra.processFp);

const b = new ViewerState({ scenario: 'supply', quiet: true, layout, process: processDoc });
const steps = restoreTime(b, dump.t);
check('복원 스텝 수', steps === 200 && Math.abs(b.time - a.time) < 1e-9);
check('복원 결정론(배송·AMR 자리)', b.plant.delivered === a.plant.delivered
  && Math.abs(b.amrs[0].x - a.amrs[0].x) < 1e-9 && Math.abs(b.amrs[0].z - a.amrs[0].z) < 1e-9
  && b.amrs[0].battery === a.amrs[0].battery, `del ${b.plant.delivered}/${a.plant.delivered}`);

const ok = restoreOk(dump, { process: true, layoutFp: extra.layoutFp, processFp: extra.processFp });
check('같은 레이아웃·공정은 복원', ok.ok && ok.doc.t === dump.t);
check('레이아웃이 바뀌면 거부', !restoreOk(dump, { process: true, layoutFp: 'other', processFp: extra.processFp }).ok);
check('공정이 바뀌면 거부', !restoreOk(dump, { process: true, layoutFp: extra.layoutFp, processFp: 'other' }).ok);
check('공정 끔과 안 맞으면 거부', !restoreOk(dump, { process: false, layoutFp: extra.layoutFp }).ok);
check('점검 skip', !restoreOk(dump, { process: true, skip: '점검 warp' }).ok);
check('시나리오 지정 불일치', !restoreOk(dump, { process: true, scenario: 'faults' }).ok);
check('시나리오 지정 일치', restoreOk(dump, { process: true, scenario: 'supply', layoutFp: extra.layoutFp, processFp: extra.processFp }).ok);

const older = { ...dump, t: 1 };
check('더 진행된 쪽을 고름', pickPlant(dump, older).t === dump.t && pickPlant(null, dump).t === dump.t && pickPlant(dump, { v: 9 }).t === dump.t);

const box = new Map();
const store = {
  getItem: (k) => box.get(k) ?? null,
  setItem: (k, v) => box.set(k, v),
  removeItem: (k) => box.delete(k),
};
check('local 기록', writeLocal(store, dump) && store.getItem(LOCAL_KEY));
check('local 읽기', readLocal(store).t === dump.t);
clearLocal(store);
check('local 삭제', readLocal(store) === null);

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
