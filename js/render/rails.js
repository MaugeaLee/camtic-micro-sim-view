// AMR 바닥 레일 기하(그리기용). three·DOM 없음 — field-def.js 와 같이 헤드리스로 점검한다.
// 간선을 노드 원까지 잘라 교차에서 사각형이 튀어나오지 않게 하고, 폭은 간선 종류(양방향·단방향·중심선)에 맞춘다.
export const RAIL = Object.freeze({
  two: 2.5,     // 양방향 통로(차로 ±0.7 + 차체)
  one: 1.4,     // 단방향
  link: 1.2,    // 중심선 지선·접속선
  line: 0.055,
  dash: 1.2,
  gap: 1.4,
  arrow: 5.5,
});

export function railWidth(e) {
  if (e?.center) return RAIL.link;
  if (e?.oneway) return RAIL.one;
  return RAIL.two;
}

// 노드마다 붙은 간선 반폭의 최댓값. 이 원으로 교차를 덮는다.
export function nodeRadii(map) {
  const r = new Map();
  for (const n of map.nodes ?? []) r.set(n.id, 0);
  for (const e of map.edges ?? []) {
    const half = railWidth(e) / 2;
    r.set(e.a, Math.max(r.get(e.a) ?? 0, half));
    r.set(e.b, Math.max(r.get(e.b) ?? 0, half));
  }
  return r;
}

// a→b 를 양 끝에서 ra·rb 만큼 줄인다. 너무 짧으면 null(원끼리 덮음).
export function insetSeg(a, b, ra = 0, rb = 0) {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
  if (L < 1e-4) return null;
  const ux = dx / L, uz = dz / L;
  const ia = Math.max(ra, 0), ib = Math.max(rb, 0);
  if (ia + ib >= L - 1e-4) return null;
  return {
    a: { x: a.x + ux * ia, z: a.z + uz * ia },
    b: { x: b.x - ux * ib, z: b.z - uz * ib },
    L: L - ia - ib,
    heading: Math.atan2(dx, dz),
  };
}

export function along(a, b, step, start = step / 2) {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
  if (L < step * 0.4) return [];
  const heading = Math.atan2(dx, dz), out = [];
  for (let t = start; t <= L - start * 0.25; t += step) {
    const k = t / L;
    out.push({ x: a.x + dx * k, z: a.z + dz * k, heading });
  }
  return out;
}

export function linkSegs(links, startR = 0.28, endR = RAIL.two / 2) {
  const out = [];
  for (const pair of links ?? []) {
    const [p, q] = pair;
    const s = p && q ? insetSeg(p, q, startR, endR) : null;
    if (s) out.push({ ...s, w: RAIL.link });
  }
  return out;
}

// ACS 지도 → 바닥 레일 계획(교차 원 · 잘린 간선 · 점선·화살표 자리).
export function railPlan(map) {
  const radii = nodeRadii(map);
  // 교차는 가장 넓은 간선 방향에 맞춘 정사각형(한 변 2r)으로 덮는다 — 직선 도로끼리 반듯하게 만난다.
  const joints = (map.nodes ?? []).map((n) => {
    let heading = 0, wide = -1;
    for (const e of map.edges ?? []) {
      if ((e.a !== n.id && e.b !== n.id) || !e.pa || !e.pb) continue;
      const w = railWidth(e);
      if (w > wide) { wide = w; heading = Math.atan2(e.pb.x - e.pa.x, e.pb.z - e.pa.z); }
    }
    return {
      id: n.id, x: n.x, z: n.z, r: Math.max(radii.get(n.id) || 0, RAIL.line), heading,
      bad: (map.edges ?? []).some((e) => e.bad && (e.a === n.id || e.b === n.id)),
    };
  });
  const segs = [];
  for (const e of map.edges ?? []) {
    const s = insetSeg(e.pa, e.pb, radii.get(e.a) || 0, radii.get(e.b) || 0);
    if (!s) continue;
    segs.push({ ...s, w: railWidth(e), oneway: !!e.oneway, center: !!e.center, bad: !!e.bad });
  }
  const dashes = [], arrows = [];
  for (const s of segs) {
    if (s.oneway) arrows.push(...along(s.a, s.b, RAIL.arrow));
    else if (!s.center) {
      for (const m of along(s.a, s.b, RAIL.dash + RAIL.gap, RAIL.gap)) {
        dashes.push({ ...m, w: RAIL.line, l: RAIL.dash });
      }
    }
  }
  return { joints, segs, dashes, arrows };
}
