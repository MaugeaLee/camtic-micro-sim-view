// 공정 추적(data/trace.js): 다음 입고 키트를 SORT→SCREW→PRESS→SCREW→OUT 끝까지 따라가며 리포트.
import { readFile } from 'node:fs/promises';
import { ViewerState } from '../js/sim/state.js';
import { ProcessTrace, TRACE_SCHEMA, expectedPath, headlineOf, inboundHold, pastStart, waitWhy } from '../js/data/trace.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

const doc = JSON.parse(await readFile(new URL('../src/process.default.json', import.meta.url), 'utf8'));
const plant = () => new ViewerState({ quiet: true, scenario: 'supply', process: doc, drones: 0, inspect: false });

console.log('trace');

check('공정 순서 → 방문 키 SORT · SCREW/0 · PRESS/0 · SCREW/1 · OUT',
  expectedPath(['SORT', 'SCREW', 'PRESS', 'SCREW', 'OUT']).join() === 'SORT,SCREW/0,PRESS/0,SCREW/1,OUT');
check('배너: 대기', headlineOf(null, 'wait')?.title === '공정 추적' && headlineOf(null, 'wait')?.detail === '다음 입고 대기');
check('배너: 대기 사유 = Cell 공정 지연', headlineOf(null, 'wait', 'SCREW 공정 지연으로 인한 대기')?.detail === 'SCREW 공정 지연으로 인한 대기');
check('배너: SCREW 1차 = 이름 + 한 줄', headlineOf({ key: 'SCREW/0', label: 'SCREW 1차 체결' }, 'run')?.title === 'SCREW 1차 체결'
  && headlineOf({ key: 'SCREW/0', label: 'SCREW 1차 체결' }, 'run')?.detail === '벨트라인·스피커 그릴');
check('배너: 리프트 올림은 이름/내용 분리', headlineOf({ key: 'PRESS/0', label: 'PRESS 압입 올림' }, 'run')?.title === 'PRESS 압입'
  && headlineOf({ key: 'PRESS/0', label: 'PRESS 압입 올림' }, 'run')?.detail === '올림');

{
  const busy = (id, phase = 'work', pass = 0) => ({
    lift: { kit: { id: 1 }, phase, pass },
    busy: () => phase !== 'empty',
  });
  const hold = (over = {}) => inboundHold({
    plant: {
      route: ['SORT', 'SCREW', 'PRESS', 'SCREW', 'OUT'],
      def: { source: 'SORT' },
      lifts: ['SCREW', 'PRESS'],
      inM: null,
      inCarrier: { ok: () => true },
      rack: { items: [{ id: 1 }, { id: 2 }] },
      units: { SORT: { state: 'IDLE' }, SCREW: { state: 'BUSY' }, PRESS: { state: 'IDLE' } },
      work: { SCREW: busy('SCREW'), PRESS: { lift: { kit: null, phase: 'empty', pass: 0 } } },
      inFlow: new Set(),
      store: {},
      ...over,
    },
  });
  check('입고 대기 사유: SCREW 작업 중 · 랙 가득', hold() === 'SCREW 공정 지연으로 인한 대기', hold());
  check('입고 대기 사유: 여러 셀이 바빠도 Cell 하나만',
    hold({
      units: { SORT: { state: 'IDLE' }, SCREW: { state: 'BUSY' }, PRESS: { state: 'BUSY' } },
      work: { SCREW: busy('SCREW'), PRESS: busy('PRESS') },
    }) === 'SCREW 공정 지연으로 인한 대기');
  check('입고 대기 사유: 도크·AMR 점유는 안 적음',
    hold({
      rack: { items: [null, null] },
      inCarrier: { ok: () => false },
      units: { SORT: { state: 'IDLE' }, SCREW: { state: 'IDLE' }, PRESS: { state: 'IDLE' } },
      work: { SCREW: { lift: { kit: null, phase: 'empty', pass: 0 } }, PRESS: { lift: { kit: null, phase: 'empty', pass: 0 } } },
    }) == null);
  check('입고 대기 사유: PRESS 고장',
    hold({
      units: { SORT: { state: 'IDLE' }, SCREW: { state: 'IDLE' }, PRESS: { state: 'DOWN', down: { why: '주입' } } },
      work: { SCREW: { lift: { kit: null, phase: 'empty', pass: 0 } }, PRESS: busy('PRESS') },
    }) === 'PRESS 고장으로 인한 대기');
  const amr = { id: 'AMR-1', moving: false, charging: false, load: { dest: null }, waitFor: null, task: '대기' };
  const kit = { id: 9, holder: { k: 'amr', id: 'AMR-1' }, step: 0 };
  amr.load.e = kit;
  const parked = {
    route: ['SORT', 'SCREW', 'PRESS', 'SCREW', 'OUT'],
    def: { source: 'SORT' },
    lifts: ['SCREW', 'PRESS'],
    units: { SORT: { state: 'IDLE' }, SCREW: { state: 'BUSY' }, PRESS: { state: 'IDLE' } },
    work: { SCREW: busy('SCREW'), PRESS: { lift: { kit: null, phase: 'empty', pass: 0 } } },
    allAmrs: [amr],
    nextOf: () => 'SCREW',
    inFlow: new Set([kit]),
  };
  check('키트 이송 대기 사유: 다음 Cell 공정 지연', waitWhy({ plant: parked }, kit) === 'SCREW 공정 지연으로 인한 대기',
    waitWhy({ plant: parked }, kit));
  const clear = {
    ...parked,
    units: { SORT: { state: 'IDLE' }, SCREW: { state: 'IDLE' }, PRESS: { state: 'IDLE' } },
    work: { SCREW: { lift: { kit: null, phase: 'empty', pass: 0 } }, PRESS: { lift: { kit: null, phase: 'empty', pass: 0 } } },
    allAmrs: [{ ...amr, waitFor: 'SORT', blockedOn: { id: 'AMR-2' } }],
  };
  check('키트 이송 대기 사유: AMR 충돌·진입은 안 적음', waitWhy({ plant: clear }, kit) == null,
    waitWhy({ plant: clear }, kit));
}

{
  const s = plant(), T = new ProcessTrace();
  check('공정 없으면 시작 거부', new ProcessTrace().start(new ViewerState({ quiet: true })).mode === 'off');
  const v = T.start(s);
  check('시작 = 대기 · 스키마 · 가정', v.mode === 'wait' && v.schema === TRACE_SCHEMA && v.assumed === true && v.source === 'sim'
    && v.expected.join() === 'SORT,SCREW/0,PRESS/0,SCREW/1,OUT');
  check('대기 view 배너', v.banner?.title === '공정 추적' && (v.banner.detail === '다음 입고 대기' || /대기로/.test(v.banner.detail)));
  T.tick(s);
  check('t=0 입고 전이면 아직 대기', T.mode === 'wait' && T.kit == null);
  T.stop();
  check('중지 = off · 리포트 없음', T.mode === 'off' && T.view(s).kit == null);
}

{
  const s = plant();
  for (let i = 0; i < 5000; i++) s.step(0.1);
  const T = new ProcessTrace();
  T.start(s);
  T.tick(s);
  const w = T.view(s).waitWhy;
  check('가동 중 대기 사유는 Cell 하나', T.mode !== 'wait' || !w || /^(SORT|SCREW|PRESS) (공정 지연|고장)으로 인한 대기$/.test(w), w ?? T.mode);
}

{
  const s = plant(), T = new ProcessTrace();
  T.start(s);
  let latched = 0, same = true;
  for (let i = 0; i < 24000 && T.mode !== 'done'; i++) {
    s.step(0.1);
    const before = T.kit;
    T.tick(s);
    if (T.mode === 'run') {
      if (!latched) latched = T.kit;
      else if (T.kit !== latched) same = false;
    }
  }
  const R = T.view(s);
  check('입고 키트를 잡아 적재 구역까지 끝냄', T.mode === 'done' && R.ok === true && R.visits.join() === R.expected.join(),
    `mode ${T.mode} · visits ${R.visits.join('→')} · ${R.elapsed} s`);
  check('한 키트만 따라감(중간에 다른 키트로 안 바뀜)', latched > 0 && same, `kit #${latched}`);
  check('첫 단계는 메인 AMR 출발', R.stages[0]?.key === 'depart', R.stages[0]?.key);
  check('추적 중 배너 = 지금 단계 이름·한 줄', R.banner?.title && R.banner.detail != null, `${R.banner?.title} / ${R.banner?.detail}`);
  check('체류·단계 시각 > 0 · JSON 왕복', R.elapsed > 60 && R.stages.length >= 5 && R.t0 != null && R.t1 > R.t0
    && JSON.stringify(JSON.parse(JSON.stringify(R))) === JSON.stringify(R),
    `단계 ${R.stages.length} · ${R.elapsed} s`);
  check('단계 키가 입고·랙·셀 방문·OUT 을 포함',
    ['depart', 'sort-rack', 'SCREW/0', 'PRESS/0', 'SCREW/1', 'OUT'].every((k) => R.stages.some((st) => st.key === k)),
    R.stages.map((st) => st.key).join(' → '));
  check('대기 시간은 체류를 넘지 않음', R.wait >= 0 && R.wait <= R.elapsed, `wait ${R.wait}`);
}

{
  const s = plant(), T = new ProcessTrace();
  T.start(s);
  const units = [];
  for (let i = 0; i < 24000 && T.mode !== 'done'; i++) {
    s.step(0.1);
    T.tick(s);
    const f = T.focus(s);
    const key = f ? `${f.kind}:${f.id}` : '';
    if (key && units.at(-1) !== key) units.push(key);
  }
  const kinds = units.map((u) => u.split(':')[0]);
  const ids = units.map((u) => u.split(':')[1]);
  check('카메라는 도어트림이 아니라 공정 단위 장비(입고 AMR·SORT·SCREW·PRESS·OUT)',
    kinds[0] === 'amr' && ids.includes('SORT') && ids.includes('SCREW') && ids.includes('PRESS') && ids.includes('OUT')
    && units.every((u) => /^(amr|cell|site):/.test(u)),
    units.join(' → '));
  check('셀 공정 때는 그 셀을 보고, 이송 때는 AMR 을 본다',
    units.some((u) => u === 'cell:SORT') && units.some((u) => u === 'cell:SCREW') && units.some((u) => u === 'cell:PRESS')
    && units.some((u) => u === 'site:OUT') && kinds.filter((k) => k === 'amr').length >= 2,
    units.join(' → '));
}

{
  const s = plant();
  for (let i = 0; i < 4000; i++) s.step(0.1);
  const gone = s.plant.parts.list().filter((e) => e.type === 'kit' && pastStart(s, e)).map((e) => e.id);
  const T = new ProcessTrace();
  T.start(s);
  for (let i = 0; i < 20000 && (T.mode !== 'run' || T.kit == null); i++) { s.step(0.1); T.tick(s); }
  check('이미 흐름 안 키트는 건너뛰고 다음 입고를 잡음', T.mode === 'run' && T.kit != null && !gone.includes(T.kit),
    `kit #${T.kit} · 이전 흐름 ${gone.slice(0, 6).join(',')}`);
}

{
  const a = plant(), b = plant(), A = new ProcessTrace(), B = new ProcessTrace();
  A.start(a); B.start(b);
  for (let i = 0; i < 24000 && (A.mode !== 'done' || B.mode !== 'done'); i++) {
    a.step(0.1); b.step(0.1); A.tick(a); B.tick(b);
  }
  check('같은 시드로 리포트 시각·방문이 같다(결정론)', A.mode === 'done' && B.mode === 'done'
    && A.report.t0 === B.report.t0 && A.report.t1 === B.report.t1 && A.report.visits.join() === B.report.visits.join()
    && A.report.kit === B.report.kit);
}

console.log(`  ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
