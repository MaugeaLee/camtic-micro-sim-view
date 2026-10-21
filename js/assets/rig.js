// CAD 그룹 → 관절 추정. GLB에 관절 노드·축(extras)이 없을 때 형상만으로 푼다. Three·DOM 없음.
// 회전 대칭 부품(원판·원통)을 관절 하우징으로 보고 그 대칭축을 회전축으로 쓴다.
// 대칭 부품은 자기 축으로 돌아도 모양이 같아서, 하우징이 관절 앞뒤 어느 링크에 붙어도 결과가 같다.

export const TUNE = Object.freeze({
  gap: 0.01,        // 접촉 판정 = 전체 대각선 × gap
  pairEig: 0.8,     // 대칭 두 축 분산비 하한
  oddEig: 0.75,     // 남은 한 축은 이 비율 이상 달라야 축이 정해진다
  rimBins: 16,
  rimFill: 9,       // 바깥 둘레 점이 차지한 각도 칸 수 하한 (사각형 모서리 4칸을 걸러낸다)
  rodRatio: 1.6,    // 길이/지름이 이보다 긴 원통은 링크·롤러·레일이지 관절 하우징이 아니다
  cutReach: 2.5,    // 먼 쪽 링크가 몸통에 닿는 자리는 관절 반지름 × 이 값 안이어야 한다
  coaxDot: 0.97,
  coaxDist: 0.04,   // 동축 판정 = 전체 대각선 × coaxDist
  minLevels: 3,     // 관절이 이만큼 직렬로 이어져야 로봇으로 본다
  maxParts: 120,
});

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => norm(sub(a, b));

export function eigSym3(m) {
  const a = m.map((r) => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    if (Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]) < 1e-18) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const kp = a[k][p], kq = a[k][q];
        a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq;
      }
      for (let k = 0; k < 3; k++) {
        const pk = a[p][k], qk = a[q][k];
        a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk;
      }
      for (let k = 0; k < 3; k++) {
        const kp = v[k][p], kq = v[k][q];
        v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq;
      }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: [0, 1, 2].map((i) => [v[0][i], v[1][i], v[2][i]]) };
}

export function moments(pts) {
  const n = pts.length / 3;
  const c = [0, 0, 0];
  for (let i = 0; i < pts.length; i += 3) { c[0] += pts[i]; c[1] += pts[i + 1]; c[2] += pts[i + 2]; }
  c[0] /= n; c[1] /= n; c[2] /= n;
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < pts.length; i += 3) {
    const d = [pts[i] - c[0], pts[i + 1] - c[1], pts[i + 2] - c[2]];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) m[r][k] += d[r] * d[k];
  }
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) m[r][k] /= n;
  return { c, cov: m };
}

export function canonical(v) {
  const l = norm(v) || 1;
  let k = 0;
  if (Math.abs(v[1]) > Math.abs(v[k])) k = 1;
  if (Math.abs(v[2]) > Math.abs(v[k])) k = 2;
  const s = v[k] < 0 ? -1 / l : 1 / l;
  return [v[0] * s, v[1] * s, v[2] * s];
}

function perp(a) {
  const ref = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = cross(a, ref), lu = norm(u);
  const uu = [u[0] / lu, u[1] / lu, u[2] / lu];
  return [uu, cross(a, uu)];
}

// 축 후보 하나로 둘레를 잰다: 바깥 둘레 점이 여러 각도에 고르게 있어야 원이다
function rim(pts, c, axis, t) {
  const [u, w] = perp(axis);
  const n = pts.length / 3, rs = new Float64Array(n), as = new Float64Array(n);
  let rmax = 0, hmin = Infinity, hmax = -Infinity;
  for (let i = 0; i < n; i++) {
    const d = [pts[i * 3] - c[0], pts[i * 3 + 1] - c[1], pts[i * 3 + 2] - c[2]];
    const x = dot(d, u), y = dot(d, w), h = dot(d, axis);
    rs[i] = Math.hypot(x, y); as[i] = Math.atan2(y, x);
    if (rs[i] > rmax) rmax = rs[i];
    if (h < hmin) hmin = h;
    if (h > hmax) hmax = h;
  }
  if (rmax <= 0) return null;
  const length = hmax - hmin;
  if (length > t.rodRatio * 2 * rmax) return null;
  const hit = new Set();
  let outer = 0;
  for (let i = 0; i < n; i++) {
    if (rs[i] < 0.9 * rmax) continue;
    outer++;
    hit.add(Math.floor(((as[i] + Math.PI) / (2 * Math.PI)) * t.rimBins) % t.rimBins);
  }
  if (hit.size < t.rimFill) return null;
  return { center: c, axis: canonical(axis), radius: rmax, length, frac: outer / n };
}

export function roundAxis(pts, t = TUNE) {
  if (!pts || pts.length < 24) return null;
  const { c, cov } = moments(pts);
  const { values, vectors } = eigSym3(cov);
  const idx = [0, 1, 2].sort((i, j) => values[i] - values[j]);
  const l = idx.map((i) => Math.max(values[i], 0));
  const V = idx.map((i) => vectors[i]);
  if (l[2] <= 0) return null;
  if (l[1] > 0 && l[0] / l[1] >= t.pairEig && (l[0] + l[1]) / 2 / l[2] <= t.oddEig) return rim(pts, c, V[2], t);
  if (l[1] / l[2] >= t.pairEig && l[0] / ((l[1] + l[2]) / 2) <= t.oddEig) return rim(pts, c, V[0], t);
  // 세 분산이 비슷하면(길이 ≈ 지름 × 0.7 원통) 주축이 안 정해진다 — 후보 축마다 둘레를 재서 원에 가장 잘 맞는 축을 쓴다
  if (l[0] / l[2] < t.pairEig) return null;
  let best = null;
  for (const a of [...V, [1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const r = rim(pts, c, a, t);
    if (r && r.frac >= 0.5 && (!best || r.frac > best.frac)) best = r;
  }
  return best;
}

function boxOf(pts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pts[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max, center: [0, 1, 2].map((k) => (min[k] + max[k]) / 2) };
}

function boxGap(a, b) {
  let g = 0;
  for (let k = 0; k < 3; k++) {
    const d = Math.max(a.min[k] - b.max[k], b.min[k] - a.max[k], 0);
    g = Math.max(g, d);
  }
  return g;
}

function contactPoint(a, b) {
  return [0, 1, 2].map((k) => (Math.max(a.min[k], b.min[k]) + Math.min(a.max[k], b.max[k])) / 2);
}

function shortest(n, edges, src) {
  const d = new Array(n).fill(Infinity), done = new Array(n).fill(false);
  d[src] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
    if (u < 0) break;
    done[u] = true;
    for (const [v, w] of edges[u]) if (d[u] + w < d[v]) d[v] = d[u] + w;
  }
  return d;
}

export function coaxial(a, b, tol, t = TUNE) {
  if (Math.abs(dot(a.axis, b.axis)) < t.coaxDot) return false;
  return norm(cross(sub(b.center, a.center), a.axis)) <= tol;
}

// parts: [{ name, points: 월드 좌표 xyz 평면 배열 }]. up: 바닥을 고를 위쪽 방향.
export function inferRig(parts, { up = [0, 1, 0], tune = TUNE } = {}) {
  const n = parts.length;
  const empty = { root: -1, joints: [], link: new Array(n).fill(-1), levels: 0, robot: false };
  if (n < 3 || n > tune.maxParts) return empty;
  const info = parts.map((p) => ({ name: p.name, ...boxOf(p.points), round: roundAxis(p.points, tune) }));
  if (info.some((p) => !Number.isFinite(p.min[0]))) return empty;
  const all = boxOf(info.flatMap((p) => [...p.min, ...p.max]));
  const diag = dist(all.min, all.max) || 1;
  const gapTol = Math.max(0.003, diag * tune.gap);

  const edges = info.map(() => []);
  const link2 = (i, j) => { const w = dist(info[i].center, info[j].center); edges[i].push([j, w]); edges[j].push([i, w]); };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (boxGap(info[i], info[j]) <= gapTol) link2(i, j);

  const low = (p) => Math.min(dot(p.min, up), dot(p.max, up));
  let root = 0;
  for (let i = 1; i < n; i++) if (low(info[i]) < low(info[root]) - 1e-6) root = i;

  // 떨어진 덩어리는 가장 가까운 틈 하나가 아니라 그 틈 + 허용치 안의 쌍을 모두 잇는다 — 한 부품만 먼저 닿아 순서가 뒤집히지 않게
  let depth = shortest(n, edges, root);
  while (depth.some((d) => d === Infinity)) {
    let g0 = Infinity;
    const pairs = [];
    for (let i = 0; i < n; i++) {
      if (depth[i] === Infinity) continue;
      for (let j = 0; j < n; j++) {
        if (depth[j] !== Infinity) continue;
        const g = boxGap(info[i], info[j]);
        pairs.push([i, j, g]);
        if (g < g0) g0 = g;
      }
    }
    for (const [i, j, g] of pairs) if (g <= g0 + gapTol) link2(i, j);
    depth = shortest(n, edges, root);
  }

  const distal = (a) => {
    const seen = new Set([a]), q = [a];
    while (q.length) {
      const u = q.pop();
      for (const [v] of edges[u]) {
        if (seen.has(v) || v === root || depth[v] < depth[a] - 1e-9) continue;
        seen.add(v); q.push(v);
      }
    }
    return seen;
  };

  const coTol = diag * tune.coaxDist;
  const cands = info.map((p, i) => i).filter((i) => i !== root && info[i].round).sort((a, b) => depth[a] - depth[b]);
  const sameAxis = (i, p) => p === i || (info[p].round && coaxial(info[i].round, info[p].round, coTol, tune));

  // 관절이면 먼 쪽 덩어리는 관절 근처에서만 몸통에 닿는다 (패드·롤러처럼 다른 자리에서도 닿으면 관절이 아니다)
  const isCut = (i, set) => {
    const o = info[i].round.center, reach = Math.max(tune.cutReach * info[i].round.radius, 3 * gapTol);
    for (const a of set) {
      if (sameAxis(i, a)) continue;
      for (const [b] of edges[a]) {
        if (set.has(b) || sameAxis(i, b)) continue;
        if (dist(contactPoint(info[a], info[b]), o) > reach) return false;
      }
    }
    return true;
  };
  // 앞선 관절과 같은 축 위의 대칭 부품은 새 관절이 아니라 그 관절의 베어링·캡이다 (그 관절 링크에 묶는다)
  const kept = [];
  const member = new Map();
  for (const i of cands) {
    const me = { center: info[i].round.center, axis: info[i].round.axis };
    const host = kept.findIndex((k) => k.set.has(i) && coaxial(k, me, coTol, tune));
    if (host >= 0) { member.set(i, host); continue; }
    const set = distal(i);
    if (set.size < 2 || !isCut(i, set)) continue;
    let parent = -1;
    for (let k = kept.length - 1; k >= 0; k--) if (kept[k].set.has(i)) { parent = k; break; }
    member.set(i, kept.length);
    kept.push({ part: i, set, parent, center: me.center, axis: me.axis, level: parent >= 0 ? kept[parent].level + 1 : 1 });
  }

  const link = info.map((_, p) => {
    if (member.has(p)) return member.get(p);
    for (let k = kept.length - 1; k >= 0; k--) if (kept[k].set.has(p)) return k;
    return -1;
  });
  const joints = kept.map((j) => ({ part: j.part, name: info[j.part].name, origin: j.center, axis: j.axis, parent: j.parent, level: j.level }));
  const levels = joints.reduce((m, j) => Math.max(m, j.level), 0);
  return { root, joints, link, levels, robot: levels >= tune.minLevels };
}
