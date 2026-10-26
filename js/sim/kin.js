// 추정 관절 체인 기구학. DOM·three 없음.
// 체인 = 형상으로 추정한 관절(원점·축, CAD 영점 자세) + TCP. 공간 좌표 POE: p(q) = Slide · R1(q1) · … · Rn(qn) · p0.
// 관절 원점·축은 영점 자세 값 그대로 쓰므로, 렌더의 피벗 계층(부모 따라 도는 J1…Jn)과 같은 결과가 된다.
// 한계: 축 5개뿐인 추정 체인이다. 접근 방향(2자유도) + 위치(3)만 맞추고, 공구 롤(마지막 축)은 맞추지 않는다. 가동 범위·간섭은 모른다.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);

// 축 a(단위)로 각 t 만큼 벡터 v 회전 (Rodrigues)
export function rotate(v, a, t) {
  const c = Math.cos(t), s = Math.sin(t);
  const k = dot(a, v) * (1 - c), w = cross(a, v);
  return [v[0] * c + w[0] * s + a[0] * k, v[1] * c + w[1] * s + a[1] * k, v[2] * c + w[2] * s + a[2] * k];
}

const rotAbout = (p, o, a, t) => add(o, rotate(sub(p, o), a, t));

// arm: rigdata.js 의 팔 하나(셀 로컬). track: { axis, lo, hi } 레일 직동 범위(영점 기준 m). 없으면 고정 베이스.
export function chainOf(arm, { track = null, limit = Math.PI } = {}) {
  if (!arm?.tcp) return null;
  const path = [];
  for (let j = arm.tcp.joint; j >= 0; j = arm.joints[j].parent) path.unshift(j);
  return {
    name: arm.name,
    index: path,
    joints: path.map((j) => ({ o: arm.joints[j].origin, a: arm.joints[j].axis, lo: -limit, hi: limit })),
    tcp: arm.tcp.point,
    approach: arm.tcp.approach,
    base: arm.joints[path[0]].origin,
    track,
  };
}

// q: 체인 순서 관절각, s: 레일 위치. 반환 { p: TCP, a: 접근 방향, o: 관절 원점들 }
export function fk(ch, q, s = 0) {
  let p = ch.tcp, a = ch.approach;
  const n = ch.joints.length;
  for (let i = n - 1; i >= 0; i--) {
    const J = ch.joints[i], t = q[i] ?? 0;
    if (!t) continue;
    p = rotAbout(p, J.o, J.a, t);
    a = rotate(a, J.a, t);
  }
  if (ch.track && s) p = add(p, scale(ch.track.axis, s));
  return { p, a };
}

// 관절 원점(월드)들 — 점검·그리기용
export function jointPoints(ch, q, s = 0) {
  const out = [];
  for (let k = 0; k < ch.joints.length; k++) {
    let o = ch.joints[k].o;
    for (let i = k - 1; i >= 0; i--) if (q[i]) o = rotAbout(o, ch.joints[i].o, ch.joints[i].a, q[i]);
    out.push(ch.track && s ? add(o, scale(ch.track.axis, s)) : o);
  }
  return out;
}

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / d;
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / (M[r][r] || 1e-12);
  }
  return x;
}

export const IK = Object.freeze({ iters: 200, lambda: 0.04, wa: 0.4, slideW: 0.35, stepMax: 0.25, tolP: 1e-4, tolA: 1e-3 });

// 위치 + 접근 방향 감쇠 최소제곱. 시드에서 가까운 해(팔꿈치 자세 유지). 결정론(난수 없음).
// 반환 { q, s, err(위치 m), angle(접근 오차 rad), ok }
export function ik(ch, target, { approach = [0, -1, 0], seed = null, slide = 0, opt = IK } = {}) {
  const n = ch.joints.length, hasS = !!ch.track;
  const q = seed ? seed.slice(0, n) : new Array(n).fill(0);
  while (q.length < n) q.push(0);
  let s = hasS ? slide : 0;
  const res = (qq, ss) => {
    const f = fk(ch, qq, ss);
    const ep = sub(f.p, target), ea = scale(sub(f.a, approach), opt.wa);
    return [...ep, ...ea];
  };
  const m = n + (hasS ? 1 : 0);
  const h = 1e-6;
  let r = res(q, s);
  for (let it = 0; it < opt.iters; it++) {
    const ep = Math.hypot(r[0], r[1], r[2]), ea = Math.hypot(r[3], r[4], r[5]) / opt.wa;
    if (ep < opt.tolP && ea < opt.tolA) break;
    // 수치 야코비안 6×m (레일 열은 slideW 배: 관절로 닿으면 레일은 덜 움직인다)
    const J = Array.from({ length: 6 }, () => new Array(m).fill(0));
    for (let k = 0; k < m; k++) {
      const qq = q.slice();
      let ss = s, w = 1;
      if (hasS && k === 0) { ss = s + h; w = opt.slideW; } else qq[k - (hasS ? 1 : 0)] += h;
      const r2 = res(qq, ss);
      for (let i = 0; i < 6; i++) J[i][k] = ((r2[i] - r[i]) / h) * w;
    }
    const A = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => {
      let v = 0;
      for (let k = 0; k < m; k++) v += J[i][k] * J[j][k];
      return v + (i === j ? opt.lambda * opt.lambda : 0);
    }));
    const y = solve(A, r.map((v) => -v));
    const dx = new Array(m).fill(0);
    for (let k = 0; k < m; k++) for (let i = 0; i < 6; i++) dx[k] += J[i][k] * y[i];
    const big = Math.max(...dx.map(Math.abs));
    const f = big > opt.stepMax ? opt.stepMax / big : 1;
    for (let k = 0; k < m; k++) {
      if (hasS && k === 0) s = Math.min(ch.track.hi, Math.max(ch.track.lo, s + dx[0] * f * opt.slideW));
      else {
        const i = k - (hasS ? 1 : 0), J0 = ch.joints[i];
        q[i] = Math.min(J0.hi, Math.max(J0.lo, q[i] + dx[k] * f));
      }
    }
    r = res(q, s);
  }
  const err = Math.hypot(r[0], r[1], r[2]), angle = Math.hypot(r[3], r[4], r[5]) / opt.wa;
  return { q, s, err, angle, ok: err < 2e-3 && angle < 0.02 };
}

// 첫 관절(선회)을 목표 쪽으로 돌린 시드: 첫 축에 수직인 평면에서 (지금 TCP 방향 → 목표 방향) 각.
export function aimSeed(ch, target, from) {
  const J = ch.joints[0], q = from.q.slice();
  const f = fk(ch, q, from.s);
  const flat = (v) => { const d = sub(v, J.o); return sub(d, scale(J.a, dot(d, J.a))); };
  const u = flat(f.p), w = flat(sub(target, ch.track ? scale(ch.track.axis, from.s) : [0, 0, 0]));
  if (norm(u) < 1e-6 || norm(w) < 1e-6) return { q, s: from.s };
  q[0] += Math.atan2(dot(J.a, cross(u, w)), dot(u, w));
  q[0] = Math.atan2(Math.sin(q[0]), Math.cos(q[0]));
  return { q, s: from.s };
}

// 이어지는 동작용: 직전 자세에서 푼 해와 (준비 자세를 목표 쪽으로 돌린) 시드에서 푼 해 중, 맞은 것 가운데 직전 자세에 가까운 해.
// 고르는 값: 직전 자세와의 거리 + 준비 자세와의 거리(× home). 선회축은 싸게(× yaw) — 몸을 뒤로 넘기기보다 돌아서 잡는다.
export function reach(ch, target, prev, ready, { approach = [0, -1, 0], home = 0.6, yaw = 0.5 } = {}) {
  const tries = [prev, ready, aimSeed(ch, target, ready), aimSeed(ch, target, prev)];
  const dist = (r, ref) => r.q.reduce((m, v, i) => m + Math.abs(v - (ref.q[i] ?? 0)) * (i === 0 ? yaw : 1), 0) + 2 * Math.abs(r.s - ref.s);
  let best = null;
  for (const t of tries) {
    const r = ik(ch, target, { approach, seed: t.q, slide: t.s });
    const key = (r.ok ? 0 : 1e3 + r.err * 1e3) + dist(r, prev) + home * dist(r, ready);
    if (!best || key < best.key) best = { ...r, key };
  }
  return best;
}

// 관절 공간 보간 (레일 포함)
export function lerpPose(A, B, t) {
  return { q: A.q.map((v, i) => v + ((B.q[i] ?? 0) - v) * t), s: A.s + (B.s - A.s) * t };
}

export { norm as vlen };
