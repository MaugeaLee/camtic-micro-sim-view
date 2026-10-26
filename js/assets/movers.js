// 팔 말고 다른 운동. 형상만. Three·DOM 없음.
// amr: 가로 짧은 원통 3–8개(바퀴) → 차체 이동 + 바퀴 자전
//      다만 바퀴 위에 큰 지그 상판+다리가 있으면 도킹 고정(A03). 이동하지 않음
// rollers: 가로 긴 원통 4개 이상 → 제자리 자전
// gantry: 문형. Cross가 Side 레일을 타고(긴 변), 흡착 헤드만 수직. 프레임·레일은 고정
// track: 가로로 긴 가이드 2개 이상 → 슬라이드 축만 (캐리지는 근처 그룹)

import { inferRig, roundAxis, cylinderAxis, TUNE } from './rig.js';

const UP = [0, 1, 0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export function canonical(v) {
  const l = norm(v) || 1;
  let k = 0;
  if (Math.abs(v[1]) > Math.abs(v[k])) k = 1;
  if (Math.abs(v[2]) > Math.abs(v[k])) k = 2;
  const s = v[k] < 0 ? -1 / l : 1 / l;
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function aabbOf(pts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pts[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const size = [0, 1, 2].map((k) => max[k] - min[k]);
  const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  const order = [0, 1, 2].sort((a, b) => size[b] - size[a]);
  const axis = [0, 0, 0];
  axis[order[0]] = 1;
  return { min, max, size, center, axis, long: size[order[0]], mid: size[order[1]], short: size[order[2]] };
}

function horizontal(axis, up = UP) {
  return Math.abs(dot(axis, up)) < 0.35;
}

function cluster(items, key = (x) => x.axis) {
  let best = [];
  for (const a of items) {
    const ax = key(a);
    const set = items.filter((b) => Math.abs(dot(ax, key(b))) >= 0.95);
    if (set.length > best.length) best = set;
  }
  return best;
}

function mean(list, pick) {
  const s = [0, 0, 0];
  for (const x of list) {
    const v = pick(x);
    s[0] += v[0]; s[1] += v[1]; s[2] += v[2];
  }
  const n = list.length || 1;
  return [s[0] / n, s[1] / n, s[2] / n];
}

export function inferWheels(parts, { up = UP } = {}) {
  const wheels = [];
  parts.forEach((p, i) => {
    const c = roundAxis(p.points);
    if (!c || !horizontal(c.axis, up)) return;
    wheels.push({ i, name: p.name, ...c });
  });
  const set = cluster(wheels);
  if (set.length < 3 || set.length > 8) return null;
  const r0 = set[0].radius;
  if (set.some((w) => w.radius < r0 * 0.5 || w.radius > r0 * 2)) return null;
  const h0 = dot(set[0].center, up);
  if (set.some((w) => Math.abs(dot(w.center, up) - h0) > r0 * 3)) return null;
  const axis = canonical(mean(set, (w) => w.axis));
  let forward = cross(axis, up);
  if (norm(forward) < 1e-6) return null;
  forward = canonical(forward);
  return { kind: 'amr', wheels: set, axis, forward, radius: set.reduce((s, w) => s + w.radius, 0) / set.length };
}

export function isDockedJig(parts, wheels, { up = UP } = {}) {
  if (!parts || !wheels?.length) return false;
  const wheelH = wheels.reduce((s, w) => s + dot(w.center, up), 0) / wheels.length;
  const r = wheels[0].radius;
  const boxes = parts.map((p) => aabbOf(p.points));
  const decks = boxes.filter((b) => (
    horizontal(b.axis, up)
    && b.min[1] >= wheelH + r * 2
    && b.long >= 1.6
    && b.mid >= 0.65
  ));
  const legs = boxes.filter((b) => (
    b.size[1] >= b.long - 1e-9
    && b.long >= 0.25
    && b.long >= 2.5 * Math.max(b.mid, 1e-6)
    && b.min[1] > wheelH
  ));
  return decks.length >= 1 && legs.length >= 3;
}

export function inferRollers(parts, { up = UP } = {}) {
  const rods = [];
  parts.forEach((p, i) => {
    const c = cylinderAxis(p.points);
    if (!c || !horizontal(c.axis, up)) return;
    if (c.length <= TUNE.rodRatio * 2 * c.radius) return;
    rods.push({ i, name: p.name, ...c });
  });
  const set = cluster(rods);
  if (set.length < 4) return null;
  const axis = canonical(mean(set, (r) => r.axis));
  return { kind: 'rollers', rollers: set, axis };
}

function topRailPair(boxes, portalTop, up) {
  const rails = boxes.filter((b) => (
    horizontal(b.axis, up)
    && b.long >= 1.4
    && b.long >= 8 * Math.max(b.mid, 1e-6)
    && Math.abs(b.center[1] - portalTop) <= 0.25
  ));
  const groups = [];
  const seen = new Set();
  for (const a of rails) {
    if (seen.has(a.i)) continue;
    const set = rails.filter((b) => Math.abs(dot(canonical(a.axis), canonical(b.axis))) >= 0.95);
    set.forEach((b) => seen.add(b.i));
    if (set.length >= 2 && set.length <= 4) groups.push(set);
  }
  if (!groups.length) return null;
  groups.sort((a, b) => b[0].long - a[0].long);
  return groups[0];
}

export function inferGantry(parts, { up = UP } = {}) {
  if (!parts || parts.length < 8) return null;
  const boxes = parts.map((p, i) => ({ i, name: p.name, ...aabbOf(p.points) }));
  const posts = boxes.filter((b) => (
    b.size[1] >= b.long - 1e-9
    && b.long >= 0.8
    && b.long >= 4 * Math.max(b.mid, 1e-6)
    && b.mid <= b.short * 1.5
  ));
  if (posts.length < 3 || posts.length > 6) return null;
  const portalTop = Math.max(...posts.map((p) => p.max[1]));
  const postLong = Math.min(...posts.map((p) => p.long));
  const cols = boxes.filter((b) => (
    !posts.some((p) => p.i === b.i)
    && b.size[1] >= 0.25
    && b.size[1] > b.size[0]
    && b.size[1] > b.size[2]
    && b.min[1] >= portalTop - 0.15
    && b.long <= postLong * 0.7
    && b.mid >= 0.12
  ));
  if (cols.length !== 1) return null;
  const col = cols[0];
  const nearCol = (b) => Math.hypot(b.center[0] - col.center[0], b.center[2] - col.center[2]) <= 0.45;
  const tool = boxes.filter((b) => {
    if (b.i === col.i || posts.some((p) => p.i === b.i)) return false;
    if (!nearCol(b) || b.max[1] > col.max[1] + 0.05) return false;
    if (horizontal(b.axis, up) && b.long >= 1) return false;
    return true;
  });
  if (!tool.length) return null;

  const xs = posts.map((p) => p.center[0]);
  const zs = posts.map((p) => p.center[2]);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanZ = Math.max(...zs) - Math.min(...zs);
  if (spanX < 0.4 && spanZ < 0.4) return null;
  const sides = topRailPair(boxes, portalTop, up);
  const horiz = sides
    ? canonical(mean(sides, (s) => s.axis))
    : canonical(spanX >= spanZ ? [1, 0, 0] : [0, 0, 1]);
  const run = sides ? sides[0].long : Math.max(spanX, spanZ);

  const crosses = boxes.filter((b) => (
    b.i !== col.i
    && !posts.some((p) => p.i === b.i)
    && !sides?.some((s) => s.i === b.i)
    && horizontal(b.axis, up)
    && nearCol(b)
    && b.long >= 1
    && b.mid >= 0.12
  ));
  const cross = crosses.sort((a, b) => b.mid - a.mid)[0] ?? null;
  const head = [{ i: col.i, name: col.name }, ...tool.map((t) => ({ i: t.i, name: t.name }))];
  const lift = cross ? [{ i: cross.i, name: cross.name }, ...head] : head;
  // 레일 길이 방향 이동 범위(문형 안쪽). 크로스·헤드가 레일 끝을 넘지 않는다
  const along = (p) => dot(p, horiz);
  const railBox = sides ? aabbOf(sides.flatMap((s) => [...s.min, ...s.max])) : aabbOf(posts.flatMap((p) => [...p.min, ...p.max]));
  const half = cross ? Math.abs(dot(cross.size, horiz)) / 2 : 0.1;
  const travel = [Math.min(along(railBox.min), along(railBox.max)) + half, Math.max(along(railBox.min), along(railBox.max)) - half];

  return {
    kind: 'gantry',
    horiz,
    up: canonical(up),
    origin: cross ? [(cross.center[0] + col.center[0]) / 2, portalTop, (cross.center[2] + col.center[2]) / 2] : col.center,
    toolOrigin: mean(head, (t) => boxes.find((b) => b.i === t.i).center),
    lift,
    tool: head,
    travel,
    work: heldWork(tool.map((t) => boxes.find((b) => b.i === t.i))),
    ampX: Math.min(0.5, run * 0.16),
    ampZ: Math.min(0.08, col.long * 0.18),
  };
}

// 공구 아래 매달린 작업물(대표 부품): 공구 부품 중 가장 낮고 납작하며, 나머지 공구 부품 밑면보다 아래에 통째로 있는 것.
// 이름이 아니라 높이로 고른다. 패드만 있으면(작업물 없음) null.
export function heldWork(tool, { tol = 0.01 } = {}) {
  if (tool.length < 2) return null;
  const low = [...tool].sort((a, b) => a.min[1] - b.min[1]);
  const w = low[0], rest = low.slice(1);
  const floor = Math.min(...rest.map((b) => b.min[1]));
  if (w.max[1] > floor + tol || w.size[1] >= w.mid) return null;
  return { i: w.i, name: w.name, size: w.size, center: w.center, top: w.max[1], bottom: w.min[1], pads: floor };
}

export function inferTrack(parts, { up = UP } = {}) {
  const rails = [];
  parts.forEach((p, i) => {
    const b = aabbOf(p.points);
    if (b.long < 4 * Math.max(b.mid, 1e-6)) return;
    if (!horizontal(b.axis, up)) return;
    rails.push({ i, name: p.name, ...b });
  });
  const set = cluster(rails);
  if (set.length < 2 || set.length > 4) return null;
  const L0 = set[0].long;
  if (set.some((r) => r.long < L0 * 0.7 || r.long > L0 * 1.4)) return null;
  const axis = canonical(mean(set, (r) => r.axis));
  const alongs = set.map((r) => dot(r.center, axis));
  if (Math.max(...alongs) - Math.min(...alongs) > L0 * 0.35) return null;
  const lateral = set.map((r) => {
    const t = dot(r.center, axis);
    return sub(r.center, [axis[0] * t, axis[1] * t, axis[2] * t]);
  });
  let spread = 0;
  for (let i = 1; i < lateral.length; i++) spread = Math.max(spread, norm(sub(lateral[i], lateral[0])));
  if (spread < 0.03) return null;
  const all = aabbOf(set.flatMap((r) => [...r.min, ...r.max]));
  const half = all.long * 0.5;
  return {
    kind: 'track',
    rails: set,
    axis,
    origin: all.center,
    span: half,
    halfWidth: Math.max(all.mid, all.short) * 0.5,
    amp: Math.min(0.45, half * 0.28),
  };
}

export function pointOnTrack(p, track) {
  const d = sub(p, track.origin);
  const along = dot(d, track.axis);
  const radial = norm(sub(d, [track.axis[0] * along, track.axis[1] * along, track.axis[2] * along]));
  return { along, radial, on: Math.abs(along) <= track.span + 0.4 && radial <= track.halfWidth + 0.6 };
}

export function classifyMover(parts, { up = UP } = {}) {
  if (!parts || parts.length < 3) return { kind: 'none' };
  const arm = inferRig(parts, { up });
  if (arm.robot) return { kind: 'arm', arm };
  const wheels = inferWheels(parts, { up });
  if (wheels && !isDockedJig(parts, wheels.wheels, { up })) return wheels;
  return inferRollers(parts, { up }) ?? inferGantry(parts, { up }) ?? inferTrack(parts, { up }) ?? { kind: 'none' };
}
