// 완료품 적재 구역(OUT): 협동로봇이 AMR 적재면의 완료품을 집어 세워 책장 칸에 꽂는다. 칸이 다 차면 묶어서 출하(치움). DOM·three 없음.
// 좌표는 자리 로컬(m, 바닥 y=0). TCP = 그리퍼가 잡는 점. GLB 없음 — 형상·치수·시간·출하 규칙은 모두 가정이다.
// 핸드셰이크는 셀 하역과 같다: offer → 물고 들면 released(AMR 출발) → 칸에 꽂음.
const smooth = (u) => u * u * (3 - 2 * u);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 키 프레임(작업 시간 비율): 대기 → AMR 위 → 내려 물기 → 들며 세움(AMR 출발) → 칸 앞 → 꽂기 → 빼기 → 대기
export const OUT_KEYS = Object.freeze({ grip: 0.28, release: 0.4, drop: 0.78 });
const STAND = Math.PI / 2;

function armIk(base, L1, L2, tcp, rail) {
  const dx = tcp[0] - rail, dy = tcp[1] - base.y, dz = tcp[2] - base.z;
  const yaw = Math.atan2(dx, dz);
  const r = Math.hypot(dx, dz), d0 = Math.hypot(r, dy);
  const span = L1 + L2, gap = Math.abs(L1 - L2);
  const d = clamp(d0, gap + 1e-3, span - 1e-3);
  const cos2 = clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
  const q2 = -Math.acos(cos2);
  const q1 = Math.atan2(dy, r) - Math.atan2(L2 * Math.sin(q2), L1 + L2 * Math.cos(q2));
  return { yaw, q1, q2 };
}

function jointsOf(base, L1, L2, ik, rail) {
  const sh = [rail, base.y, base.z], fx = Math.sin(ik.yaw), fz = Math.cos(ik.yaw);
  const c1 = Math.cos(ik.q1), s1 = Math.sin(ik.q1);
  const el = [sh[0] + fx * L1 * c1, sh[1] + L1 * s1, sh[2] + fz * L1 * c1];
  const a = ik.q1 + ik.q2, c2 = Math.cos(a), s2 = Math.sin(a);
  const wr = [el[0] + fx * L2 * c2, el[1] + L2 * s2, el[2] + fz * L2 * c2];
  return [sh, el, wr];
}

export class OutWork {
  // O: 공정 정의 cells.OUT + kit·deck
  constructor(id, O, parts) {
    this.id = id;
    this.O = O;
    this.parts = parts;
    this.kitH = O.kit.size[1];
    this.kitW = O.kit.size[0];
    this.kitD = O.kit.size[2];
    this.slots = O.slots.map((p) => ({ p: [p.x, p.y, p.z], kit: null }));
    this.home = [O.home.x, O.home.y ?? O.cobot.base.y + 0.85, O.home.z];
    this.tcp = this.home.slice();
    this.tilt = 0;
    this.yaw = 0;
    this.rail = clamp(this.home[0], O.cobot.rail.lo, O.cobot.rail.hi);
    this.ticket = null;
    this.op = null;
    this.held = null;
    this.stored = 0;
    this.shipped = 0;
    this.batches = 0;
    this.shipAt = null;
    this.el = 0;
    this.onShip = null;
  }

  canAccept() { return !this.ticket && this.shipAt === null && this.slots.some((s) => !s.kit); }

  offer(kit, from, at, yaw = 0) {
    this.ticket = { kit, from, at: [at.x, at.z], yaw, started: false, gripped: false, released: false, cancel: false };
    return this.ticket;
  }

  cancel(ticket) {
    if (this.ticket !== ticket) return false;
    if (ticket.gripped) return true;
    ticket.cancel = true;
    if (!ticket.started) this.ticket = null;
    return false;
  }

  step(h) {
    this.el += h;
    if (this.shipAt !== null && this.el >= this.shipAt) this.ship();
    const T = this.ticket;
    if (T && !T.started && !this.op) this.start(T);
    if (this.op) this.run(h);
    this.follow();
  }

  // 집기: 눕힌 키트 윗면. 꽂기: 세운 키트 +z 면 가운데(책등 반대).
  pickTcp(at) { return [at[0], this.O.deck + this.kitH, at[1]]; }
  slotTcp(p) { return [p[0], p[1] + this.kitW / 2, p[2] + this.kitD / 2]; }

  start(T) {
    const i = this.slots.findIndex((s) => !s.kit);
    if (i < 0) return;
    T.started = true;
    const c = this.O.clear;
    const P0 = this.pickTcp(T.at), S = this.slots[i].p, P1 = this.slotTcp(S);
    const hi0 = [P0[0], Math.max(P0[1] + c + 0.25, 1.35), P0[2]];
    const mid = [P1[0], Math.max(P1[1] + 0.12, hi0[1]), (P0[2] + P1[2]) / 2];
    const face = [P1[0], P1[1], P1[2] + 0.42];
    const holder = { k: 'outg', cell: this.id };
    this.slots[i].kit = T.kit;
    const yaw0 = T.yaw ?? 0;
    const K = OUT_KEYS;
    this.op = {
      el: 0, ei: 0, time: this.O.time, yaw0,
      keys: [
        { t: 0, p: this.tcp.slice(), tilt: this.tilt, yaw: this.yaw },
        { t: 0.12, p: hi0, tilt: 0, yaw: yaw0 },
        { t: 0.2, p: [P0[0], P0[1] + c, P0[2]], tilt: 0, yaw: yaw0 },
        { t: 0.24, p: P0, tilt: 0, yaw: yaw0 },
        { t: K.grip, p: P0, tilt: 0, yaw: yaw0 },
        { t: 0.36, p: [P0[0], P0[1] + c + 0.25, P0[2]], tilt: 0.4, yaw: yaw0 * 0.7 },
        { t: K.release, p: hi0, tilt: 0.75, yaw: yaw0 * 0.45 },
        { t: 0.55, p: mid, tilt: STAND, yaw: 0 },
        { t: 0.66, p: face, tilt: STAND, yaw: 0 },
        { t: 0.74, p: P1, tilt: STAND, yaw: 0 },
        { t: K.drop, p: P1, tilt: STAND, yaw: 0 },
        { t: 0.86, p: face, tilt: STAND, yaw: 0 },
        { t: 0.93, p: [this.home[0], this.home[1], face[2]], tilt: 0.25, yaw: 0 },
        { t: 1, p: this.home.slice(), tilt: 0, yaw: 0 },
      ],
      events: [
        { t: K.grip, fn: () => {
          if (T.cancel) return;
          this.parts.hold(T.kit, holder, T.from); this.held = T.kit; T.gripped = true;
        } },
        { t: K.release, fn: () => { T.released = true; } },
        { t: K.drop, fn: () => {
          if (!this.held) { this.slots[i].kit = null; return; }
          this.parts.hold(this.held, { k: 'outslot', cell: this.id, i }, holder);
          this.held = null; this.stored++;
          if (this.slots.every((s) => s.kit)) this.shipAt = this.el + this.O.ship;
        } },
      ],
    };
  }

  run(h) {
    const op = this.op;
    op.el += h;
    const f = op.el >= op.time - 1e-9 ? 1 : op.el / op.time;
    while (op.ei < op.events.length && op.events[op.ei].t <= f + 1e-12) op.events[op.ei++].fn();
    let k = 0;
    while (k < op.keys.length - 2 && op.keys[k + 1].t <= f) k++;
    const A = op.keys[k], B = op.keys[k + 1];
    const u = B.t > A.t ? smooth(Math.min(1, Math.max(0, (f - A.t) / (B.t - A.t)))) : 1;
    this.tcp = lerp3(A.p, B.p, u);
    this.tilt = (A.tilt ?? 0) + ((B.tilt ?? 0) - (A.tilt ?? 0)) * u;
    this.yaw = (A.yaw ?? 0) + ((B.yaw ?? 0) - (A.yaw ?? 0)) * u;
    if (f >= 1) { this.op = null; this.ticket = null; this.tilt = 0; this.yaw = 0; }
  }

  follow() {
    const R = this.O.cobot.rail;
    this.rail = clamp(this.tcp[0], R.lo, R.hi);
  }

  ship() {
    const n = this.slots.filter((s) => s.kit).length;
    for (const s of this.slots) if (s.kit) { this.parts.remove(s.kit); s.kit = null; }
    this.shipped += n; this.batches++;
    this.shipAt = null;
    this.onShip?.(n);
  }

  // 위치(자리 로컬, 물건 밑면 중심). 5번째 = 세움 각(0 눕힘 · π/2 책처럼 세움).
  local(e) {
    const H = e.holder, t = this.tilt;
    if (H.k === 'outg') {
      const u = t / STAND;
      return [this.tcp[0], this.tcp[1] - this.kitH * (1 - u) - (this.kitW / 2) * u, this.tcp[2] - (this.kitD / 2) * u, this.yaw, t];
    }
    if (H.k === 'outslot') return [...this.slots[H.i].p, 0, STAND];
    return null;
  }

  view() {
    const C = this.O.cobot;
    const ik = armIk(C.base, C.L1, C.L2, this.tcp, this.rail);
    return {
      tcp: this.tcp.slice(), tilt: this.tilt, rail: this.rail, busy: !!this.op, held: !!this.held,
      cobot: C, shelf: this.O.shelf, ik, joints: jointsOf(C.base, C.L1, C.L2, ik, this.rail),
      slots: this.slots.map((s) => ({ p: s.p, full: !!s.kit })),
      stored: this.stored, shipped: this.shipped, shipIn: this.shipAt === null ? null : Math.max(0, this.shipAt - this.el),
    };
  }
}
