// AMR 경로 기하: 셀 지점 → 필드 좌표, 루트 간선 접속, 그래프 최단 경로, 우측 통행 차로 폴리라인, 루트 점검. DOM·three 없음.
// 메인 루트 양방향 간선은 진행 방향 오른쪽으로 LANE 만큼 비켜 달린다(마주 오는 차와 1.4 m). 단방향 간선·접속선·셀 안은 중심선.
import { bounds, placeOf, toWorld } from './layout.js';

export const LANE = 0.7;
export const BODY_R = 0.62;   // fleet.js AMR.radius 와 같아야 한다
const MITER_MAX = 3;
export const LINK_MAX = 4;    // 셀 지점·충전 자리에서 루트까지 접속선 최대 길이(m)

const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.z);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const unit = (v) => { const l = len(v) || 1; return { x: v.x / l, z: v.z / l }; };
// 진행 방향 d 의 오른쪽(+x 진행이면 +z). heading = atan2(d.x, d.z) 규약과 같은 평면.
const right = (d) => ({ x: -d.z, z: d.x });

export const headingOf = (d) => Math.atan2(d.x, d.z);

// ── 셀 지점 ──
// geo.cells[id] = { id, entry, stops:[{x,z,heading}], exit|null, dead, cap }  (필드 좌표)
export function cellGeo(layout) {
  const out = {};
  for (const [id, c] of Object.entries(layout.amr.cells)) {
    const pose = placeOf(layout, id);
    if (!pose) continue;
    const entry = toWorld(pose, c.entry);
    const pts = c.stops.map((p) => toWorld(pose, p));
    const stops = pts.map((p, i) => {
      const prev = i ? pts[i - 1] : entry;
      return { ...p, heading: headingOf(unit(sub(p, prev))) };
    });
    const exit = c.exit ? toWorld(pose, c.exit) : null;
    out[id] = { id, entry, stops, exit, dead: !exit, cap: exit ? stops.length : 1 };
  }
  return out;
}

// ── 그래프 ──
export function graphOf(route) {
  const nodes = new Map(route.nodes.map((n) => [n.id, n]));
  const edges = route.edges.filter((e) => nodes.has(e.a) && nodes.has(e.b)).map((e, i) => ({ ...e, i, pa: nodes.get(e.a), pb: nodes.get(e.b) }));
  return { nodes, edges };
}

// 점 p 를 가장 가까운 간선에 수선으로 붙인다. { edge, t, point, d }
export function attach(graph, p) {
  let best = null;
  for (const e of graph.edges) {
    const ab = sub(e.pb, e.pa), L2 = ab.x * ab.x + ab.z * ab.z;
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - e.pa.x) * ab.x + (p.z - e.pa.z) * ab.z) / L2)) : 0;
    const point = { x: e.pa.x + ab.x * t, z: e.pa.z + ab.z * t };
    const d = dist(p, point);
    if (!best || d < best.d - 1e-9) best = { edge: e, t, point, d };
  }
  return best;
}

// 접속점 S 에서 T 까지 간선 위 경로. [{p, q, off}] 구간 목록 또는 null(도달 불가).
export function mainPath(graph, S, T) {
  if (!S || !T) return null;
  const segs = (pts, offs) => pts.slice(1).map((q, i) => ({ p: pts[i], q, off: offs[i] }));
  if (S.edge === T.edge) {
    const e = S.edge;
    if (!e.oneway || T.t >= S.t - 1e-9) return dist(S.point, T.point) < 1e-6 ? [] : segs([S.point, T.point], [!e.oneway && !e.center]);
  }
  // Dijkstra. 출발: S → 간선 끝점(단방향이면 b만). 도착: 끝점 → T(단방향이면 a만).
  const adj = new Map();
  const link = (u, v, e) => { if (!adj.has(u)) adj.set(u, []); adj.get(u).push({ v, e }); };
  for (const e of graph.edges) { link(e.a, e.b, e); if (!e.oneway) link(e.b, e.a, e); }
  const d = new Map(), prev = new Map(), done = new Set();
  const start = [];
  const se = S.edge;
  start.push({ id: se.b, w: dist(S.point, se.pb) });
  if (!se.oneway) start.push({ id: se.a, w: dist(S.point, se.pa) });
  for (const s of start) if (!d.has(s.id) || s.w < d.get(s.id)) { d.set(s.id, s.w); prev.set(s.id, { from: 'S', e: se }); }
  const te = T.edge;
  const ends = new Map([[te.a, dist(te.pa, T.point)]]);
  if (!te.oneway) ends.set(te.b, dist(te.pb, T.point));
  let best = null;
  while (true) {
    let u = null;
    for (const [k, w] of d) if (!done.has(k) && (u === null || w < d.get(u))) u = k;
    if (u === null) break;
    done.add(u);
    if (ends.has(u)) {
      const tot = d.get(u) + ends.get(u);
      if (!best || tot < best.tot) best = { tot, end: u };
    }
    if (best && d.get(u) >= best.tot) break;
    for (const { v, e } of adj.get(u) ?? []) {
      const w = d.get(u) + dist(graph.nodes.get(u), graph.nodes.get(v));
      if (!d.has(v) || w < d.get(v) - 1e-9) { d.set(v, w); prev.set(v, { from: u, e }); }
    }
  }
  if (!best) return null;
  const chain = [];
  for (let k = best.end; k !== 'S'; k = prev.get(k).from) chain.unshift({ id: k, e: prev.get(k).e });
  const pts = [S.point, ...chain.map((c) => graph.nodes.get(c.id)), T.point];
  const offs = [...chain.map((c) => !c.e.oneway && !c.e.center), !te.oneway && !te.center];
  return segs(pts, offs).filter((s) => dist(s.p, s.q) > 1e-6);
}

// 구간 목록 → 점 목록. 차로 구간은 오른쪽으로 LANE 비키고, 이웃 구간과는 연장선 교점(마이터)으로 잇는다.
export function polyline(segs) {
  const lines = segs.map((s) => {
    const d = unit(sub(s.q, s.p));
    const o = s.off ? right(d) : { x: 0, z: 0 };
    return { p: { x: s.p.x + o.x * LANE, z: s.p.z + o.z * LANE }, q: { x: s.q.x + o.x * LANE, z: s.q.z + o.z * LANE }, d, node: s.q };
  });
  if (!lines.length) return [];
  const out = [lines[0].p];
  for (let i = 0; i < lines.length - 1; i++) {
    const A = lines[i], B = lines[i + 1];
    const cr = A.d.x * B.d.z - A.d.z * B.d.x;
    if (Math.abs(cr) < 1e-6) {
      out.push(A.q);
      if (dist(A.q, B.p) > 1e-3) out.push(B.p);
      continue;
    }
    const t = ((B.p.x - A.p.x) * B.d.z - (B.p.z - A.p.z) * B.d.x) / cr;
    const X = { x: A.p.x + A.d.x * t, z: A.p.z + A.d.z * t };
    if (dist(X, A.node) <= MITER_MAX) out.push(X);
    else { out.push(A.q); out.push(B.p); }
  }
  out.push(lines[lines.length - 1].q);
  return out.filter((p, i) => i === 0 || dist(p, out[i - 1]) > 1e-3);
}

// 지점 A 에서 지점 B 까지(둘 다 루트 밖 지점). 접속선 → 메인 루트 → 접속선.
// 반환: { pts:[A, j1, …, jn, B], joinIn: 1, joinOut: pts.length-2 } 또는 null.
export function journey(graph, A, B) {
  const S = attach(graph, A), T = attach(graph, B);
  const main = mainPath(graph, S, T);
  if (!main) return null;
  const segs = [{ p: A, q: S.point, off: false }, ...main, { p: T.point, q: B, off: false }].filter((s) => dist(s.p, s.q) > 1e-6);
  const pts = polyline(segs);
  if (dist(pts[0], A) > 1e-3) pts.unshift({ ...A });
  if (dist(pts[pts.length - 1], B) > 1e-3) pts.push({ ...B });
  return { pts, joinIn: Math.min(1, pts.length - 1), joinOut: Math.max(0, pts.length - 2) };
}

export function pathLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

// pts 를 시작에서 거리 at 지점에서 자른다. [앞쪽 점들(자른 점 포함), 뒤쪽 점들]
export function cutAt(pts, at) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (s + l >= at) {
      const k = l ? (at - s) / l : 0;
      const c = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * k };
      return [[...pts.slice(1, i), c], pts.slice(i)];
    }
    s += l;
  }
  return [pts.slice(1), []];
}

// ── 점검 ──
// 메인 루트 차로가 셀 발자국을 지나는지, 셀·충전 자리끼리 도달 가능한지. 경고 목록(문자열)과 막힌 셀.
export function routeIssues(layout) {
  const issues = [], bad = new Set(), edges = new Set();
  const graph = graphOf(layout.amr.route);
  const geo = cellGeo(layout);
  const all = { ...(layout.sites ?? {}), ...layout.cells };
  const boxes = Object.keys(all).map((id) => ({ id, b: bounds(id, all[id]) })).filter((x) => x.b);
  const hits = (p, skip = null) => boxes.find(({ id, b }) => id !== skip && p.x > b.x0 - BODY_R && p.x < b.x1 + BODY_R && p.z > b.z0 - BODY_R && p.z < b.z1 + BODY_R);
  for (const e of graph.edges) {
    const lanes = e.oneway || e.center ? [0] : [-1, 1];
    const d = unit(sub(e.pb, e.pa)), r = right(d), L = dist(e.pa, e.pb);
    for (const s of lanes) {
      for (let t = 0; t <= L; t += 0.25) {
        const h = hits({ x: e.pa.x + d.x * t + r.x * LANE * s, z: e.pa.z + d.z * t + r.z * LANE * s });
        if (h) { issues.push(`루트 ${e.a}–${e.b}가 ${h.id}를 지남`); edges.add(e.i); break; }
      }
      if (edges.has(e.i)) break;
    }
  }
  const homes = layout.amr.homes;
  // 접속선(지점 → 가장 가까운 간선 수선): 길면 루트가 끊긴 것으로 본다. 다른 셀을 지나면 안 된다.
  const linkIssue = (p, skip) => {
    const a = attach(graph, p);
    if (!a) return '루트 없음';
    if (a.d > LINK_MAX) return `접속선 ${a.d.toFixed(1)} m (> ${LINK_MAX})`;
    for (let t = 0.5; t < a.d; t += 0.25) {
      const k = t / a.d, h = hits({ x: p.x + (a.point.x - p.x) * k, z: p.z + (a.point.z - p.z) * k }, skip);
      if (h) return `접속선이 ${h.id}를 지남`;
    }
    return null;
  };
  for (const c of Object.values(geo)) {
    const anchors = [['입구', c.entry], ...(c.exit ? [['출구', c.exit]] : [])];
    for (const [name, p] of anchors) {
      const why = linkIssue(p, String(c.id).split(':')[0]);
      if (why) { issues.push(`${c.id} ${name}: ${why}`); bad.add(c.id); }
    }
    if (homes.length && !journey(graph, homes[0], c.entry)) { issues.push(`${c.id}: 충전 자리에서 도달 불가`); bad.add(c.id); }
    const out = c.exit ?? c.entry;
    if (homes.length && !journey(graph, out, homes[0])) { issues.push(`${c.id}: 나온 뒤 충전 자리로 못 감`); bad.add(c.id); }
  }
  for (const [i, h] of homes.entries()) {
    const b = hits(h);
    if (b) issues.push(`충전 자리 ${i + 1}이 ${b.id} 안`);
    const why = linkIssue(h, null);
    if (why) issues.push(`충전 자리 ${i + 1}: ${why}`);
  }
  return { issues, badCells: bad, badEdges: edges };
}
