// GLB 검사: 헤더(magic·version·length)와 기본 씬 루트 노드 이름 = 셀 id.
// M-1: 정점·행렬로 셀 프레임·운동 그룹·기본 AMR 지점을 헤드리스로 확인한다.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readGlb, checkCellGlb } from '../server/glb.mjs';
import { cellFrame, readGlb as readGlbFull, subtreeBox, subtreePoints, walkNodes } from '../js/assets/glb.js';
import { scanGlb } from '../js/assets/scan-glb.js';
import { CELLS } from '../js/sim/cells.js';
import { FOOTPRINT } from '../js/sim/layout.js';
import { DEFAULT_AMR, SORT_LANE_X } from '../js/sim/amrdata.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('glb');
const dir = fileURLToPath(new URL('../src/render_asset/', import.meta.url));
for (const c of CELLS) {
  const buf = await readFile(`${dir}${c.asset}.glb`);
  const r = checkCellGlb(buf, c.id);
  check(`${c.asset}.glb 헤더·루트 = ${c.id}`, r.ok, r.ok ? `roots=${r.roots.join(',')}` : r.errors.join(' · '));
}

const bad = new Uint8Array(24);
check('짧거나 magic 아닌 버퍼 거부', readGlb(new Uint8Array(8)).errors.length > 0 && readGlb(bad).errors.some((e) => e.includes('magic')));

const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }], nodes: [{ name: 'A' }, { name: 'B' }] }));
const pad = (4 - (json.length % 4)) % 4;
const glb = new Uint8Array(20 + json.length + pad);
const dv = new DataView(glb.buffer);
dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, glb.length, true);
dv.setUint32(12, json.length + pad, true); dv.setUint32(16, 0x4e4f534a, true);
glb.set(json, 20); glb.fill(0x20, 20 + json.length);
const two = checkCellGlb(glb, 'A');
check('루트 2개면 실패', !two.ok && two.errors[0].includes('2개'));

// ── M-1: 정점·노드 행렬을 직접 읽어 셀 프레임·운동 그룹·AMR 지점을 확인한다(렌더 없이) ──
const glbs = {};
for (const c of CELLS) glbs[c.id] = readGlbFull(await readFile(`${dir}${c.asset}.glb`));
const near = (a, b, tol) => Math.abs(a - b) <= tol;

for (const c of CELLS) {
  const { json, bin } = glbs[c.id];
  const f = cellFrame(json), fp = FOOTPRINT[c.id];
  check(`${c.id} 셀 프레임 크기 = FOOTPRINT`, near(f.size[0], fp.w, 0.01) && near(f.size[2], fp.d, 0.01), `${f.size.map((v) => v.toFixed(2)).join('×')}`);
  const nodes = walkNodes(json);
  const root = nodes.find((n) => n.parent === -1);
  const pts = subtreePoints(json, bin, nodes, root.index, { cap: 1e7 });
  let minY = Infinity, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < pts.length; i += 3) { minY = Math.min(minY, pts[i + 1]); minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]); }
  check(`${c.id} 정점 바닥 = y 0 (오프셋 후)`, near(minY + f.offset[1], 0, 0.005) && near((minX + maxX) / 2 + f.offset[0], 0, 0.005), `minY=${(minY + f.offset[1]).toFixed(4)}`);
}

const scans = Object.fromEntries(CELLS.map((c) => [c.id, scanGlb(glbs[c.id].json, glbs[c.id].bin)]));
const kinds = (id, k) => scans[id].filter((m) => m.kind === k);
check('PRESS 로봇 팔 5대 · 관절 5개씩', kinds('PRESS', 'arm').length === 5 && kinds('PRESS', 'arm').every((m) => m.plan.arm.joints.length === 5),
  kinds('PRESS', 'arm').map((m) => `${m.name}:${m.plan.arm.joints.length}`).join(' '));
check('SCREW 로봇 팔 6대', kinds('SCREW', 'arm').length === 6);
check('SORT 바퀴 AMR 6대 · 양팔 2', kinds('SORT', 'amr').length === 6 && kinds('SORT', 'arm').length === 2, kinds('SORT', 'amr').map((m) => m.name).join(' '));

// 기본 AMR 지점(셀 로컬)이 GLB 그룹 자리와 맞는지
const groupBox = (id, name) => {
  const { json } = glbs[id];
  const nodes = walkNodes(json), f = cellFrame(json);
  // 블렌더 내보내기 접미사(.001 · _P_HDL)가 붙는다 — 루트 바로 아래 그룹에서 이름 앞부분으로 찾는다
  const root = nodes.find((n) => n.parent === -1);
  const top = nodes.filter((n) => n.parent === root.index);
  const nd = top.find((n) => n.name === name) ?? top.find((n) => n.name.startsWith(`${name}.`) || n.name.startsWith(`${name}_`));
  if (!nd) return null;
  const b = subtreeBox(json, nodes, nd.index);
  const min = b.min.map((v, k) => v + f.offset[k]), max = b.max.map((v, k) => v + f.offset[k]);
  return { min, max, cx: (min[0] + max[0]) / 2, cz: (min[2] + max[2]) / 2 };
};
const A = DEFAULT_AMR.cells;
const w2 = groupBox('SORT', 'AMR_waiting_2'), w3 = groupBox('SORT', 'AMR_waiting_3'), dual = groupBox('SORT', 'AMR_dual_pickup');
const at = (p, g) => g && near(p.x, g.cx, 0.05) && near(p.z, g.cz, 0.05);
check('SORT 대기 칸 = AMR_waiting_2 · 3, 도크 = AMR_dual_pickup', at(A.SORT.stops[0], w2) && at(A.SORT.stops[1], w3) && at(A.SORT.stops.at(-1), dual));
{
  const laneB = groupBox('SORT', 'AMR_pickup_lane_B');
  check('SORT 레인 정지점 A–D = 대기 칸과 듀얼 사이 · 레인 B = AMR_pickup_lane_B', A.SORT.stops.length === 7
    && A.SORT.stops.slice(2, 6).every((p, i) => near(p.x, SORT_LANE_X[i], 0.01))
    && (!laneB || near(A.SORT.stops[3].x, laneB.cx, 0.1)), laneB ? `lane B ${laneB.cx.toFixed(2)} vs ${A.SORT.stops[3].x}` : 'AMR_pickup_lane_B 없음');
}
for (const id of ['PRESS', 'SCREW']) {
  // 셀 GLB 의 AMR_MAIN_JIG = 메인 AMR(이송 AMR + 지그 상판). 그 자리가 리프트 정차 칸 — AMR 은 서쪽에서 들어와 동쪽으로 직진해 나간다.
  const main = groupBox(id, 'AMR_MAIN_JIG'), lane = groupBox(id, 'AMR_route');
  const stop = A[id].stops.at(-1), C = A[id];
  check(`${id} 리프트 정차 칸 = AMR_MAIN_JIG 중심 · AMR_route 통로 안`, main && lane && C.stops.length === 1 && near(stop.x, main.cx, 0.05) && near(stop.z, main.cz, 0.05)
    && stop.z >= lane.min[2] && stop.z <= lane.max[2], main ? `main ${main.cx.toFixed(3)},${main.cz.toFixed(3)} · stop ${stop.x},${stop.z}` : 'AMR_MAIN_JIG 없음');
  check(`${id} 통과 셀: 입구 서쪽 끝 · 출구 동쪽 끝(같은 축 · 되돌아 나가지 않음) · 반출 도크 따로 없음`, lane && C.entry.x <= lane.min[0] + 0.1 && C.exit && C.exit.x >= lane.max[0] - 0.1
    && C.entry.z === stop.z && C.exit.z === stop.z && !A[`${id}:OUT`], `entry ${C.entry.x} exit ${C.exit?.x} lane ${lane?.min[0].toFixed(2)}..${lane?.max[0].toFixed(2)}`);
}

{
  const { json, errors } = readGlbFull(await readFile(`${dir}quadruped.glb`));
  const names = new Set((json.nodes ?? []).map((n) => n.name));
  const joints = ['Body', 'Hip_0', 'Hip_1', 'Hip_2', 'Hip_3', 'Knee_0', 'Knee_1', 'Knee_2', 'Knee_3'];
  check('quadruped.glb 헤더', errors.length === 0);
  check('사족 관절 이름(Body·Hip·Knee)', joints.every((n) => names.has(n)), joints.filter((n) => !names.has(n)).join(',') || 'ok');
}

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
