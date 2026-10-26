// 셀 공정(M-4~M-7, M-11·M-12, M-37) 게이트: 정의 점검 · 사이클 합 · 소유자 하나 · 순간이동 없음 · 잠금 위반 0 · 결정론 · DOWN 정지 · JSON 지점 ↔ GLB.
// 공정 순서 SORT → SCREW → PRESS → SCREW → OUT · PRESS·SCREW 작업대 리프트(지그째 들어 올림 → AMR 직진 출발 → 작업 → 빈 AMR 위로 내림) · SORT 양팔 지그째 적재.
import { readFile } from 'node:fs/promises';
import { readGlb } from '../js/assets/glb.js';
import { cellRig } from '../js/assets/rigdata.js';
import { CellWork } from '../js/sim/cellwork.js';
import { Parts } from '../js/sim/parts.js';
import { flowTime, passOf, quadOf, validateProcess, workDef } from '../js/sim/process.js';
import { SCENARIOS } from '../js/sim/scenario.js';
import { AMR } from '../js/sim/fleet.js';
import { ViewerState } from '../js/sim/state.js';
import { defaultLayout, normalizeLayout, placeOf, toWorld } from '../js/sim/layout.js';
import { dockIssues } from '../js/sim/supply.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const clone = (o) => JSON.parse(JSON.stringify(o));
// 두 AMR 차체(길이 × 폭 사각형) 사이 최소 거리 — 둘레 점 표본
const bodyPts = (a) => {
  const f = { x: Math.sin(a.heading), z: Math.cos(a.heading) }, r = { x: f.z, z: -f.x }, l = AMR.length / 2, w = AMR.width / 2, out = [];
  for (let i = 0; i <= 10; i++) {
    const u = -l + (2 * l * i) / 10, v = -w + (2 * w * i) / 10;
    for (const [p, q] of [[u, w], [u, -w], [l, v], [-l, v]]) out.push({ x: a.x + f.x * p + r.x * q, z: a.z + f.z * p + r.z * q });
  }
  return out;
};
const bodyGap = (a, b) => { let m = Infinity; const B = bodyPts(b); for (const p of bodyPts(a)) for (const q of B) m = Math.min(m, Math.hypot(p.x - q.x, p.z - q.z)); return m; };

console.log('process');
const doc = JSON.parse(await readFile(new URL('../src/process.default.json', import.meta.url), 'utf8'));
const { cycle } = SCENARIOS.supply;
check('기본 정의 점검 통과(시나리오 cycle 과 함께)', validateProcess(doc, { cycle }).length === 0, validateProcess(doc, { cycle }).join(' · '));
check('assumed 표시', doc.assumed === true);
const P = workDef(doc, 'PRESS'), PS = workDef(doc, 'SCREW');
const passSum = (W) => W.passes.reduce((s, f) => s + flowTime(f), 0);
check('공정 순서 SORT → SCREW → PRESS → SCREW → OUT · SCREW 방문 1·2 = pass 0·1', doc.route.join() === 'SORT,SCREW,PRESS,SCREW,OUT'
  && passOf(doc.route, 1) === 0 && passOf(doc.route, 2) === 0 && passOf(doc.route, 3) === 1);
check('PRESS pass 단계 합 = takt = 시나리오 cycle(28 s)', passSum(P) === 28 && P.takt === cycle.PRESS && P.passes.length === 1);
check('SCREW 1차 21 s + 2차 31 s = takt = 시나리오 cycle(52 s)', PS.passes.length === 2 && flowTime(PS.passes[0]) === 21 && flowTime(PS.passes[1]) === 31 && PS.takt === cycle.SCREW);
check('메인 AMR 적재면 = MAIN 패널 윗면(1.07) · 리프트 rise > 0 · 지그가 도어트림보다 넓다', doc.deck === 1.07 && P.lift.rise > 0
  && doc.jig.size[0] >= doc.kit.size[0] && doc.jig.size[2] >= doc.kit.size[2]);
check('리프트 자리 = 레이아웃 PRESS·SCREW 정차 칸(AMR_MAIN_JIG 자리)', ['PRESS', 'SCREW'].every((id) => {
  const s = defaultLayout().amr.cells[id].stops.at(-1), L = doc.cells[id].lift;
  return Math.abs(s.x - L.x) < 1e-9 && Math.abs(s.z - L.z) < 1e-9;
}));
check('부품 자리 → 사분면 구역(PRESS 한 단계 네 투입이 서로 다른 구역)', new Set(Object.values(P.parts).map((p) => quadOf(p.at))).size === 4);
{
  const bad = clone(doc); bad.cells.PRESS.passes[0].steps[2][0].time = 6;
  check('단계 합이 takt 와 다르면 오류', validateProcess(bad, { cycle }).some((e) => e.includes('takt')));
  const b2 = clone(doc); b2.cells.PRESS.passes[0].steps[0][0].line = 'L99';
  check('없는 라인이면 오류', validateProcess(b2).some((e) => e.includes('L99')));
  const b3 = clone(doc); b3.cells.PRESS.parts.P_HDL.at = [0.55, -0.08];
  check('키트 밖 부품 자리면 오류', validateProcess(b3).some((e) => e.includes('키트 밖')));
  const b4 = clone(doc); b4.cells.PRESS.passes[0].steps[0][1].line = 'L01';
  check('한 단계에 같은 로봇 둘이면 오류', validateProcess(b4).some((e) => e.includes('겹침')));
  const b5 = clone(doc); b5.cells.SCREW.passes[1].steps[2][0].time = 5;
  check('SCREW 도 같은 점검(단계 합 ≠ takt 이면 오류)', validateProcess(b5, { cycle }).some((e) => e.startsWith('SCREW') && e.includes('takt')));
  const b6 = clone(doc); b6.cells.SORT.load.robots = ['Dual_arm_L'];
  check('SORT 적재 팔이 2개가 아니면 오류', validateProcess(b6).some((e) => e.includes('load.robots')));
  const bIn = clone(doc); bIn.cells.SORT.inbound.load = 0;
  check('SORT inbound.load 가 양수 아니면 오류', validateProcess(bIn).some((e) => e.includes('inbound.load')));
  const b7 = clone(doc); b7.route = ['SORT', 'SCREW', 'PRESS', 'OUT'];
  check('route 방문 수 ≠ passes 수면 오류(SCREW 1번 · passes 2)', validateProcess(b7).some((e) => e.includes('SCREW') && e.includes('passes')), validateProcess(b7).join(' · '));
  const b8 = clone(doc); delete b8.cells.OUT;
  check('완료품 적재 구역(OUT) 정의가 없으면 route 오류', validateProcess(b8).some((e) => e.includes('OUT')));
  const b9 = clone(doc); b9.cells.OUT.cobot.L1 = 0;
  check('OUT 협동로봇 팔 길이는 양수', validateProcess(b9).some((e) => e.includes('cobot')));
  const b10 = clone(doc); b10.cells.PRESS.passes[0].steps[1].push({ do: 'dwell', time: 1 });
  check('path 는 단계에 혼자(키트 네 구역을 다 잡는다)', validateProcess(b10).some((e) => e.includes('혼자')));
  const b11 = clone(doc); b11.jig.size = [1.0, 0.05, 0.5];
  check('지그가 도어트림보다 작으면 오류', validateProcess(b11).some((e) => e.includes('jig')));
  const b12 = clone(doc); delete b12.cells.SCREW.lift;
  check('리프트 정의 없으면 오류', validateProcess(b12).some((e) => e.startsWith('SCREW') && e.includes('lift')));
  const b13 = clone(doc); b13.route = ['SORT', 'SCREW', 'SCREW', 'PRESS', 'OUT'];
  check('route 같은 셀 연속이면 오류', validateProcess(b13).some((e) => e.includes('연속')));
}

const kitSpec = { size: doc.kit.size, h: doc.kit.size[1] + doc.jig.size[1], jig: { size: doc.jig.size, color: doc.jig.color } };
// 셀 단독 사이클용: 리프트가 비면 지그 실은 AMR 이 있는 것처럼 넘기고(pass 는 next() 순서), 작업이 끝나면 빈 AMR 이 받아 간 것처럼 치운다.
const fakeAmr = (cw, parts, next = () => 0) => {
  const at = cw.dock;
  if (cw.canAccept(false)) {
    const k = parts.add('kit', { k: 'drop', cell: cw.id, at: [at.x, doc.deck, at.z] }, { ...kitSpec });
    cw.offer(k, k.holder, at, next());
  }
  if (cw.outReady()) cw.offerOut({ k: 'drop', cell: cw.id, at: [at.x, doc.deck, at.z] }, at);
  for (const e of parts.list()) if (e.type === 'kit' && e.holder.k === 'drop' && !cw.ticket) parts.remove(e);
};

const rigOf = async (id) => { const { json, bin } = readGlb(await readFile(new URL(`../src/render_asset/${id}.glb`, import.meta.url))); return cellRig(json, bin); };
const RIGS = { PRESS: await rigOf('PRESS'), SCREW: await rigOf('SCREW'), SORT: await rigOf('SORT') };
const rig = RIGS.PRESS;

// ── JSON 지점 ↔ GLB 형상 ──
for (const [id, W, nRobots] of [['PRESS', P, 5], ['SCREW', PS, 6]]) {
  const parts = new Parts(), cw = new CellWork(id, W, parts);
  const rep = cw.attachRig(RIGS[id]);
  check(`${id} 기구 묶음: 로봇 ${nRobots} · 갠트리 4 · 롤러 4`, rep.robots.length === nRobots && rep.gantries.length === 4 && rep.rollers.length === 4 && !rep.missing.length, JSON.stringify(rep));
  for (const L of cw.lines) {
    const R = RIGS[id].rollers.find((r) => r.node === L.rig.rollers.node), G = RIGS[id].gantries.find((g) => g.node === L.rig.gantry.node);
    const zlo = Math.min(L.in, L.out), zhi = Math.max(L.in, L.out);
    check(`${id} ${L.id} 롤러 윗면 = 라인 y · 투입/배출 지점이 롤러 위`, Math.abs(R.top - L.y) < 0.02 && R.min[2] <= zlo + 0.1 && R.max[2] >= zhi - 0.1 && R.min[0] <= L.x && R.max[0] >= L.x,
      `top ${R.top.toFixed(3)} z ${R.min[2].toFixed(2)}..${R.max[2].toFixed(2)}`);
    check(`${id} ${L.id} 갠트리 행정이 적재·투입 지점 포함 · 원점 ≈ 투입 지점`, G.travel[0] - 0.1 <= Math.min(L.in, L.feed.stock) && G.travel[1] + 0.1 >= Math.max(L.in, L.feed.stock) && Math.abs(G.toolOrigin[2] - L.in) < 0.1,
      `travel ${G.travel.map((v) => v.toFixed(2)).join('..')} home ${G.toolOrigin[2].toFixed(2)}`);
    check(`${id} ${L.id} 갠트리 올림 높이 > 패드 원점`, L.feed.up > L.rig.gantry.padHome, `${L.feed.up} > ${L.rig.gantry.padHome.toFixed(3)}`);
  }
  if (id === 'PRESS') {
    const R6 = cw.robots.R6;
    check('레일 범위: 이웃 로봇 중간점에서 railGap/2 띄움(R6 hi ≈ 0.75)', R6.ch.track && Math.abs(R6.ch.track.hi - 0.75) < 0.02 && R6.ch.track.lo < -1, `${R6.ch.track.lo.toFixed(2)}..${R6.ch.track.hi.toFixed(2)}`);
  }
}

// ── 사이클: 지그 실은 AMR 이 늘 있고 빈 AMR 이 늘 받으러 오면 → 완료 간격 = 그 pass 시간 + 올림 + 내림 ──
for (const [id, W, nR] of [['PRESS', P, 5], ['SCREW', PS, 6]]) {
  const parts = new Parts(), cw = new CellWork(id, W, parts);
  cw.attachRig(RIGS[id]);
  cw.dock = { x: W.lift.x, z: W.lift.z };
  const np = W.passes.length, lift = W.lift.up + W.lift.down, done = [];
  let n = 0, t = 0, last = 0, gripY = [], workHolder = true, robotOnAmr = false;
  for (let i = 0; i < 4000; i++) {
    fakeAmr(cw, parts, () => n++ % np);
    const before = cw.lift.kit;
    if (cw.lift.phase === 'rise' && Object.values(cw.robots).some((r) => r.op)) robotOnAmr = true;
    cw.step(0.1, false); t += 0.1;
    if (!before && cw.lift.kit) gripY.push(cw.lift.y - W.deck);
    if (cw.lift.phase === 'work' && cw.lift.kit?.holder.k !== 'lift') workHolder = false;
    if (cw.done > last) { done.push(t); last = cw.done; }
  }
  const gaps = done.slice(1).map((v, k) => [v - done[k], flowTime(W.passes[(k + 1) % np]) + lift + 0.2]);
  check(`${id} 완료 간격 = pass 시간 + 올림 ${W.lift.up} + 내림 ${W.lift.down} s + 핸드셰이크 2스텝(±0.15)${np > 1 ? ' · 1차·2차 번갈아' : ''}`, gaps.length > 5 && gaps.every(([g, w]) => Math.abs(g - w) < 0.15),
    gaps.slice(0, 6).map(([g, w]) => `${g.toFixed(1)}/${w}`).join(','));
  check(`${id} 클립은 AMR 적재면 높이에서 문다(소유 이동 때 위치 같음) · 작업 중 키트 소유자 = 리프트`, gripY.length > 5 && gripY.every((d) => Math.abs(d) < 1e-9) && workHolder);
  check(`${id} 올림 중 로봇 작업 없음(AMR 위 키트를 로봇이 집지 않는다)`, !robotOnAmr);
  check(`${id} 잠금 위반 0 · 잠금 없는 구역 진입 0`, cw.lockFaults === 0 && cw.intrude === 0, `faults ${cw.lockFaults} intrude ${cw.intrude} ${cw.lastIntrude ?? ''}`);
  const sols = [...cw.cache.values()].flat().filter((q) => q.ok !== undefined);
  check(`${id} 모든 작업 키 프레임 IK 도달`, sols.length > 20 && sols.every((q) => q.ok), `${sols.filter((q) => q.ok).length}/${sols.length}`);
  check(`${id} 로봇 ${nR}대 모두 공정에 참여`, Object.keys(cw.robots).length === nR, Object.keys(cw.robots).join(','));
  check(`${id} pass 별 완료 수 = 번갈아 offer 한 수`, np === 1 || Math.abs(cw.passDone[0] - cw.passDone[1]) <= 1, cw.passDone.join('/'));
  if (id !== 'PRESS') continue;
  check('롤러 적재: 줄 위 부품 간격 ≥ pitch', cw.lines.every((L) => L.items.every((e, i) => i === 0 || L.items[i - 1].holder.s - e.holder.s >= L.pitch - 1e-9)));
  // 잠금 점검이 실제로 걸리는지: 잠금 없이 든 지그 남서쪽 구역에 들어가는 작업을 억지로 돌린다
  const r = cw.robots.R6, before = cw.intrude;
  const p = [cw.p[0] - 0.3, cw.top + cw.kitH + 0.05, cw.p[2] - 0.15];
  for (const z of Object.keys(cw.locks)) cw.locks[z] = null;
  cw.lift.phase = 'hold'; cw.lift.run = null;
  cw.ticket = null; cw.out = null;
  r.op = null;
  cw.startOp(r, { label: 'test', time: 2, zones: [], keys: [{ t: 0, p: null }, { t: 0.5, p }, { t: 1, p: null }], events: [] });
  for (let i = 0; i < 20; i++) cw.step(0.1, false);
  check('잠금 없이 구역 작업 높이 진입 → intrude 증가(점검이 살아 있음)', cw.intrude > before, `${before}→${cw.intrude}`);
}

// ── 토트 덤프 → 직교이송이 상자 그대로 롤러로 → 협동로봇이 상자에서 집기 ──
{
  const parts = new Parts(), cw = new CellWork('PRESS', P, parts);
  cw.enableTote(doc.supply);
  const L = cw.lineOf.L01;
  check('토트 모드 시작: 롤러·팔레트 비움', !L.stock && L.items.length === 0 && L.left === 0);
  const tote = parts.add('tote', { k: 'drop', cell: 'PRESS', at: [L.x, L.feed.stockY, L.feed.stock] }, {
    size: doc.supply.tote.size, h: doc.supply.tote.size[1], n: doc.supply.qty, part: L.part, dock: 'PRESS:L01',
  });
  cw.acceptTote(L, tote);
  check('덤프 뒤 토트가 팔레트에 남음(부품으로 안 바뀜)', L.stock === tote && tote.type === 'tote' && L.left === doc.supply.qty && parts.get(tote.id));
  for (let i = 0; i < 200 && L.stock; i++) cw.step(0.1, false);
  check('직교이송이 상자를 집어 팔레트에서 뗌', !L.stock && (L.gantry.held === tote || L.items.includes(tote)), `held ${L.gantry.held?.id} items ${L.items.map((e) => e.type).join(',')}`);
  for (let i = 0; i < 200 && !L.items.includes(tote); i++) cw.step(0.1, false);
  check('상자가 롤러(레일) 위에 있음', L.items[0] === tote && tote.holder.k === 'line' && tote.n === doc.supply.qty);
  for (let i = 0; i < 200 && tote.holder.s < L.len - 1e-9; i++) cw.step(0.1, false);
  check('롤러가 상자를 배출 지점까지 당김', tote.holder.k === 'line' && tote.holder.s >= L.len - 1e-9, `s ${tote.holder.s?.toFixed(2)}`);
  cw.seed({ ...kitSpec });
  const n0 = tote.n;
  for (let i = 0; i < 200 && tote.n === n0; i++) cw.step(0.1, false);
  check('협동로봇이 상자에서 부품을 집음(토트 n 감소 · 상자 유지)', tote.n === n0 - 1 && parts.get(tote.id) && parts.list().some((e) => e.type === L.part && e.holder.k !== 'tote'), `n ${tote.n} viol ${parts.violationCount}`);
  check('토트 흐름 소유 위반 0', parts.violationCount === 0);
}

// ── 전체 플랜트: 소유자 하나 · 순간이동 없음 · TCP 간격 · 결정론 ──
function run(seconds, { withRig = true, every = null } = {}) {
  const s = new ViewerState({ scenario: 'supply', quiet: true, process: doc });
  if (withRig) for (const [id, R] of Object.entries(RIGS)) s.attachRig(id, R);
  const n = Math.round(seconds / 0.1);
  for (let i = 0; i < n; i++) { s.step(0.1); every?.(s, i); }
  return s;
}
for (const withRig of [false, true]) {
  let prev = new Map(), maxD = 0, worst = '', audit = 0, minRR = Infinity, held = 0, maxYaw = 0, paired = 0;
  const s = run(900, {
    withRig,
    every: (s) => {
      const cur = new Map(s.plant.partPoses().map((p) => [p.id, p]));
      for (const [id, p] of cur) {
        const q = prev.get(id);
        if (q) { const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z); if (d > maxD) { maxD = d; worst = `${q.holder}→${p.holder} ${p.type}`; } }
        if (q) maxYaw = Math.max(maxYaw, Math.abs(Math.atan2(Math.sin(p.yaw - q.yaw), Math.cos(p.yaw - q.yaw))));
        if (p.holder === 'pair') paired++;
      }
      held += [...cur.values()].filter((p) => p.holder === 'robot').length;
      prev = cur;
      audit += s.plant.parts.audit().length;
      for (const id of ['PRESS', 'SCREW']) {
        const rs = Object.values(s.plant.work[id].robots).filter((r) => r.tcp);
        for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) minRR = Math.min(minRR, Math.hypot(...rs[a].tcp.map((v, k) => v - rs[b].tcp[k])));
      }
    },
  });
  const tag = withRig ? 'rig' : 'rig 없음';
  const cw = s.plant.work.PRESS, cs = s.plant.work.SCREW, sw = s.plant.work.SORT;
  check(`[${tag}] 소유자 하나: 옮김 위반 0 · 자리 중복 0 (900 s 매 스텝)`, s.plant.parts.violationCount === 0 && audit === 0, `viol ${s.plant.parts.violationCount} audit ${audit}`);
  check(`[${tag}] 순간이동 없음: 엔티티 스텝당 이동 ≤ 0.25 m`, maxD <= 0.25 && held > 100, `max ${maxD.toFixed(3)} (${worst})`);
  check(`[${tag}] PRESS 완료 > 0 · SCREW 셀 공정 완료 > 0 (시작 재고 0 — 첫 키트·토트는 AMR 이 가져옴)`, cw.done >= 1 && cs.done >= 1 && s.plant.units.SCREW.done === cs.done, `PRESS ${cw.done} SCREW ${cs.done}`);
  check(`[${tag}] SORT 양팔 입고 > 5 · 적재 ≥ 3(흐름 안 키트 상한) · 키트가 두 팔에 들린 스텝 있음`, sw.inDone > 5 && sw.done >= 3 && paired > 100, `입고 ${sw.inDone} 적재 ${sw.done} 들린 스텝 ${paired}`);
  check(`[${tag}] 키트 yaw 스텝당 변화 ≤ 0.2 rad(돌아서 놓을 때 튀지 않음)`, maxYaw <= 0.2, maxYaw.toFixed(3));
  if (withRig) {
    check('[rig] 로봇 TCP 끼리 0.2 m 넘게 떨어짐(PRESS·SCREW)', minRR > 0.2, minRR.toFixed(3));
    check('[rig] 잠금 위반 0 · 잠금 없는 구역 진입 0(PRESS·SCREW)', cw.lockFaults === 0 && cw.intrude === 0 && cs.lockFaults === 0 && cs.intrude === 0, `PRESS ${cw.lockFaults}/${cw.intrude} SCREW ${cs.lockFaults}/${cs.intrude} ${cs.lastIntrude ?? ''}`);
    check('[rig] SORT 두 그리퍼가 키트 양끝을 따라감(IK 오차 < 2 mm)', sw.miss < 0.002, `${(sw.miss * 1000).toFixed(2)} mm`);
  }
}
{
  const sig = (s) => JSON.stringify([s.plant.partPoses().map((p) => [p.id, p.x.toFixed(6), p.y.toFixed(6), p.z.toFixed(6)]), s.plant.summary().units,
    ...['PRESS', 'SCREW', 'SORT'].map((id) => s.plant.work[id].view().robots.map((r) => r.tcp?.map((v) => v.toFixed(6))))]);
  const a = sig(run(400)), b = sig(run(400));
  check('결정론: 같은 입력 두 번 → 엔티티·로봇 TCP·셀 상태 같음', a === b && a.length > 1000);
  const c = run(400, { withRig: false });
  check('rig 유무와 무관하게 공정 시각 같음(완료 수·셀 상태)', JSON.stringify(c.plant.summary().units) === JSON.stringify(run(400).plant.summary().units));
}

// ── DOWN: 셀 안 전부 정지(로봇·갠트리·롤러·스테이션) ──
{
  const s = run(60);
  const cw = s.plant.work.PRESS;
  // PRESS 셀 안 엔티티만(SORT·SCREW 는 계속 돈다)
  const inPress = (e) => e.holder.cell === 'PRESS' || (e.holder.k === 'kit' && s.plant.parts.get(e.holder.kit)?.holder.cell === 'PRESS');
  const snap = () => JSON.stringify([cw.view(), [...s.plant.parts.items.values()].filter(inPress).map((e) => [e.id, s.plant.poseOf(e)])]);
  s.plant.units.PRESS.down = { why: 'test' };
  s.step(0.1);
  const a = snap();
  for (let i = 0; i < 50; i++) s.step(0.1);
  check('DOWN 동안 셀 안 동작·위치 그대로', a === snap() && s.plant.units.PRESS.state === 'DOWN');
  const doneAt = cw.done;
  s.plant.units.PRESS.down = null;
  for (let i = 0; i < 8000; i++) s.step(0.1);
  check('복구 뒤 다시 돈다(완료 증가)', a !== snap() && cw.done > doneAt, `${doneAt}→${cw.done}`);
}

// ── 리프트 투입: 지그 실은 메인 AMR 이 리프트 자리(AMR_MAIN_JIG)에 섬 → 클립이 물고 들어 올림 → AMR 은 들린 지그 밑으로 출구 쪽 직진 ──
{
  const s = new ViewerState({ scenario: 'supply', quiet: true, process: doc });
  s.attachRig('SCREW', RIGS.SCREW);
  const cw = s.plant.work.SCREW, lay = defaultLayout(), pl = placeOf(lay, 'SCREW');
  const stop = toWorld(pl, lay.amr.cells.SCREW.stops.at(-1)), exit = toWorld(pl, lay.amr.cells.SCREW.exit);
  let seen = null, busy = false;
  for (let i = 0; i < 6000 && !seen; i++) {
    s.step(0.1);
    const T = cw.ticket;
    const a = T && s.amrs.find((x) => x.ticket === T);
    if (a && T.started && !T.released) seen = { a, T, task: a.task, x: a.x, z: a.z, h: a.heading };
  }
  check('올림 중 AMR 라벨 「SCREW 지그 올림」 · AMR 이 리프트 자리에 섬', !!seen && seen.task.startsWith('SCREW 지그 올림') && Math.hypot(seen.x - stop.x, seen.z - stop.z) < 0.05,
    seen ? `${seen.task} @${seen.x.toFixed(2)},${seen.z.toFixed(2)} (자리 ${stop.x.toFixed(2)},${stop.z.toFixed(2)})` : '없음');
  let left = null;
  for (let i = 0; i < 200 && seen; i++) {
    const x = seen.a.x, z = seen.a.z;
    s.step(0.1);
    if (Object.values(cw.robots).some((r) => r.op) && !seen.T.released) busy = true;
    if (Math.hypot(seen.a.x - x, seen.a.z - z) > 1e-6) {
      left = { gripped: seen.T.gripped, released: seen.T.released, lifted: +(cw.lift.y - doc.deck).toFixed(3), holder: seen.T.kit.holder.k, load: !!seen.a.load };
      break;
    }
  }
  check('AMR 은 지그가 다 들린(released) 뒤 출발 · 키트 소유자 = 리프트 · AMR 은 빈 채', !!left && left.gripped && left.released && left.holder === 'lift' && !left.load
    && Math.abs(left.lifted - doc.cells.SCREW.lift.rise) < 1e-6, JSON.stringify(left));
  check('올림 동안 로봇은 쉰다(AMR 위 키트를 집지 않음)', !busy);
  // 들린 지그 밑으로 그대로 직진: 출구까지 옆으로 벗어나지 않음 · 돌지 않음
  let dev = 0, turn = 0, d0 = seen ? Math.hypot(seen.a.x - exit.x, seen.a.z - exit.z) : 0, d1 = d0;
  const ux = exit.x - stop.x, uz = exit.z - stop.z, uL = Math.hypot(ux, uz);
  for (let i = 0; i < 300 && seen && d1 > 0.2; i++) {
    s.step(0.1);
    const a = seen.a;
    dev = Math.max(dev, Math.abs(((a.x - stop.x) * uz - (a.z - stop.z) * ux) / uL));
    turn = Math.max(turn, Math.abs(Math.atan2(Math.sin(a.heading - seen.h), Math.cos(a.heading - seen.h))));
    d1 = Math.min(d1, Math.hypot(a.x - exit.x, a.z - exit.z));
  }
  check('AMR 은 리프트 밑에서 출구로 직진(옆 벗어남 < 5 cm · 회전 < 0.05 rad · 출구 도달)', !!seen && dev < 0.05 && turn < 0.05 && d1 <= 0.2 && d0 > 4,
    `옆 ${dev.toFixed(3)} m · 회전 ${turn.toFixed(3)} · 출구까지 ${d0.toFixed(2)}→${d1.toFixed(2)} m`);
}

// ── SORT 입고: 키트는 랙에 생기지 않고, AMR 이 랙 뒤(SORT:RAW)에 하역해야 협동로봇이 랙에 올린다 ──
{
  const s = run(0);
  check('시작 때 SORT 랙 비어 있음', s.plant.rack.items.every((e) => !e));
  const sw = s.plant.work.SORT;
  const raw = s.acs.cells['SORT:RAW']?.stops.at(-1);
  const dual = s.acs.cells.SORT?.stops.at(-1);
  let seen = null, slid = 0;
  for (let i = 0; i < 4000 && !seen; i++) {
    s.step(0.1);
    if (s.plant.parts.list().some((e) => e.type === 'kit' && e.holder.k === 'rack') && !sw.inDone) {
      seen = 'spawn'; break;
    }
    if (sw.op) slid = Math.max(slid, Math.abs(sw.car.s));
    const a = s.amrs.find((x) => x.ticket && x.ticket === sw.ticket && sw.ticket.kind === 'unload');
    if (a && sw.ticket.started) seen = { a, T: sw.ticket, task: a.task };
  }
  check('입고 하역 중 AMR 라벨 「SORT 하역」 · 랙에 먼저 생기지 않음', !!seen && seen !== 'spawn' && seen.task.startsWith('SORT 하역'), typeof seen === 'string' ? seen : seen?.task);
  check('입고 AMR 은 랙 뒤(SORT:RAW)에 선다 · 북쪽 듀얼 도크가 아님', !!seen && seen !== 'spawn' && raw && dual
    && Math.hypot(seen.a.x - raw.x, seen.a.z - raw.z) < 0.4
    && Math.hypot(seen.a.x - dual.x, seen.a.z - dual.z) > 2
    && seen.a.z < dual.z, seen === 'spawn' ? seen : seen && `xy ${seen.a.x.toFixed(2)} ${seen.a.z.toFixed(2)}`);
  let left = null;
  for (let i = 0; i < 300 && seen && seen !== 'spawn'; i++) {
    const x = seen.a.x, z = seen.a.z;
    s.step(0.1);
    if (sw.op) slid = Math.max(slid, Math.abs(sw.car.s));
    if (Math.hypot(seen.a.x - x, seen.a.z - z) > 1e-6) { left = { released: seen.T.released, gripped: seen.T.gripped, onRack: s.plant.rack.items.includes(seen.T.kit) }; break; }
  }
  check('입고 AMR 은 집어 든(released) 뒤 출발', !!left && left.gripped && left.released, JSON.stringify(left));
  for (let i = 0; i < 200 && sw.op; i++) s.step(0.1);
  check('협동로봇이 키트를 랙에 올림 · 입고 횟수 > 0', sw.inDone > 0 && s.plant.rack.items.some(Boolean) && s.plant.kits.length > 0, `inDone ${sw.inDone} kits ${s.plant.kits.length}`);
}

// ── SORT: AMR 은 양팔이 키트를 적재면에 놓은 뒤에 떠난다 · 적재 중 몸통이 돌고 대차가 움직인다 ──
{
  const s = run(0);
  const sw = s.plant.work.SORT;
  let seen = null, turned = 0, slid = 0;
  for (let i = 0; i < 8000 && !seen; i++) {
    s.step(0.1);
    if (sw.op && sw.ticket?.kind === 'load') { turned = Math.max(turned, Math.abs(sw.car.w)); slid = Math.max(slid, Math.abs(sw.car.s)); }
    const a = s.amrs.find((x) => x.ticket && x.ticket === sw.ticket && sw.ticket.kind === 'load');
    if (a && sw.ticket.started) seen = { a, T: sw.ticket, task: a.task };
  }
  check('적재 중 AMR 라벨 「SORT 적재」', !!seen && seen.task.startsWith('SORT 적재'), seen?.task);
  let left = null;
  for (let i = 0; i < 300 && seen; i++) {
    const x = seen.a.x, z = seen.a.z;
    s.step(0.1);
    if (sw.op) { turned = Math.max(turned, Math.abs(sw.car.w)); slid = Math.max(slid, Math.abs(sw.car.s)); }
    if (Math.hypot(seen.a.x - x, seen.a.z - z) > 1e-6) { left = { released: seen.T.released, holder: seen.a.load?.e?.holder }; break; }
  }
  check('AMR 은 키트가 적재면에 놓인(released) 뒤 출발 · 키트 소유자 = 그 AMR', !!left && left.released && left.holder?.k === 'amr' && left.holder.id === seen.a.id, JSON.stringify(left));
  check('적재 동작: 몸통 반 바퀴 가까이 회전 · 대차 이동', turned > 2.5 && slid > 0.3, `w ${turned.toFixed(2)} rad · s ${slid.toFixed(2)} m`);
  // 팔이 복귀하는 중에 다음 AMR 이 낸 적재 티켓은 앞 동작이 끝날 때 지워지면 안 된다(장시간 정지 원인)
  while (sw.op && !sw.op.T.released) s.step(0.1);
  const T0 = sw.ticket, next = sw.load(sw.rack.items.find((e) => e) ?? null, { k: 'amr', id: 'X' }, { x: 0, z: 0 }, () => {});
  while (sw.op && sw.op.T === T0) sw.step(0.1, false);
  check('앞 적재 동작이 끝나도 다음 AMR 티켓은 남는다', !!T0 && sw.ticket === next || next.started, `ticket ${sw.ticket === next} started ${next.started}`);
}

// ── 2시간 소크(공정 + rig): 교착 없음 · 위반 0 ──
{
  const s = run(0);
  const win = [], winS = [], winO = [];
  let prevDone = 0, prevS = 0, prevO = 0, maxParts = 0, minLeft = Infinity, minGap = Infinity, crossBad = 0;
  const filled = new Map();   // 라인 → 첫 토트가 채운 시각(s). 시작 재고 0이라 그 뒤부터 비지 않는지 본다.
  const P = s.plant, X = P.acs.cross[0], trim = P.acs.amrs, sub = P.supply.acs.amrs;
  for (let k = 0; k < 12; k++) {
    for (let i = 0; i < 6000; i++) {
      s.step(0.1);
      if (i % 50 === 0) maxParts = Math.max(maxParts, P.parts.items.size);
      for (const x of P.supply.lines) {
        if (!filled.has(x.dock) && x.L.left > 0) filled.set(x.dock, k * 600 + i / 10);
        else if (filled.has(x.dock)) minLeft = Math.min(minLeft, x.L.left);
      }
      if (P.allAmrs.filter((a) => Math.hypot(a.x - X.x, a.z - X.z) < X.r - 0.05).length > 1) crossBad++;
      for (const a of trim) for (const b of sub) if (Math.hypot(a.x - b.x, a.z - b.z) < 2) minGap = Math.min(minGap, bodyGap(a, b));
    }
    const d = s.plant.work.PRESS.done, e = s.plant.work.SCREW.done, o = s.plant.outbound;
    win.push(d - prevDone); prevDone = d;
    winS.push(e - prevS); prevS = e;
    winO.push(o - prevO); prevO = o;
  }
  const cw = s.plant.work.PRESS, cs = s.plant.work.SCREW;
  // 시작 재고 0 이라 PRESS 첫 완료가 10분을 넘길 수 있다(부품 토트 대기). 그 다음 창이 비면 교착이다.
  check('2 h: 10분 창마다 PRESS·SCREW 완료 > 0 · 완료품 적재 > 0(교착 없음)', (win[0] > 0 || win[1] > 0) && win.slice(1).every((n) => n > 0) && winS.every((n) => n > 0) && (winO[0] > 0 || winO[1] > 0) && winO.slice(1).every((n) => n > 0), `PRESS ${win.join(',')} SCREW ${winS.join(',')} OUT ${winO.join(',')}`);
  check('2 h: 소유 위반 0 · 잠금 위반 0 · 구역 진입 0(PRESS·SCREW)', s.plant.parts.violationCount === 0 && cw.lockFaults === 0 && cw.intrude === 0 && cs.lockFaults === 0 && cs.intrude === 0,
    `viol ${s.plant.parts.violationCount} PRESS ${cw.lockFaults}/${cw.intrude} SCREW ${cs.lockFaults}/${cs.intrude} ${cs.lastIntrude ?? ''}`);
  check('2 h: 엔티티 수 유한(적재대는 묶음 출하로 비운다 · 완료 키트 = 도어트림 + 부품 8)', maxParts < 160 && s.plant.work.OUT.batches >= 2, `최대 ${maxParts} · 출하 ${s.plant.work.OUT.batches}회`);
  const [s1, s2] = cs.passDone, made = s2, out = s.plant.outbound;
  check('2 h: 공정 순서대로 줄어든다(SCREW 1차 ≥ PRESS ≥ SCREW 2차 ≥ 적재) · 완료품은 사라지지 않고 적재 구역으로(차이 ≤ 운반 중 2)',
    s1 >= cw.done && cw.done >= s2 && made - out >= 0 && made - out <= 2, `SCREW ${s1}/${s2} · PRESS ${cw.done} · 적재 ${out}`);
  const first = Math.max(...filled.values());
  check('2 h: 시작 재고 0 → 라인 8곳 모두 12분 안에 첫 토트 · 그 뒤 팔레트가 비지 않는다', P.supply.delivered >= 40 && filled.size === P.supply.lines.length && first < 720 && minLeft > 0,
    `토트 ${P.supply.delivered} · 첫 토트 마지막 ${first.toFixed(0)} s · 이후 팔레트 최소 ${minLeft}`);
  check('2 h: 교차로 구역 안 동시에 1대(두 플릿 합쳐) · 도어트림↔부품 AMR 차체 간격 > 0.3 m', crossBad === 0 && minGap > 0.3, `겹침 ${crossBad} · 최소 ${minGap.toFixed(2)} m`);
}

// ── 부속 부품 AMR: 따로 루트·플릿 · 교차로 하나를 두 ACS 가 같이 잡는다 · 토트 창고 → AMR → 라인 팔레트 ──
{
  const s = new ViewerState({ scenario: 'supply', quiet: true, process: doc });
  const P = s.plant, U = doc.supply;
  check('플릿 둘: 도어트림 6 · 부품 3(id 머리 P-AMR) · state.amrs 는 둘 다', P.acs.amrs.length === 6 && P.supply.acs.amrs.length === 3
    && P.supply.acs.amrs.every((a) => a.id.startsWith('P-AMR-')) && s.amrs.length === 9 && s.fleet('parts').amrs === P.supply.acs.amrs);
  const X = P.acs.cross, xz = X.map(({ x, z, r }) => ({ x, z, r }));
  const has = (x, z) => X.some((Z) => Math.abs(Z.x - x) < 0.05 && Math.abs(Z.z - z) < 0.05);
  check('공유 구역(x 11 지선 × 북쪽 부품 통로 · SORT 서쪽·동쪽 접속 · 동쪽 반출 지선) · 두 ACS 같은 구역 객체',
    X.length >= 3 && X.every((Z) => P.supply.acs.cross.includes(Z)) && has(11, 5.4) && has(-22.6, -2.08) && has(-2.9, -1.975), JSON.stringify(xz));
  check('SORT 잠금은 두 플릿이 같은 객체 · 서로 peers', P.acs.locks.SORT === P.supply.acs.locks.SORT && P.acs.peers.includes(P.supply.acs) && P.supply.acs.peers.includes(P.acs));
  check('부품 그래프: PRESS·SCREW·OUT 셀 도크 없음 · SORT(레인) · SORT:IN(투입) 있음 · 도어트림 그래프에 창고·라인·투입 도크 없음',
    !['PRESS', 'SCREW', 'OUT'].some((id) => P.supply.acs.cells[id]) && !!P.supply.acs.cells.SORT && !!P.supply.acs.cells['SORT:IN']
    && !Object.keys(P.acs.cells).some((id) => id === 'PARTS' || id === 'SORT:IN' || id.includes(':L'))
    && !!P.acs.cells['SORT:RAW']);
  const F = P.supply.feed;
  check('레인 = 라인 쪽: A PRESS 북 · B PRESS 남 · C SCREW 북 · D SCREW 남 · 미배정 라인 없음',
    F.laneOf('PRESS:L03').id === 'A' && F.laneOf('PRESS:L01').id === 'B' && F.laneOf('SCREW:L04').id === 'C' && F.laneOf('SCREW:L02').id === 'D' && !P.supply.unserved?.length);
  const L = P.work.PRESS.lineOf.L01;
  check('라인 팔레트 시작 수 = supply.start(0) · 보이는 부품 없음', P.supply.lines.every((x) => x.L.left === (U.start ?? 0) && !x.L.stock && !x.L.items.length), P.supply.lines.map((x) => x.L.left).join(','));
  check('PRESS·SCREW 시작 키트 0 · 첫 움직임은 운송 AMR', P.units.PRESS.stock === 0 && P.units.SCREW.stock === 0 && !['PRESS', 'SCREW'].some((id) => P.work[id].lift.kit));
  const path = [], fetchers = new Set(), lane = { amr: null, stop: null };
  let step = null, beltStall = 0, maxBelt = 0, dumped = null, onRail = null, fromBox = null;
  for (let i = 0; i < 12000; i++) {
    const was = { left: L.left, incoming: L.incoming };
    s.step(0.1);
    const t = [...P.parts.items.values()].find((e) => e.type === 'tote' && e.dock === 'PRESS:L01');
    const H = t?.holder;
    const k = H ? (H.k === 'belt' ? `belt:${H.line}` : H.k === 'xfer' ? `xfer:${H.t}` : H.k === 'amr' ? `amr:${H.id}` : H.k) : null;
    if (k && k !== 'move' && path.at(-1) !== k) path.push(k);
    for (const x of F.belt) if (x.lane && x.x < x.lane.x - 1e-6 && !x.moving) beltStall = Math.max(beltStall, (x.st = (x.st ?? 0) + 0.1)); else x.st = 0;
    maxBelt = Math.max(maxBelt, F.belt.length);
    for (const a of P.supply.acs.amrs) if (a.at?.kind === 'cell' && a.at.id === 'SORT' && a.load?.e?.dock === 'PRESS:L01') { lane.amr = a.id; lane.stop = a.at.stop; }
    if (was.incoming === 1 && L.incoming === 0 && step == null) {
      step = L.left - was.left;
      dumped = t;
    }
    if (t?.holder.k === 'line') onRail = t;
    if (t && t.n < U.qty) fromBox = t;
    if (H?.k === 'amr' && path.length <= 2) fetchers.add(H.id);
    if (step != null && onRail && fromBox && i > 2000) break;
  }
  const iB = path.indexOf('belt:main'), iL = path.indexOf('belt:B');
  check('토트 경로: 부품 AMR → 투입 이송기 → 컨베이어 → 레인 B → 내림 이송기 → 레인 AMR',
    path[0]?.startsWith('amr:P-AMR-') && path[1]?.startsWith('xfer:') && iB > 1 && iL > iB && path[iL + 1]?.startsWith('xfer:') && path[iL + 2]?.startsWith('amr:P-AMR-'), path.join(' → '));
  check('레인 AMR 은 SORT 레인 B 칸(정차 칸 3번째 레인)에서 받는다', lane.amr != null && lane.stop === 3, JSON.stringify(lane));
  check('팔레트 보충 +qty', step === U.qty, `보충 ${step}`);
  check('덤프 뒤 토트가 남음(작은 부품으로 안 바뀜)', dumped?.type === 'tote' && (dumped.holder.k === 'stock' || dumped.holder.k === 'gantry' || dumped.holder.k === 'line') && dumped.n > 0, dumped ? `${dumped.holder.k} n=${dumped.n}` : '없음');
  check('직교이송이 토트를 롤러에 올림', onRail?.type === 'tote' && onRail.holder.k === 'line', onRail ? `n=${onRail.n} s=${onRail.holder.s}` : '없음');
  check('협동로봇이 상자에서 부품을 집음 · 소유 위반 0', fromBox?.n < U.qty && P.parts.violationCount === 0, fromBox ? `n ${fromBox.n}` : '집기 없음');
  check('컨베이어: 분류된 토트가 제 레인 앞까지 막힘 없이(30 s 넘게 안 섬)', beltStall < 30, `최장 정지 ${beltStall.toFixed(1)} s · 최대 ${maxBelt}개`);
  const bad = clone(doc); bad.supply.reorder = bad.supply.qty;
  check('supply.reorder ≥ qty 는 오류', validateProcess(bad).some((e) => e.includes('reorder')));
  const b2 = clone(doc); b2.supply.batch = 5;
  check('supply.batch 1–4 밖은 오류', validateProcess(b2).some((e) => e.includes('batch')));
  const b3 = clone(doc); b3.cells.SORT.feed.lanes[1].to.push('PRESS:L03');
  check('feed: 한 도크가 두 레인이면 오류', validateProcess(b3).some((e) => e.includes('PRESS:L03')), validateProcess(b3).join(' · '));
}

// ── Admin 부품 AMR 도킹 자리 편집: 옮긴 도크에 실제로 서고 · 축에서 벗어나면 경고 ──
{
  const base = defaultLayout();
  const lay = clone(base);
  lay.parts.cells['PRESS:L01'].stops[0].x += 0.3;
  const want = toWorld(placeOf(lay, 'PRESS:L01'), lay.parts.cells['PRESS:L01'].stops[0]);
  const s = new ViewerState({ scenario: 'supply', quiet: true, process: doc, layout: normalizeLayout(lay) });
  let best = Infinity;
  for (let i = 0; i < 9000 && best > 0.05; i++) {
    s.step(0.1);
    for (const a of s.plant.supply.acs.amrs) if (a.inBranch === 'PRESS:L01' && !a.moving) best = Math.min(best, Math.hypot(a.x - want.x, a.z - want.z));
  }
  check('옮긴 라인 도크(PRESS:L01 +0.3 m)에 부품 AMR 이 선다', best < 0.05, `도크까지 ${best.toFixed(3)} m`);
  check('기본 도킹 자리: 경고 없음', dockIssues(normalizeLayout(base), doc).length === 0, dockIssues(normalizeLayout(base), doc).join(' · '));
  const off = clone(base);
  off.parts.cells['SORT:IN'].stops[0].z += 0.5;
  off.parts.cells['SCREW:L02'].stops[0].x += 1;
  off.amr.cells.SORT.stops.splice(3, 1);
  const w = dockIssues(off, doc);
  check('경고: SORT:IN 이송기 축 밖 · 라인 도크 1 m 옆 · 레인 B 칸 없음(정규화 전)', w.some((t) => t.startsWith('SORT:IN')) && w.some((t) => t.startsWith('SCREW:L02')) && w.some((t) => t.includes('레인 B')), w.join(' · '));
  check('정규화는 지운 SORT 레인 칸을 다시 끼운다', normalizeLayout(off).amr.cells.SORT.stops.length === 7);
}

// ── SORT 분류 이송기: 컨베이어 높이 · 레인 위치 · 갠트리 노드 ──
{
  const s = new ViewerState({ scenario: 'supply', quiet: true, process: doc });
  const F = s.plant.supply.feed, FD = doc.cells.SORT.feed;
  check('레인 x 는 투입 낙하점보다 하류 · 레인마다 분기·내림 이송기', FD.lanes.every((l) => l.x > FD.infeed.drop.x) && F.lanes.every((L) => L.div.name && L.hand.name));
  let up = 0, maxY = -Infinity;
  for (let i = 0; i < 6000; i++) { s.step(0.1); for (const T of F.transfers) maxY = Math.max(maxY, T.y); up = Math.max(up, F.handed); }
  check('10분 안에 레인 내림 > 0 · 이송기 높이는 컨베이어 위', up > 0 && maxY >= FD.conveyor.y, `내림 ${up} · 최고 y ${maxY.toFixed(2)}`);
}

// ── 4시간 · 고장 시나리오: 도어트림·부품 플릿 모두 교착 없음 ──
{
  const s = new ViewerState({ scenario: 'faults', quiet: true, process: doc });
  const P = s.plant, rows = [];
  let prev = [0, 0, 0];
  for (let k = 0; k < 24; k++) {
    for (let i = 0; i < 6000; i++) s.step(0.1);
    const now = [P.work.PRESS.done, P.work.SCREW.done, P.supply.delivered];
    rows.push(now.map((v, j) => v - prev[j]));
    prev = now;
  }
  check('4 h 고장 시나리오: 10분 창마다 PRESS·SCREW 완료 > 0 · 30분마다 토트 > 0', (rows[0][0] > 0 || rows[1][0] > 0) && rows.slice(1).every((r) => r[0] > 0 && r[1] > 0) && rows.every((_, i) => i % 3 || rows.slice(i, i + 3).some((r) => r[2] > 0)) && P.parts.violationCount === 0,
    rows.map((r) => r.join('/')).join(' '));
}

// ── 반출(hop): 빈 메인 AMR 이 들린 지그 밑에 섬 → 내려 안착 · 클립 풀고 출발 → 다음 칸은 공정 순서대로 ──
{
  const s = run(0);
  const P = s.plant, cs = P.work.SCREW, lay = defaultLayout();
  const stop = toWorld(placeOf(lay, 'SCREW'), lay.amr.cells.SCREW.stops.at(-1));
  let seen = null;
  for (let i = 0; i < 18000 && !seen; i++) {
    s.step(0.1);
    const T = cs.out;
    const a = T && s.amrs.find((x) => x.ticket === T);
    if (a && T.started && !T.released) seen = { a, T, task: a.task, x: a.x, z: a.z, pass: cs.lift.pass };
  }
  check('반출 AMR 라벨 「SCREW 지그 내림」 · 리프트 자리(지그 밑)에 섬', !!seen && seen.task.startsWith('SCREW 지그 내림') && Math.hypot(seen.x - stop.x, seen.z - stop.z) < 0.05,
    seen ? `${seen.task} @${seen.x.toFixed(2)},${seen.z.toFixed(2)}` : '없음');
  let left = null;
  for (let i = 0; i < 200 && seen; i++) {
    const x = seen.a.x, z = seen.a.z;
    s.step(0.1);
    if (Math.hypot(seen.a.x - x, seen.a.z - z) > 1e-6) {
      const e = seen.a.load?.e;
      left = { loaded: seen.T.loaded, released: seen.T.released, holder: e?.holder, next: P.nextOf(e), lift: cs.lift.phase };
      break;
    }
  }
  check('AMR 은 지그가 안착·클립 풀린(released) 뒤 출발 · 키트 소유자 = 그 AMR · 리프트 빔', !!left && left.loaded && left.released && left.holder?.k === 'amr' && left.holder.id === seen.a.id && left.lift === 'empty', JSON.stringify(left));
  check('SCREW 1차(pass 0) 뒤 다음 칸 = PRESS', !!left && seen.pass === 0 && left.next === 'PRESS', `pass ${seen?.pass} → ${left?.next}`);
}

// ── 공정 순서 추적: 키트마다 SCREW 1차 → PRESS → SCREW 2차 → 적재 구역 · 적재 구역에서 도어트림만 내리고 빈 지그는 AMR 이 충전 자리로 가져간다 ──
{
  const s = run(0, { withRig: false });
  const P = s.plant, O = P.work.OUT, trace = new Map(), last = new Map(), jigOn = new Map();
  let jigs = 0, jigHome = 0, jigBad = [], maxJig = 0, slotJig = false, onAmr = 0;
  for (let i = 0; i < 36000; i++) {
    s.step(0.1);
    let nJ = 0;
    for (const e of P.parts.list()) {
      if (e.type === 'jig') {
        nJ++;
        if (!jigOn.has(e.id)) { jigs++; if (e.holder.k === 'amr') onAmr++; }
        jigOn.set(e.id, e.holder.id);
        continue;
      }
      if (e.type !== 'kit') continue;
      const H = e.holder, k = H.k === 'lift' && P.work[H.cell].lift.phase === 'work' ? `${H.cell}/${P.work[H.cell].lift.pass}` : H.k === 'outslot' ? 'OUT' : null;
      if (k && last.get(e.id) !== k) { last.set(e.id, k); trace.set(e.id, [...(trace.get(e.id) ?? []), k]); }
      if (H.k === 'outslot' && e.jig) slotJig = true;
    }
    maxJig = Math.max(maxJig, nJ);
    for (const [id, amr] of jigOn) {
      if (P.parts.get(id)) continue;
      jigOn.delete(id);
      const a = P.acs.amrs.find((x) => x.id === amr);
      if (a?.at?.kind === 'home' && !a.keep) jigHome++; else jigBad.push(`${id}@${amr}:${a?.at?.kind}`);
    }
  }
  const want = 'SCREW/0,PRESS/0,SCREW/1,OUT', all = [...trace.values()].map((t) => t.join());
  const full = all.filter((t) => t === want).length, bad = all.filter((t) => !want.startsWith(t));
  check('공정 순서: 적재 구역까지 간 키트는 모두 SCREW 1차 → PRESS → SCREW 2차 → OUT · 순서 어긋난 키트 0', full >= 8 && bad.length === 0 && all.filter((t) => t.endsWith('OUT')).length === full,
    `완료 ${full} · 어긋남 ${bad.slice(0, 3).join(' | ')}`);
  check('적재대 칸에는 도어트림만(지그 없음) · 빈 지그는 AMR 위에 생긴다', !slotJig && jigs >= 8 && onAmr === jigs, `지그 ${jigs} · AMR 위 ${onAmr}`);
  check('빈 지그는 AMR 이 충전 자리에 도착해서 내린다(쌓이지 않음 · 동시에 플릿 수 이하)', jigHome >= jigs - maxJig && jigBad.length === 0 && maxJig <= P.acs.amrs.length,
    `내림 ${jigHome}/${jigs} · 최대 ${maxJig} ${jigBad.slice(0, 3).join(' ')}`);
  check('적재 수 = 추적 완료 수', Math.abs(P.outbound - full) <= 1, `outbound ${P.outbound} · 추적 ${full}`);
}

console.log(`  ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
