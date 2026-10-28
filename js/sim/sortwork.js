// SORT 양팔: 입고(AMR 적재면 → 랙)와 적재(랙 → AMR 적재면). 두 팔이 키트 양끝을 같이 잡는다. DOM·three 없음.
// 두 팔은 한 대차(슬라이드)에 앉아 있고 몸통이 돈다(가정: 몸통 회전축 = 두 팔 베이스 가운데 수직선). 대차 위치 s·몸통 각 w 는 두 팔이 같이 쓴다.
// 키트는 두 그리퍼 가운데에 붙는다. 팔마다 관절 공간으로 보간하면 두 그리퍼 사이가 벌어지므로, 매 스텝 키트 중심(몸통 좌표)을 보간하고
// 두 팔이 각자 그 양끝 점을 IK 로 따라간다(직전 자세에서 시작 — 결정론). rig 가 없으면 TCP = 그 양끝 점.
// 시각은 정의(time)와 시뮬 시간만 따른다 — rig 유무와 같다. 실제 셀 제어는 셀 PLC 몫이다.
import { chainOf, fk, ik, reach } from './kin.js';
import { PICK } from './cellwork.js';

const smooth = (u) => u * u * (3 - 2 * u);
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const baseName = (n) => String(n ?? '').replace(/\.\d+$/, '');
// 수직축(+y) 둘레 회전. three rotation.y 와 같은 방향.
const turnAt = (p, o, w) => {
  const c = Math.cos(w), s = Math.sin(w), dx = p[0] - o[0], dz = p[2] - o[2];
  return [o[0] + dx * c + dz * s, p[1], o[2] - dx * s + dz * c];
};
const angleTo = (u, v) => Math.atan2(u[2] * v[0] - u[0] * v[2], u[0] * v[0] + u[2] * v[2]);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const KEYS = [['R', 0], ['A0', 0.16], ['P0', 0.24], ['P0', PICK.grip], ['A0', PICK.lift], ['A1', 0.62], ['P1', 0.7], ['P1', PICK.drop], ['A1', 0.88], ['R', 1]];
// AMR 이 떠나도 되는 시각(놓고 든 뒤)
export const LOAD = Object.freeze({ release: 0.88 });

export class SortWork {
  // L: 공정 정의 cells.SORT.load + kit·deck. rack: Plant 의 랙 { pts, items }. feed: 부속 부품 분류(SortFeed, 있으면).
  constructor(id, L, parts, rack, feed = null) {
    this.id = id;
    this.L = L;
    this.parts = parts;
    this.rack = rack;
    this.feed = feed;
    this.kitH = L.kit.size[1] + (L.jig?.size[1] ?? 0);   // 지그째 옮긴다
    this.grip = L.grip;
    this.ticket = null;
    this.op = null;
    this.done = 0;
    this.inDone = 0;            // AMR → 랙 하역 횟수
    this.miss = 0;              // IK 가 못 따라간 최대 거리(m) — rig 있을 때만
    this.dock = null;
    this.rig = null;
    this.robots = L.robots.map((name) => ({ name, ch: null, pose: null, tcp: null, label: '대기' }));
    this.car = { s: 0, w: 0 };
    // rig 없을 때 기본 기하(양팔 베이스 가운데 = 랙 중심 x, 간격 = 키트 폭의 0.85)
    const r0 = this.rackPt(0);
    this.geo = { o: [r0[0], 1.15, r0[2] + 1.1], dir: [1, 0, 0], g: L.kit.size[0] * 0.425, axis: [0, 0, 1], lo: -0.5, hi: 0.8 };
    this.setup();
  }

  rackPt(i) { const p = this.rack.pts[i]; return [p.x, p.y, p.z]; }

  attachRig(rig) {
    this.rig = rig;
    const report = { robots: [], gantries: [], rollers: [], missing: [] };
    if (this.feed && rig) {
      const f = this.feed.attachRig(rig);
      report.gantries = f.gantries;
      report.rollers = Array.from({ length: f.rollers });
      report.missing.push(...f.missing);
    }
    if (!rig) return report;
    const arms = this.robots.map((r) => rig.arms.find((a) => baseName(a.name) === r.name));
    this.robots.forEach((r, i) => { if (!arms[i]?.tcp) report.missing.push(r.name); });
    if (arms.some((a) => !a?.tcp)) return report;
    const b0 = arms[0].joints[0].origin, b1 = arms[1].joints[0].origin;
    const d = [b1[0] - b0[0], 0, b1[2] - b0[2]], len = Math.hypot(d[0], d[2]) || 1;
    const T = rig.tracks[arms[0].track];
    const axis = T ? T.axis : [0, 0, 0];
    const along = (p) => p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2];
    const o = [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2, (b0[2] + b1[2]) / 2];
    // 대차 범위: 레일 끝 0.3 m 안쪽. 두 팔이 같은 대차라 이웃 간격 규칙은 쓰지 않는다.
    const lo = T ? along(T.origin) - T.span + 0.3 - along(o) : 0, hi = T ? along(T.origin) + T.span - 0.3 - along(o) : 0;
    this.geo = { o, dir: [d[0] / len, 0, d[2] / len], g: len / 2, axis, lo: Math.min(0, lo), hi: Math.max(0, hi) };
    this.robots.forEach((r, i) => { r.ch = chainOf(arms[i]); report.robots.push(r.name); });
    this.setup();
    return report;
  }

  // 몸통 좌표(대차 0·각 0) ↔ 셀 로컬
  fwd(p, s, w) { const q = turnAt(p, this.geo.o, w), a = this.geo.axis; return [q[0] + a[0] * s, q[1] + a[1] * s, q[2] + a[2] * s]; }
  inv(p, s, w) { const a = this.geo.axis; return turnAt([p[0] - a[0] * s, p[1] - a[1] * s, p[2] - a[2] * s], this.geo.o, -w); }
  ends(K) { const { dir, g } = this.geo; return [[K[0] - dir[0] * g, K[1], K[2] - dir[2] * g], [K[0] + dir[0] * g, K[1], K[2] + dir[2] * g]]; }

  // 대차 위치: 키트가 몸통 앞 reach 거리에 오도록, 범위 안으로.
  slideFor(K) {
    const { o, axis, lo, hi } = this.geo;
    const d = (K[0] - o[0]) * axis[0] + (K[2] - o[2]) * axis[2];
    return Math.min(hi, Math.max(lo, d - Math.sign(d) * this.L.reach));
  }

  // 준비 자세: 랙 쪽으로 몸통 앞 0.55 m, 높이 L.readyY. 랙 키트가 몸통 기준 앞쪽(w=0)이다.
  setup() {
    const { o } = this.geo, r = this.rackPt(0);
    const f = [r[0] - o[0], 0, r[2] - o[2]], n = Math.hypot(f[0], f[2]) || 1;
    this.front = [f[0] / n, 0, f[2] / n];
    this.readyK = [o[0] + this.front[0] * 0.55, this.L.readyY, o[2] + this.front[2] * 0.55];
    this.car = { s: 0, w: 0 };
    for (const [i, r] of this.robots.entries()) {
      const p = this.ends(this.readyK)[i];
      if (r.ch) {
        const z = { q: r.ch.joints.map(() => 0), s: 0 };
        const sol = reach(r.ch, p, z, z);
        r.ready = { q: sol.q, s: 0, w: 0 };
        r.pose = r.ready;
        r.tcp = fk(r.ch, r.ready.q).p;
      } else { r.ready = null; r.pose = null; r.tcp = p; }
    }
  }

  // ── AMR 적재 핸드셰이크: AMR 이 도크에 서면 Plant 가 load → 팔이 랙 키트를 집어 AMR 에 놓고 든 뒤 released ──
  // to: 키트를 놓을 AMR 소유자, at: AMR 위치(셀 로컬 {x,z}), back(kit): 취소된 적재의 키트를 랙으로 되돌림(Plant)
  // 양팔은 하나: 입고(뒤)와 적재(앞)를 동시에 못 한다. 바쁜 동안 load·unload 는 false → ACS 가 다시 묻는다.
  // released 뒤(팔 복귀 0.88–1)에는 다음 티켓을 받는다 — run 이 옛 티켓만 지운다.
  busy() { return !!(this.ticket && !this.ticket.released && !this.ticket.cancel); }

  load(kit, to, at, back) {
    if (this.busy()) return false;
    this.ticket = { kind: 'load', kit, to, at: [at.x, at.z], back, started: false, gripped: false, released: false, cancel: false };
    return this.ticket;
  }

  // ── AMR 하역(입고): 적재면 키트를 집어 빈 랙 칸에 놓음. 든 뒤(PICK.lift) released → AMR 출발. ──
  // from: 지금 소유자(AMR), at: AMR 위치, onOk(kit): 랙에 놓은 뒤(Plant 가 kits 에 넣음)
  unload(kit, from, at, onOk, heading, deck) {
    if (this.busy()) return false;
    const i = this.rack.items.indexOf(null);
    if (i < 0) return { released: true };
    this.rack.items[i] = kit;
    this.ticket = { kind: 'unload', kit, from, at: [at.x, at.z], heading, deck, slot: i, onOk, started: false, gripped: false, released: false, cancel: false };
    return this.ticket;
  }

  step(h, down) {
    if (down) return;
    this.feed?.step(h);
    const T = this.ticket;
    if (T && !T.started) {
      if (T.cancel) {
        if (T.kind === 'unload' && T.slot != null && this.rack.items[T.slot] === T.kit) this.rack.items[T.slot] = null;
        this.ticket = null;
      } else if (!this.op) this.start(T);
    }
    this.run(h);
  }

  start(T) {
    if (T.kind === 'unload') { this.startIn(T); return; }
    const i = this.rack.items.indexOf(T.kit);
    if (i < 0) { T.released = true; this.ticket = null; return; }
    T.started = true;
    const g = this.kitH * (1 - this.grip), c = this.L.clear;
    const P0 = this.rackPt(i); P0[1] += g;
    const P1 = [T.at[0], this.L.deck + g, T.at[1]];
    const s0 = this.slideFor(P0), s1 = this.slideFor(P1);
    // 몸통 각: 랙 쪽 앞방향 → AMR 쪽. 키트는 그만큼 돌아서 놓인다 — 랙에는 그 반대로 놓여 있다(yaw0).
    const p1 = [P1[0] - this.geo.axis[0] * s1, 0, P1[2] - this.geo.axis[2] * s1];
    const w1 = angleTo(this.front, [p1[0] - this.geo.o[0], 0, p1[2] - this.geo.o[2]]);
    const at = (p, s, w) => ({ K: this.inv(p, s, w), s, w });
    const pts = { R: { K: this.readyK, s: 0, w: 0 }, A0: at([P0[0], P0[1] + c, P0[2]], s0, 0), P0: at(P0, s0, 0), A1: at([P1[0], P1[1] + c, P1[2]], s1, w1), P1: at(P1, s1, w1) };
    const pairH = { k: 'pair', cell: this.id };
    const kit = T.kit;
    this.op = {
      el: 0, ei: 0, time: this.L.time, w1, T,
      keys: KEYS.map(([k, t]) => ({ t, ...pts[k] })),
      events: [
        { t: PICK.grip, fn: () => { this.parts.hold(kit, pairH, kit.holder); T.gripped = true; } },
        { t: PICK.drop, fn: () => {
          if (T.cancel) T.back(kit, pairH);
          else this.parts.hold(kit, T.to, pairH);
        } },
        { t: LOAD.release, fn: () => { T.released = true; if (!T.cancel) this.done++; } },
      ],
    };
    for (const r of this.robots) r.label = `${this.id} 적재`;
  }

  // 입고: 랙 뒤 AMR(P0, 몸통은 AMR 쪽) → 랙(P1, 몸통 앞). 든 뒤 AMR 이 떠나고 팔이 랙에 놓는다.
  startIn(T) {
    const i = T.slot, kit = T.kit;
    if (i == null || this.rack.items[i] !== kit) { T.released = true; this.ticket = null; return; }
    T.started = true;
    const g = this.kitH * (1 - this.grip), c = this.L.clear;
    const P1 = this.rackPt(i); P1[1] += g;
    const P0 = [T.at[0], (T.deck ?? this.L.deck) + g, T.at[1]];
    const s0 = this.slideFor(P0), s1 = this.slideFor(P1);
    const p0 = [P0[0] - this.geo.axis[0] * s0, 0, P0[2] - this.geo.axis[2] * s0];
    const w0 = angleTo(this.front, [p0[0] - this.geo.o[0], 0, p0[2] - this.geo.o[2]]);
    const at = (p, s, w) => ({ K: this.inv(p, s, w), s, w });
    const pts = { R: { K: this.readyK, s: 0, w: 0 }, A0: at([P0[0], P0[1] + c, P0[2]], s0, w0), P0: at(P0, s0, w0), A1: at([P1[0], P1[1] + c, P1[2]], s1, 0), P1: at(P1, s1, 0) };
    const pairH = { k: 'pair', cell: this.id };
    const yaw0 = Number.isFinite(T.heading) ? T.heading - Math.PI / 2 : this.rackYaw() + w0;
    this.op = {
      el: 0, ei: 0, time: this.L.time, w1: w0, T, yaw0, yaw1: this.rackYaw(),
      keys: KEYS.map(([k, t]) => ({ t, ...pts[k] })),
      events: [
        { t: PICK.grip, fn: () => { this.parts.hold(kit, pairH, kit.holder); T.gripped = true; } },
        { t: PICK.drop, fn: () => {
          if (T.cancel) {
            if (this.rack.items[i] === kit) this.rack.items[i] = null;
            this.parts.remove(kit);
          } else {
            this.parts.hold(kit, { k: 'rack', cell: this.id, i }, pairH);
            T.onOk?.(kit);
          }
        } },
        { t: LOAD.release, fn: () => { T.released = true; if (!T.cancel) this.inDone++; } },
      ],
    };
    for (const r of this.robots) r.label = `${this.id} 하역`;
  }

  run(h) {
    const op = this.op;
    if (!op) { this.car = { s: 0, w: 0 }; for (const r of this.robots) { r.pose = r.ready; r.tcp = r.ch ? this.fwd(fk(r.ch, r.ready.q).p, 0, 0) : this.ends(this.readyK)[this.robots.indexOf(r)]; } return; }
    op.el += h;
    const f = op.el >= op.time - 1e-9 ? 1 : op.el / op.time;
    this.poseAt(op, f);
    while (op.ei < op.events.length && op.events[op.ei].t <= f + 1e-12) op.events[op.ei++].fn();
    if (f >= 1) {
      this.op = null;
      // AMR 은 released 에서 떠나고 다음 AMR 이 팔 복귀 중에 새 티켓을 낼 수 있다 — 그 티켓은 지우지 않는다.
      if (this.ticket === op.T) this.ticket = null;
      for (const r of this.robots) r.label = '대기';
    }
  }

  poseAt(op, f) {
    const K = op.keys;
    let k = 0;
    while (k < K.length - 2 && K[k + 1].t <= f) k++;
    const A = K[k], B = K[k + 1];
    const u = B.t > A.t ? smooth(Math.min(1, Math.max(0, (f - A.t) / (B.t - A.t)))) : 1;
    const Kp = lerp3(A.K, B.K, u), s = lerp(A.s, B.s, u), w = lerp(A.w, B.w, u);
    this.car = { s, w };
    op.K = Kp;
    const ends = this.ends(Kp);
    this.robots.forEach((r, i) => {
      if (!r.ch) { r.tcp = this.fwd(ends[i], s, w); return; }
      const sol = ik(r.ch, ends[i], { seed: (r.pose ?? r.ready).q });
      if (op.T.kind !== 'unload' && sol.err > this.miss) this.miss = sol.err;
      r.pose = { q: sol.q, s, w };
      r.tcp = this.fwd(fk(r.ch, sol.q).p, s, w);
    });
  }

  // 위치(셀 로컬, 밑면 중심, 넷째 값 = 셀 기준 yaw)
  local(e) {
    if (this.feed && (e.holder.k === 'xfer' || e.holder.k === 'belt')) return this.feed.local(e);
    if (e.holder.k !== 'pair' || !this.op?.K) return null;
    const p = this.fwd(this.op.K, this.car.s, this.car.w);
    return [p[0], p[1] - e.h * (1 - this.grip), p[2], this.kitYaw()];
  }

  // 입고: AMR 적재면 yaw → 랙 yaw 로 보간(뒤쪽 도크 heading 이 북쪽 적재와 다름). 적재는 랙 yaw + 몸통 각.
  kitYaw() {
    const op = this.op;
    if (op?.yaw0 != null && op.yaw1 != null) {
      const f = op.el >= op.time - 1e-9 ? 1 : op.el / op.time;
      const t = f <= PICK.grip ? 0 : f >= PICK.drop ? 1 : (f - PICK.grip) / (PICK.drop - PICK.grip);
      return op.yaw0 + wrap(op.yaw1 - op.yaw0) * smooth(t);
    }
    return this.rackYaw() + this.car.w;
  }

  // 랙에 놓인 키트의 yaw: 몸통이 w1 만큼 돌아 AMR(셀 기준 yaw 0)에 놓이도록 −w1. 도크 위치가 바뀌어도 같은 규칙.
  rackYaw() {
    const P1 = this.dock ? [this.dock.x, 0, this.dock.z] : null;
    if (!P1) return Math.PI;
    const s1 = this.slideFor(P1), p1 = [P1[0] - this.geo.axis[0] * s1, 0, P1[2] - this.geo.axis[2] * s1];
    return -angleTo(this.front, [p1[0] - this.geo.o[0], 0, p1[2] - this.geo.o[2]]);
  }

  unit() { return { busy: !!this.op }; }

  view() {
    return {
      robots: this.robots.map((r) => ({ name: r.name, pose: r.pose, index: r.ch?.index ?? null, tcp: r.tcp, label: r.label, busy: !!this.op, turn: { o: this.geo.o, w: this.car.w } })),
      lines: this.feed?.lines() ?? [],
      stations: [],
      locks: {},
      body: this.L.body ? { name: this.L.body, axis: this.geo.axis, s: this.car.s, o: this.geo.o, w: this.car.w } : null,
    };
  }
}
