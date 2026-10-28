// 장비 상태 문서(data/monitor.js): 셀·AMR·견마·드론 JSON · 신호 형식 · 핸드셰이크가 시뮬 티켓과 같음 · 고장 반영.
import { readFile } from 'node:fs/promises';
import { ViewerState } from '../js/sim/state.js';
import { STATUS_SCHEMA, equipmentIds, equipmentStatus } from '../js/data/monitor.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

const doc = JSON.parse(await readFile(new URL('../src/process.default.json', import.meta.url), 'utf8'));
const TYPES = { bool: 'boolean', int: 'number', real: 'number', string: 'string' };
const sig = (d, id) => d.signals.find((s) => s.id === id);

function shapeIssues(d) {
  const out = [];
  if (d.schema !== STATUS_SCHEMA || d.assumed !== true || d.source !== 'sim') out.push('머리 필드');
  const ids = new Set();
  for (const s of d.signals) {
    if (ids.has(s.id)) out.push(`중복 ${s.id}`);
    ids.add(s.id);
    if (!TYPES[s.type]) out.push(`형식 ${s.id}:${s.type}`);
    else if (s.value !== null && typeof s.value !== TYPES[s.type]) out.push(`값 형식 ${s.id}=${s.value}`);
    if (s.type === 'int' && s.value !== null && !Number.isInteger(s.value)) out.push(`정수 아님 ${s.id}=${s.value}`);
    if (!s.group || !s.label) out.push(`이름 없음 ${s.id}`);
  }
  if (JSON.stringify(JSON.parse(JSON.stringify(d))) !== JSON.stringify(d)) out.push('JSON 왕복 다름');
  return out;
}

console.log('monitor');
{
  const s = new ViewerState({ quiet: true, scenario: 'supply', process: doc });
  const ids = equipmentIds(s);
  const parts = s.equip ?? [];
  check('장비 목록 = 셀 + AMR 두 플릿 + 견마·드론 + 셀 장비', ids.length === s.cells.length + s.amrs.length + s.plant.robots.length + parts.length && ids.includes('HOUND-02') && ids.includes('P-AMR-01') && ids.includes('PRESS:R6'), `n=${ids.length}`);
  check('없는 id 는 null', equipmentStatus(s, 'NOPE') === null && equipmentStatus(s, null) === null);

  const first = Object.fromEntries(ids.map((id) => [id, equipmentStatus(s, id).signals.map((x) => x.id).join(',')]));
  const seen = { in: 0, out: 0, inAmr: 0, outAmr: 0, sortHs: 0, work: 0, wait: 0, run: 0 };
  const issues = [];
  let progBad = 0, shapeBad = [];
  for (let t = 0; t < 1500; t += 0.1) {
    s.step(0.1);
    if (Math.round(t * 10) % 20) continue;   // 2 s 마다
    for (const id of ids) {
      const d = equipmentStatus(s, id);
      const sh = shapeIssues(d);
      if (sh.length) shapeBad.push(`${id}@${t.toFixed(0)} ${sh[0]}`);
      if (d.signals.map((x) => x.id).join(',') !== first[id]) issues.push(`${id} 신호 목록 바뀜 @${t.toFixed(0)}`);
    }
    for (const id of ['PRESS', 'SCREW']) {
      const cw = s.plant.work[id], d = equipmentStatus(s, id);
      if (sig(d, 'IN.REQ').value !== !!cw.ticket || sig(d, 'OUT.REQ').value !== !!cw.out) issues.push(`${id} 티켓 신호 다름`);
      if (sig(d, 'LIFT.PHASE').value !== cw.lift.phase) issues.push(`${id} 리프트 단계 다름`);
      if (cw.ticket) {
        seen.in++;
        const a = equipmentStatus(s, sig(d, 'IN.AMR').value);
        if (a?.kind === 'amr' && sig(a, 'HS.REQ').value) seen.inAmr++;
      }
      if (cw.out) {
        seen.out++;
        const a = equipmentStatus(s, sig(d, 'OUT.AMR').value);
        if (a?.kind === 'amr' && sig(a, 'HS.REQ').value) seen.outAmr++;
      }
      const P = d.process;
      if (P.phase === 'work') {
        seen.work++;
        if (!(P.progress >= 0 && P.progress <= 1) || Math.abs(P.remaining - P.standard * (1 - P.progress)) > 0.11) progBad++;
        if (P.waiting.length) seen.wait++;
        if (P.steps.some((st) => st.ops.some((o) => o.state === 'run'))) seen.run++;
      }
    }
    const so = equipmentStatus(s, 'SORT');
    if (sig(so, 'HS.REQ').value !== !!s.plant.work.SORT.ticket) issues.push('SORT 티켓 신호 다름');
    if (sig(so, 'HS.REQ').value) seen.sortHs++;
  }
  check('신호 형식(형식·값·id 중복·JSON 왕복) 2 s 마다 전 장비', !shapeBad.length, shapeBad.slice(0, 3).join(' · '));
  check('핸드셰이크·리프트 신호 = 셀 티켓·단계, 신호 목록 시간 불변', !issues.length, issues.slice(0, 3).join(' · '));
  check('투입·반출 티켓 실제로 나타남(점검 살아 있음)', seen.in > 0 && seen.out > 0 && seen.sortHs > 0, JSON.stringify(seen));
  check('투입·반출 상대 AMR 문서도 셀 티켓을 잡고 있음', seen.inAmr === seen.in && seen.outAmr === seen.out, `in ${seen.inAmr}/${seen.in} · out ${seen.outAmr}/${seen.out}`);
  check('작업 중 진행률 0~1 · 남은 표준 시간 = 표준 × (1 − 진행률)', seen.work > 0 && progBad === 0, `작업 표본 ${seen.work} · 어긋남 ${progBad}`);
  check('단계 작업 진행·시작 대기 둘 다 보임', seen.run > 0 && seen.wait > 0, `진행 ${seen.run} · 대기 ${seen.wait}`);

  const press = equipmentStatus(s, 'PRESS');
  check('리프트 셀 로봇 표 = 정의 로봇(R6–R10)', ['R6', 'R7', 'R8', 'R9', 'R10'].every((n) => press.robots.some((r) => r.name === n)), press.robots.map((r) => r.name).join(','));
  check('공급 라인 4개 신호(L01–L04 팔레트·롤러·직교이송)', ['L01', 'L02', 'L03', 'L04'].every((L) => sig(press, `${L}.STOCK`) && sig(press, `${L}.GANTRY`)));
  const drone = equipmentStatus(s, 'DRONE-01'), amr = equipmentStatus(s, 'AMR-01');
  check('드론·AMR 문서 종류·배터리', drone.kind === 'drone' && amr.kind === 'amr' && amr.fleet === 'trim' && sig(drone, 'BATT').value === Math.round(s.plant.drones.drones[0].battery * 10) / 10);
}

{
  const s = new ViewerState({ quiet: true, scenario: 'faults', process: doc });
  for (let t = 0; t < 120; t += 0.1) s.step(0.1);
  const d = equipmentStatus(s, 'PRESS');
  check('고장 시나리오 t=120: PRESS DOWN · FAULT ON · 사유', d.state === 'DOWN' && sig(d, 'FAULT').value === true && d.fault?.why === '압입 설비 이상(가정)', `${d.state} ${d.fault?.why}`);
}

{
  const s = new ViewerState({ quiet: true, scenario: 'supply' });
  for (let t = 0; t < 30; t += 0.1) s.step(0.1);
  const d = equipmentStatus(s, 'SCREW');
  check('공정 정의 없음: 사이클 타이머 공정 · 진행률 신호', d.process?.label === '작업 사이클(타이머)' && sig(d, 'PROGRESS') && !sig(d, 'LIFT.PHASE'));
  const n = new ViewerState({ quiet: true });
  const c = equipmentStatus(n, 'SORT');
  check('시나리오 없음: 셀 기본 신호만 · 공정 없음', c.process === null && c.signals.length === 4 && equipmentIds(n).length === n.cells.length);
}

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
