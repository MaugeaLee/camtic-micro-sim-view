// 창고 적재 휴머노이드(가정): PARTS·STORE 자리 로컬에서 선반·팔레트 물건을 집어 AMR 적재면에 올린다.
// SORT 양팔·OUT 협동로봇과 같은 핸드셰이크(티켓 released = 적재면에 놓음). GLB 없음 — 보행·파지는 가정 형상.
// 좌표는 자리 로컬(m, 바닥 y=0). DOM·three 없음.
import { toLocal } from './layout.js';

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAng = (a, b, t) => a + wrap(b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const up = (p, d) => [p[0], p[1] + d, p[2]];
const hypot3 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

export const HUM_PICK = Object.freeze({ grip: 0.32, drop: 0.8 });
const KEYS = [
  ['H', 0], ['W0', 0.1], ['A0', 0.2], ['P0', 0.26], ['P0', HUM_PICK.grip],
  ['A0', 0.38], ['W1', 0.7], ['A1', 0.74], ['P1', 0.78], ['P1', HUM_PICK.drop],
  ['A1', 0.88], ['H', 1],
];

// 6×2 m 창고 발자국 안 기본(가정). 선반(−z)과 남쪽 도크(+z) 사이 통로를 걷는다.
export function humanoidDef(raw = {}, fallback = {}) {
  const B = raw.base ?? {}, Z = raw.zone ?? {};
  const Zx = Z.x ?? [-2.2, 2.2], Zz = Z.z ?? [-0.2, 0.75];
  return {
    base: { x: B.x ?? 0, y: B.y ?? 0, z: B.z ?? 0.2 },
    zone: { x: [Zx[0] ?? -2.2, Zx[1] ?? 2.2], z: [Zz[0] ?? -0.2, Zz[1] ?? 0.75] },
    reach: raw.reach ?? 0.5,
    clear: raw.clear ?? 0.16,
    grip: raw.grip ?? 0.65,
    height: raw.height ?? 1.65,
    L1: raw.L1 ?? 0.42,
    L2: raw.L2 ?? 0.42,
    time: raw.time ?? fallback.time ?? 6,
  };
}

export function validateHumanoid(H, prefix) {
  if (H == null) return [];
  const errors = [];
  const n = (v) => typeof v === 'number' && Number.isFinite(v);
  const pair = (a) => Array.isArray(a) && a.length === 2 && n(a[0]) && n(a[1]) && a[0] < a[1];
  if (H.base && (H.base.x != null && !n(H.base.x) || H.base.z != null && !n(H.base.z))) errors.push(`${prefix} humanoid.base는 {x,z}`);
  if (H.zone) {
    if (H.zone.x && !pair(H.zone.x)) errors.push(`${prefix} humanoid.zone.x lo<hi`);
    if (H.zone.z && !pair(H.zone.z)) errors.push(`${prefix} humanoid.zone.z lo<hi`);
  }
  if (H.reach != null && !(H.reach > 0)) errors.push(`${prefix} humanoid.reach는 양수`);
  if (H.clear != null && !(H.clear > 0)) errors.push(`${prefix} humanoid.clear는 양수`);
  if (H.grip != null && !(H.grip > 0 && H.grip <= 1)) errors.push(`${prefix} humanoid.grip은 0~1`);
  if (H.height != null && !(H.height > 0)) errors.push(`${prefix} humanoid.height는 양수`);
  return errors;
}

function armIk(sh, tcp, L1, L2) {
  const dx = tcp[0] - sh[0], dy = tcp[1] - sh[1], dz = tcp[2] - sh[2];
  const yaw = Math.atan2(dx, dz);
  const r = Math.hypot(dx, dz), d0 = Math.hypot(r, dy);
  const span = L1 + L2, gap = Math.abs(L1 - L2);
  const d = clamp(d0, gap + 1e-3, span - 1e-3);
  const cos2 = clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
  const q2 = -Math.acos(cos2);
  const q1 = Math.atan2(dy, r) - Math.atan2(L2 * Math.sin(q2), L1 + L2 * Math.cos(q2));
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const el = [sh[0] + fx * L1 * Math.cos(q1), sh[1] + L1 * Math.sin(q1), sh[2] + fz * L1 * Math.cos(q1)];
  const a = q1 + q2;
  const wr = [el[0] + fx * L2 * Math.cos(a), el[1] + L2 * Math.sin(a), el[2] + fz * L2 * Math.cos(a)];
  return { sh, el, wr };
}

export class HumanoidWork {
  constructor(id, spec, parts) {
    this.id = id;
    this.spec = spec;
    this.parts = parts;
    this.grip = spec.grip;
    this.clear = spec.clear;
    this.time = spec.time;
    this.car = { x: spec.base.x, z: spec.base.z, w: 0 };
    this.tcp = this.homeK();
    this.yaw = 0;
    this.phase = 0;
    this.op = null;
    this.queue = [];
    this.ticket = null;
    this.held = null;
    this.done = 0;
    this.label = '대기';
  }

  get busy() { return !!(this.op || this.queue.length || (this.ticket && !this.ticket.released && !this.ticket.cancel)); }

  holder() { return { k: 'human', cell: this.id }; }

  homeK() {
    const s = this.spec;
    return [s.base.x, s.height * 0.52, s.base.z + 0.14];
  }

  tcpOf(at, e) { return [at[0], at[1] + (e?.h ?? 0) * (1 - this.grip), at[2]]; }

  // 파지 점 앞에 구역 안 스탠스. 선반은 −z, 도크는 +z.
  stance(p) {
    const Z = this.spec.zone, R = this.spec.reach;
    const x = clamp(p[0], Z.x[0], Z.x[1]);
    const zLo = Z.z[0], zHi = Z.z[1];
    const behind = p[2] - R, front = p[2] + R;
    if (behind >= zLo && behind <= zHi) return { x, z: behind, w: 0 };
    if (front >= zLo && front <= zHi) return { x, z: front, w: Math.PI };
    if (p[2] < zLo) return { x, z: zLo, w: Math.PI };
    if (p[2] > zHi) return { x, z: zHi, w: 0 };
    if (Math.abs(p[2] - zLo) >= Math.abs(p[2] - zHi)) return { x, z: zLo, w: 0 };
    return { x, z: zHi, w: Math.PI };
  }

  // jobs: [{ e, from:[x,y,z], to:holder, toAt:[x,y,z], time? }]. 티켓 released = 마지막 놓음.
  offer(jobs, extra = {}) {
    if (!jobs?.length || this.busy) return null;
    this.queue = jobs.map((j) => ({ ...j, time: j.time ?? this.time }));
    this.ticket = { released: false, cancel: false, started: true, ...extra };
    this.kick();
    return this.ticket;
  }

  cancel(ticket) {
    if (this.ticket !== ticket) return false;
    ticket.cancel = true;
    this.queue = [];
    return !!this.held;
  }

  kick() {
    if (this.op || !this.queue.length) return;
    this.start(this.queue.shift());
  }

  start(job) {
    const c = this.clear, e = job.e;
    const P0 = this.tcpOf(job.from, e), P1 = this.tcpOf(job.toAt, e);
    const S0 = this.stance(P0), S1 = this.stance(P1);
    const H = { ...this.car }, home = { x: this.spec.base.x, z: this.spec.base.z, w: 0 };
    const Hk = this.homeK();
    const A0 = up(P0, c), A1 = up(P1, c);
    const pts = {
      H: { p: Hk, ...H },
      W0: { p: [S0.x, Hk[1], S0.z], ...S0 },
      A0: { p: A0, ...S0 },
      P0: { p: P0, ...S0 },
      W1: { p: A1, ...S1 },
      A1: { p: A1, ...S1 },
      P1: { p: P1, ...S1 },
      H2: { p: [home.x, Hk[1], home.z], ...home },
    };
    const holder = this.holder();
    const from = e.holder;
    this.label = job.label ?? `${this.id} 적재`;
    this.op = {
      time: job.time, el: 0, ei: 0, job,
      keys: KEYS.map(([k, t]) => ({ t, ...(k === 'H' && t === 1 ? pts.H2 : pts[k]) })),
      events: [
        { t: HUM_PICK.grip, fn: () => {
          if (this.ticket?.cancel) return;
          this.parts.hold(e, holder, from);
          this.held = e;
        } },
        { t: HUM_PICK.drop, fn: () => {
          if (!this.held) return;
          this.parts.hold(this.held, job.to, holder);
          this.held = null;
          this.done++;
          if (!this.queue.length && this.ticket) this.ticket.released = true;
        } },
      ],
    };
  }

  step(h) {
    const op = this.op;
    if (!op) {
      this.car = { x: this.spec.base.x, z: this.spec.base.z, w: 0 };
      this.tcp = this.homeK();
      this.phase = 0;
      this.label = '대기';
      if (this.ticket?.cancel) this.ticket = null;
      return;
    }
    op.el += h;
    const f = op.el >= op.time - 1e-9 ? 1 : op.el / op.time;
    this.poseAt(op, f);
    while (op.ei < op.events.length && op.events[op.ei].t <= f + 1e-12) op.events[op.ei++].fn();
    if (f < 1) return;
    this.op = null;
    this.label = '대기';
    if (this.ticket?.cancel) {
      this.queue = [];
      if (!this.held && this.ticket) this.ticket.released = true;
    }
    this.kick();
    if (!this.op && this.ticket && !this.ticket.released && !this.queue.length && !this.held) this.ticket.released = true;
  }

  poseAt(op, f) {
    const K = op.keys;
    let k = 0;
    while (k < K.length - 2 && K[k + 1].t <= f) k++;
    const A = K[k], B = K[k + 1];
    const u = B.t > A.t ? Math.min(1, Math.max(0, (f - A.t) / (B.t - A.t))) : 1;
    const p = lerp3(A.p, B.p, u);
    const nx = lerp(A.x, B.x, u), nz = lerp(A.z, B.z, u);
    this.phase += Math.hypot(nx - this.car.x, nz - this.car.z);
    this.car = { x: nx, z: nz, w: lerpAng(A.w, B.w, u) };
    this.tcp = p;
    op.p = p;
    const g = HUM_PICK.grip, d = HUM_PICK.drop, job = op.job;
    this.yaw = f < g ? (job.fromYaw ?? 0) : lerpAng(job.fromYaw ?? 0, job.toYaw ?? 0, Math.min(1, (f - g) / (d - g)));
  }

  local(e) {
    if (e.holder?.k !== 'human' || e.holder.cell !== this.id) return null;
    const t = this.op?.p ?? this.tcp;
    return t ? [t[0], t[1] - e.h * (1 - this.grip), t[2], this.yaw ?? 0] : null;
  }

  shoulders() {
    const { x, z, w } = this.car, y = this.spec.height * 0.82;
    const c = Math.cos(w), s = Math.sin(w), g = 0.16;
    return [
      [x + g * c, y, z - g * s],
      [x - g * c, y, z + g * s],
    ];
  }

  view() {
    const { x, z, w } = this.car, s = this.spec;
    const [shL, shR] = this.shoulders();
    const tcp = this.tcp;
    const g = 0.14, fx = Math.sin(w), fz = Math.cos(w);
    const L = [tcp[0] - g * fz, tcp[1], tcp[2] + g * fx];
    const R = [tcp[0] + g * fz, tcp[1], tcp[2] - g * fx];
    const left = armIk(shL, L, s.L1, s.L2), right = armIk(shR, R, s.L1, s.L2);
    return {
      id: `${this.id}:HUM`,
      x, z, w, tcp,
      height: s.height, L1: s.L1, L2: s.L2,
      phase: this.phase,
      held: !!this.held,
      label: this.label,
      busy: !!this.op,
      left, right,
    };
  }
}

// AMR 적재면 밑면을 자리 로컬 [x,y,z] 로. plant: poseOf·cellPose.
export function amrDeckAt(plant, siteId, holder) {
  const pose = plant.cellPose(siteId);
  const w = plant.poseOf({ holder });
  if (!w || !pose) return { at: [0, holder.at?.[2] ?? 1.11, 1.3], yaw: 0 };
  const l = toLocal(pose, w);
  return { at: [l.x, w.y, l.z], yaw: w.yaw - (pose.rotY * Math.PI) / 180 };
}

export function distMoved(a, b) { return hypot3(a, b); }
