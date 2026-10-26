// 셀 GLB → 운동 기구 평범한 데이터(셀 로컬 좌표). three·DOM 없음. main 이 sim(기구학)과 render(피벗 조립)에 같은 값을 넘긴다.
// 좌표는 cellFrame 오프셋을 더한 셀 로컬(바닥 y=0, xz 중심 0). 부품은 GLB 노드 index 로 가리킨다(이름은 로더가 바꿀 수 있어서).
import { cellFrame, isEmpty, subtreeBox, walkNodes } from './glb.js';
import { scanGlb } from './scan-glb.js';
import { pointOnTrack } from './movers.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function cellRig(json, bin, { frame = cellFrame(json) } = {}) {
  if (!frame) return null;
  const off = frame.offset;
  const L = (p) => [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
  const movers = scanGlb(json, bin);
  const tracks = movers.filter((m) => m.kind === 'track').map((m) => ({
    name: m.name, node: m.index, axis: m.plan.axis, origin: L(m.plan.origin), span: m.plan.span, halfWidth: m.plan.halfWidth, plan: m.plan,
  }));
  const arms = movers.filter((m) => m.kind === 'arm').map((m) => {
    const a = m.plan.arm;
    const base = a.joints[0]?.origin;
    let track = -1, best = Infinity;
    tracks.forEach((t, i) => {
      const hit = base && pointOnTrack(base, t.plan);
      if (hit?.on && hit.radial < best) { best = hit.radial; track = i; }
    });
    return {
      name: m.name,
      node: m.index,
      joints: a.joints.map((j) => ({ origin: L(j.origin), axis: j.axis, parent: j.parent, node: m.nodes[j.part] })),
      links: m.nodes.map((node, i) => ({ node, joint: a.link[i] })),
      tcp: a.tcp ? { joint: a.tcp.joint, point: L(a.tcp.point), approach: a.tcp.approach, reach: a.tcp.reach } : null,
      track,
    };
  });
  const all = walkNodes(json);
  const gantries = movers.filter((m) => m.kind === 'gantry').map((m) => {
    const g = m.plan;
    const low = Math.min(...g.tool.map((t) => subtreeBox(json, all, m.nodes[t.i])).filter((b) => !isEmpty(b)).map((b) => b.min[1]));
    const work = g.work ? { node: m.nodes[g.work.i], size: g.work.size, top: g.work.top + off[1], bottom: g.work.bottom + off[1], pads: g.work.pads + off[1], center: L(g.work.center) } : null;
    const toolNodes = g.tool.map((t) => m.nodes[t.i]);
    return {
      name: m.name,
      node: m.index,
      horiz: g.horiz,
      up: g.up,
      origin: L(g.origin),
      toolOrigin: L(g.toolOrigin),
      travel: g.travel.map((v) => v + dot(off, g.horiz)),
      lift: g.lift.map((t) => m.nodes[t.i]),
      tool: toolNodes,
      work,
      // 공구 밑면(작업물 제외) 높이 — 흡착 패드가 물건 윗면에 닿는 높이
      toolBottom: work ? work.pads : null,
      // 공구 맨 아래(작업물 없는 이송기의 흡착 패드 밑면) 높이
      toolLow: Number.isFinite(low) ? low + off[1] : null,
    };
  });
  const rollers = movers.filter((m) => m.kind === 'rollers').map((m) => {
    const r = m.plan;
    const rods = r.rollers.map((w) => ({ node: m.nodes[w.i], center: L(w.center), axis: w.axis, radius: w.radius, length: w.length }));
    const min = [0, 1, 2].map((k) => Math.min(...rods.map((w) => w.center[k] - (k === 1 ? w.radius : Math.abs(w.axis[k]) * w.length / 2))));
    const max = [0, 1, 2].map((k) => Math.max(...rods.map((w) => w.center[k] + (k === 1 ? w.radius : Math.abs(w.axis[k]) * w.length / 2))));
    return { name: m.name, node: m.index, axis: r.axis, rods, min, max, top: max[1] };
  });
  return { frame: { offset: off, size: frame.size }, arms, tracks: tracks.map(({ plan, ...t }) => t), gantries, rollers };
}

// 장비 id(STEP 그룹 이름) 비교: 블렌더 접미사(.001)는 뗀다.
export const baseName = (n) => String(n ?? '').replace(/\.\d+$/, '');
