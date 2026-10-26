// 셀 안 공정: 스테이션 흐름 · 로봇 집기/놓기 · 작업 구역 잠금 · 갠트리(직교이송) 공급 · 롤러 적재 컨베이어 · AMR 하역 핸드셰이크. DOM·three 없음.
// 부품 AMR 토트 모드: 상자를 팔레트에 덤프 → 직교이송이 상자를 롤러에 올림 → 롤러가 당김 → 협동로봇이 상자에서 부품을 집음.
// 좌표는 셀 로컬(m). 시간·순서는 정의(process.default.json)와 시뮬 시간만 따른다 — GLB 기구(rig)를 붙여도 공정 시각은 같다(결정론).
// rig 를 붙이면 로봇 관절각(IK)과 TCP 가 생기고, 집힌 물건은 TCP 를 따라간다. 없으면 작업 지점 사이 직선 보간.
// 이 모듈은 시뮬 안의 셀 동작 모델이다. 실제 셀의 실시간 제어(로봇·서보)는 셀 PLC 몫이고 OCS 는 수집·감독·재계획만 한다.
import { chainOf, fk, ik, lerpPose, reach } from './kin.js';
import { halfOf } from './process.js';

const smooth = (u) => u * u * (3 - 2 * u);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const up = (p, d) => [p[0], p[1] + d, p[2]];
const baseName = (n) => String(n ?? '').replace(/\.\d+$/, '');

// 집기·놓기 키 프레임(작업 시간 비율). 준비 → 집기 위 → 집기 → (물기) → 들기 → 준비(접고 돈다) → 놓기 위 → 놓기 → (압입·풀기) → 들기 → 준비.
// 가운데 준비 자세(투입 작업만): 팔을 편 채 반 바퀴 돌면 TCP 가 너무 빠르고 이웃 구역을 쓸고 지나가서, 접은 자세로 돈다.
export const PICK = Object.freeze({ grip: 0.3, lift: 0.38, drop: 0.8 });
const PP = [['R', 0], ['A0', 0.16], ['P0', 0.24], ['P0', PICK.grip], ['A0', PICK.lift], ['R', 0.56], ['A1', 0.64], ['P1', 0.7], ['P1', PICK.drop], ['A1', 0.88], ['R', 1]];
// 갠트리: (가로 위치, 패드 밑면 높이) 키 프레임. 적재 팔레트에서 하나 들어 라인 투입 칸에 내린다.
export const FEED = Object.freeze({ grip: 0.44, away: 0.76, drop: 0.9 });
// 준비 자세: 베이스 위 0.75 m, CAD 공구 쪽으로 0.55 m.
export const READY = Object.freeze({ up: 0.75, out: 0.55 });
// 반출: 마지막 스테이션 → 도크 AMR 적재면. 앞 스테이션 위를 지나가므로, 두 스테이션 사이 틈(E)에서 그 작업 구역 높이 위로
// CARRY 만큼 올라 건너편(W)까지 수평으로 가고 도크로 내린다. 키 시각은 PRESS·SCREW rig 경로 길이 비율에 맞춘 값이다.
// 동쪽 도크 AMR 은 heading −π/2 라 키트 yaw 가 스테이션(0)과 π 차이 — 집기~놓기 동안 보간한다(스텝당 점프 방지).
// 도크 로봇이 마지막 스테이션까지 레일을 타야 해서, 사이 로봇(yield)이 그동안 반대쪽으로 비켜선다.
export const OUT = Object.freeze({ grip: 0.35, drop: 0.8, release: 0.85, carry: 0.08 });
const UP = [['R', 0], ['A0', 0.25], ['P0', 0.3], ['P0', OUT.grip], ['A0', 0.4], ['E', 0.45], ['W', 0.57], ['A1', 0.7], ['P1', 0.75], ['P1', OUT.drop], ['A1', OUT.release], ['R', 1]];

export class CellWork {
  constructor(id, P, parts) {
    this.id = id;
    this.P = P;
    this.parts = parts;
    this.kitH = P.kit.size[1];
    this.grip = P.grip;
    this.done = 0;
    this.ticket = null;
    this.out = null;            // 반출 티켓(도크에 선 빈 AMR)
    this.reserved = null;       // 투입 예약한 AMR id (첫 스테이션이 비었을 때만 한 대)
    this.dock = null;           // 서쪽 투입 도크(셀 로컬 {x,z}) — Plant 가 레이아웃에서 넣는다
    this.outDock = null;        // 동쪽 반출 도크(셀 로컬 {x,z}) — 없으면 투입 도크를 같이 씀
    this.locks = {};            // 구역 → 로봇 이름
    this.lockFaults = 0;        // 잠금 규칙 위반(두 로봇이 같은 구역) — 0 이어야 한다
    this.intrude = 0;           // 잠금 없이 구역 작업 높이 안에 들어간 TCP 스텝 수 — rig 있을 때만 셀 수 있다
    this.rig = null;
    this.toteFeed = false;      // 부품 AMR 토트: 상자를 그대로 덤프·직교이송·롤러 → 협동로봇이 상자에서 집음
    this.cache = new Map();
    this.stations = {};
    for (const [name, p] of Object.entries(P.stations)) {
      this.stations[name] = { name, p: [p.x, p.y, p.z], kit: null, phase: 'empty', flow: null, stepI: 0, run: null, el: 0 };
      for (const z of ['s', 'n']) this.locks[name + z] = null;
    }
    this.locks.dock = null;
    this.locks.outdock = null;
    P.flow.forEach((f, i) => { const S = this.stations[f.station]; S.flow = f; S.last = i === P.flow.length - 1; });
    this.robots = {};
    this.unloadOp = P.flow.at(-1).steps.at(-1).find((op) => op.do === 'unload') ?? null;
    const names = [P.handoff.robot, ...P.lines.map((L) => L.robot), ...P.flow.flatMap((f) => f.steps.flat().flatMap((op) => [op.robot, op.yield?.robot]).filter(Boolean))];
    for (const n of names) this.robots[n] ??= { name: n, ch: null, ready: null, pose: null, tcp: null, op: null, label: '대기' };
    this.lines = P.lines.map((L) => {
      const part = P.parts[L.part];
      const len = Math.abs(L.out - L.in);
      const line = {
        ...L, dir: Math.sign(L.out - L.in), len, size: part.size, h: part.size[1], items: [], travel: 0, stock: null, rig: null,
        left: Infinity, incoming: 0, gap: false,   // 적재 팔레트 남은 수(보이는 하나 포함) · 오는 토트 수 · 갠트리가 집고 다음 것 올리기 전
        feed: L.gantry,
        gantry: { z: L.in, y: L.gantry.up, op: null, held: null, travel: 0 },
      };
      for (let s = len; s >= -1e-9; s -= L.pitch) line.items.push(this.newPart(line, { k: 'line', cell: id, line: L.id, s: Math.max(0, s) }));
      line.stock = this.newPart(line, { k: 'stock', cell: id, line: L.id });
      return line;
    });
    this.lineOf = Object.fromEntries(this.lines.map((L) => [L.id, L]));
  }

  newPart(L, holder) { return this.parts.add(L.part, holder, { size: L.size, h: L.h, color: this.P.parts[L.part].color }); }

  // ── 기구 붙이기 (rigdata.js cellRig 결과, 셀 로컬) ──
  attachRig(rig) {
    this.rig = rig;
    const report = { robots: [], gantries: [], rollers: [], missing: [] };
    if (!rig) return report;
    for (const r of Object.values(this.robots)) {
      const arm = rig.arms.find((a) => baseName(a.name) === r.name);
      if (!arm?.tcp) { report.missing.push(r.name); continue; }
      const T = rig.tracks[arm.track];
      const track = T ? { axis: T.axis, ...this.slideRange(rig, arm, T) } : null;
      r.ch = chainOf(arm, { track });
      r.arm = arm;
      r.track = track;
      const b = r.ch.base, d = [r.ch.tcp[0] - b[0], 0, r.ch.tcp[2] - b[2]], L = Math.hypot(d[0], d[2]) || 1;
      const sol = ik(r.ch, [b[0] + (d[0] / L) * READY.out, b[1] + READY.up, b[2] + (d[2] / L) * READY.out]);
      r.ready = sol.ok ? { q: sol.q, s: 0 } : { q: r.ch.joints.map(() => 0), s: 0 };
      r.pose = r.ready;
      r.tcp = fk(r.ch, r.ready.q, r.ready.s).p;
      if (r.op) r.op.Q = null;
      report.robots.push(r.name);
    }
    this.outChain(rig);
    for (const L of this.lines) {
      const g = rig.gantries
        .filter((G) => Math.abs(G.horiz[2]) > 0.9 && Math.abs(G.origin[0] - L.x) < 0.8 && G.travel[0] - 0.1 <= Math.min(L.in, L.feed.stock) && G.travel[1] + 0.1 >= Math.max(L.in, L.feed.stock))
        .sort((a, b) => Math.abs(a.origin[0] - L.x) - Math.abs(b.origin[0] - L.x))[0];
      L.rig = L.rig ?? {};
      if (g) {
        L.rig.gantry = { name: g.name, node: g.node, home: g.toolOrigin[2], padHome: g.toolBottom ?? g.toolOrigin[1], sign: Math.sign(g.horiz[2]) };
        report.gantries.push(`${L.id}:${g.name}`);
      }
      const lo = Math.min(L.in, L.out), hi = Math.max(L.in, L.out);
      const r = rig.rollers
        .filter((R) => R.rods.length && Math.abs(R.rods[0].axis[0]) > 0.9 && R.min[0] <= L.x && R.max[0] >= L.x && R.min[2] < hi && R.max[2] > lo)
        .map((R) => ({ R, ov: Math.min(hi, R.max[2]) - Math.max(lo, R.min[2]) }))
        .sort((a, b) => b.ov - a.ov)[0]?.R;
      if (r) {
        L.rig.rollers = { name: r.name, node: r.node, rods: r.rods.map((w) => w.node), radius: r.rods[0].radius, top: r.top };
        report.rollers.push(`${L.id}:${r.name}`);
      }
    }
    return report;
  }

  // 레일 직동 범위: 같은 레일 이웃 로봇과의 중간점에서 railGap/2 띄우고, 레일 끝 0.3 m 안쪽.
  slideRange(rig, arm, T) {
    const ax = T.axis, along = (p) => p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2];
    const me = along(arm.joints[0].origin), c = along(T.origin);
    const others = rig.arms.filter((a) => a !== arm && a.track === arm.track && a.joints[0]).map((a) => along(a.joints[0].origin));
    const gap = this.P.railGap / 2;
    let lo = c - T.span + 0.3 - me, hi = c + T.span - 0.3 - me;
    for (const o of others) {
      if (o < me) lo = Math.max(lo, (o - me) / 2 + gap);
      else hi = Math.min(hi, (o - me) / 2 - gap);
    }
    return { lo: Math.min(0, lo), hi: Math.max(0, hi) };
  }

  // 반출 로봇 레일 범위: 사이 로봇이 yield.s 만큼 비켜선 자리에서 railGap 띄운 데까지(반출 작업 동안만 쓴다).
  outChain(rig) {
    const U = this.unloadOp;
    if (!U) return;
    const r = this.robots[U.robot], Y = U.yield ? this.robots[U.yield.robot] : null;
    r.chOut = null;
    if (!r.ch || !r.track || !rig.tracks[r.arm.track]) return;
    const T = rig.tracks[r.arm.track], ax = T.axis, along = (p) => p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2];
    const me = along(r.arm.joints[0].origin);
    let hi = along(T.origin) + T.span - 0.3 - me;
    if (Y?.arm) {
      Y.yieldS = Math.min(U.yield.s, Y.track?.hi ?? U.yield.s);
      hi = Math.min(hi, along(Y.arm.joints[0].origin) + Y.yieldS - me - this.P.railGap);
    }
    r.chOut = chainOf(r.arm, { track: { axis: ax, lo: r.track.lo, hi: Math.max(r.track.hi, hi) } });
  }

  // 시작 재고: 첫 스테이션에 키트 하나(작업 시작 상태).
  seed() {
    const S = this.stations[this.P.handoff.to];
    if (S.kit) return null;
    S.kit = this.parts.add('kit', { k: 'station', cell: this.id, st: S.name }, { size: this.P.kit.size, h: this.kitH, color: this.P.kit.color, model: this.P.kit.model ?? null, lay: this.P.kit.lay ?? null });
    S.phase = 'work'; S.stepI = 0; S.run = null; S.el = 0;
    return S.kit;
  }

  // ── AMR 하역 핸드셰이크: 도착 → (canAccept) → offer → 로봇이 집어 든 뒤 released → AMR 출발 → 놓음 ──
  canAccept(down) {
    const S = this.stations[this.P.handoff.to];
    return !down && !this.ticket && S.phase === 'empty' && !S.kit;
  }

  offer(kit, from, at) {
    this.ticket = { kit, from, at: [at.x, at.z], gripped: false, released: false, started: false };
    this.stations[this.P.handoff.to].phase = 'incoming';
    return this.ticket;
  }

  // 레이아웃 변경 등으로 AMR 이 사라질 때. 아직 안 집었으면 되돌리고, 집었으면 셀이 가진다.
  cancel(ticket) {
    if (this.ticket !== ticket) return false;
    if (ticket.started) { ticket.orphan = true; return true; }
    this.ticket = null;
    this.stations[this.P.handoff.to].phase = 'empty';
    return false;
  }

  // ── 반출 핸드셰이크: 빈 AMR 이 도크에 서면 offerOut → 로봇이 완료품을 적재면에 놓고 들면 released → AMR 출발 ──
  lastStation() { return this.stations[this.P.flow.at(-1).station]; }

  // 곧 반출(마지막 스테이션이 반출 앞 단계 이상) — 배차를 미리 건다
  outSoon() {
    const S = this.lastStation();
    return !!this.unloadOp && !this.out && S.phase === 'work' && S.stepI >= S.flow.steps.length - 2 && !!S.kit;
  }

  outReady() {
    const S = this.lastStation();
    return !!this.unloadOp && !this.out && S.phase === 'work' && S.stepI === S.flow.steps.length - 1 && !!S.kit;
  }

  offerOut(to, at, yaw = 0) {
    this.out = { to, at: [at.x, at.z], yaw, kit: null, started: false, loaded: false, released: false, cancel: false };
    return this.out;
  }

  // AMR 이 사라질 때. 로봇이 아직 안 움직였으면 티켓을 거두고, 움직였으면 놓을 때 완료품을 치운다.
  cancelOut(T) {
    if (this.out !== T) return;
    if (T.started) T.cancel = true;
    else this.out = null;
  }

  // ── 진행 ──
  step(h, down) {
    if (down) return;
    this.runLines(h);
    this.runGantries(h);
    this.runHandoff();
    for (const f of this.P.flow) this.runStation(this.stations[f.station], h);
    for (const r of Object.values(this.robots)) this.runRobot(r, h);
    this.audit();
  }

  runLines(h) {
    for (const L of this.lines) {
      let moved = false;
      for (let i = 0; i < L.items.length; i++) {
        const H = L.items[i].holder;
        const lim = i === 0 ? L.len : L.items[i - 1].holder.s - this.linePitch(L);
        const s = Math.min(lim, H.s + L.speed * h);
        if (s > H.s + 1e-12) { H.s = s; moved = true; }
      }
      if (moved) L.travel += L.speed * h;
    }
  }

  // 롤러 위 상자 간격: 토트 깊이 + 여유. 부품만 있을 때는 정의 pitch.
  linePitch(L) {
    const sample = L.items.find((e) => e.type === 'tote') ?? (L.stock?.type === 'tote' ? L.stock : L.gantry.held?.type === 'tote' ? L.gantry.held : null);
    if (sample?.size?.[2]) return Math.max(L.pitch, sample.size[2] + 0.1);
    return L.pitch;
  }

  runGantries(h) {
    for (const L of this.lines) {
      const G = L.gantry;
      if (!G.op) {
        const inFree = !L.items.length || L.items.at(-1).holder.s >= this.linePitch(L) - 1e-9;
        if (inFree && L.stock) G.op = this.gantryOp(L);
      }
      if (!G.op) continue;
      const op = G.op;
      op.el += h;
      const f = op.el >= op.time - 1e-9 ? 1 : op.el / op.time;
      while (op.ei < op.events.length && op.events[op.ei].t <= f + 1e-12) op.events[op.ei++].fn();
      let k = 0;
      while (k < op.keys.length - 2 && op.keys[k + 1].t <= f) k++;
      const A = op.keys[k], B = op.keys[k + 1];
      const u = B.t > A.t ? smooth(Math.min(1, Math.max(0, (f - A.t) / (B.t - A.t)))) : 1;
      const z = A.z + (B.z - A.z) * u;
      G.travel += Math.abs(z - G.z);
      G.z = z; G.y = A.y + (B.y - A.y) * u;
      if (f >= 1) G.op = null;
    }
  }

  gantryOp(L) {
    const G = L.gantry, cfg = L.feed, e0 = L.stock;
    const z0 = G.z, y0 = G.y, hi = cfg.up;
    const h = e0.h ?? L.h, tote = e0.type === 'tote';
    const atStock = cfg.stockY + h, atLine = L.y + h;
    const key = (t, z, y) => ({ t, z, y });
    const holder = { k: 'gantry', cell: this.id, line: L.id };
    const op = {
      el: 0, ei: 0, time: cfg.time,
      keys: [key(0, z0, y0), key(0.08, z0, hi), key(0.3, cfg.stock, hi), key(0.38, cfg.stock, atStock), key(FEED.grip, cfg.stock, atStock),
        key(0.52, cfg.stock, hi), key(FEED.away, L.in, hi), key(0.84, L.in, atLine), key(FEED.drop, L.in, atLine), key(1, L.in, hi)],
      events: [
        { t: FEED.grip, fn: () => { G.held = L.stock; this.parts.hold(L.stock, holder, L.stock.holder); L.stock = null; if (!tote) L.left--; L.gap = true; } },
        { t: FEED.away, fn: () => { L.gap = false; this.restock(L); } },
        { t: FEED.drop, fn: () => {
          const e = G.held; G.held = null;
          this.parts.hold(e, { k: 'line', cell: this.id, line: L.id, s: 0 }, holder);
          L.items.push(e);
        } },
      ],
    };
    return op;
  }

  // ── 적재 팔레트 재고: 기본은 무한(갠트리가 집으면 다음 작은 부품이 생긴다). 부품 AMR 이 있으면 enableTote — 상자를 그대로 둔다. ──
  limitStock(qty) {
    for (const L of this.lines) {
      L.left = qty;
      if (qty <= 0 && L.stock && !L.gantry.op) { this.parts.remove(L.stock); L.stock = null; }
      this.restock(L);
    }
  }

  restock(L) {
    if (this.toteFeed) return;
    if (!L.stock && !L.gap && L.left > 0) L.stock = this.newPart(L, { k: 'stock', cell: this.id, line: L.id });
  }

  // 부품 AMR 공급: 시작 재고를 비우고, 이후 재고는 토트 상자 그대로(작은 부품으로 바꾸지 않음).
  enableTote(S) {
    this.toteFeed = true;
    for (const L of this.lines) {
      for (const e of L.items) this.parts.remove(e);
      L.items = [];
      if (L.stock) { this.parts.remove(L.stock); L.stock = null; }
      if (L.gantry.held) { this.parts.remove(L.gantry.held); L.gantry.held = null; }
      L.gantry.op = null;
      L.left = S.start ?? 0;
      L.incoming = 0;
      L.gap = false;
    }
  }

  canAcceptTote(L) { return !L.stock; }

  // 라인 팔레트에 토트를 그대로 둔다. 직교이송이 집어 롤러로 옮긴다.
  acceptTote(L, t) {
    if (!t) return;
    this.parts.hold(t, { k: 'stock', cell: this.id, line: L.id }, t.holder);
    L.stock = t;
    L.left += t.n ?? 0;
    L.incoming = 0;
  }

  // 부품 토트를 팔레트에 비움(토트 모드가 아닐 때 — 작은 부품 재고)
  refill(L, n) {
    L.left += n;
    this.restock(L);
  }

  runHandoff() {
    const T = this.ticket;
    if (!T || T.started) return;
    const H = this.P.handoff, r = this.robots[H.robot], S = this.stations[H.to];
    const zones = ['dock', `${H.to}s`, `${H.to}n`];
    if (r.op || !this.free(zones, r)) return;
    T.started = true;
    const kitHolder = T.from;
    const P0 = [T.at[0], this.P.deck + this.kitH * (1 - this.grip), T.at[1]];
    const P1 = up(S.p, this.kitH * (1 - this.grip));
    const robotH = { k: 'robot', cell: this.id, r: r.name };
    this.startOp(r, {
      label: `${this.id} 하역(${H.to})`, time: H.time, zones,
      keys: this.pickKeys(P0, P1),
      events: [
        { t: PICK.grip, fn: () => { this.parts.hold(T.kit, robotH, kitHolder); T.gripped = true; } },
        { t: PICK.lift, fn: () => { T.released = true; } },
        { t: PICK.drop, fn: () => { this.parts.hold(T.kit, { k: 'station', cell: this.id, st: S.name }, robotH); S.kit = T.kit; } },
      ],
      end: () => { S.phase = 'work'; S.stepI = 0; S.run = null; S.el = 0; this.ticket = null; },
    });
  }

  // 한 스텝 안에서 단계가 끝나면 바로 다음 단계를 시작한다(단계 사이에 스텝을 잃지 않게 — 사이클 합이 정의와 같도록).
  runStation(S, h) {
    const f = S.flow;
    for (let guard = 0; guard < 8; guard++) {
      if (S.phase === 'empty' && f.from && !S.kit && this.stations[f.from].phase === 'done') { S.phase = 'work'; S.stepI = 0; S.run = null; S.el = 0; }
      if (S.phase !== 'work') return;
      S.run ??= f.steps[S.stepI].map((op) => ({ op, state: 'wait', el: 0 }));
      for (const j of S.run) if (j.state === 'wait') this.tryStart(S, j);
      if (!S.run.every((j) => j.state === 'done')) break;
      S.stepI++; S.run = null;
      if (S.stepI < f.steps.length) continue;
      if (S.last) {
        if (S.kit) this.parts.remove(S.kit);
        S.kit = null; S.phase = 'empty';
        this.done++;
      } else S.phase = 'done';
    }
    if (S.phase !== 'work') return;
    S.el += h;
    for (const j of S.run ?? []) if (j.state === 'dwell') { j.el += h; if (j.el >= j.op.time - 1e-9) j.state = 'done'; }
  }

  tryStart(S, j) {
    const op = j.op, kitH = this.kitH, g = this.grip;
    if (op.do === 'dwell') { j.state = 'dwell'; j.el = 0; return; }
    if (op.do === 'feed') {
      const L = this.lineOf[op.line], r = this.robots[L.robot];
      let e = L.items[0];
      if (e?.type === 'tote' && !(e.n > 0)) { L.items.shift(); this.parts.remove(e); e = L.items[0]; }
      if (r.op || !e || e.holder.s < L.len - 1e-9 || !S.kit) return;
      const at = this.P.parts[L.part].at, zones = [halfOf(S.name, at)];
      if (!this.free(zones, r)) return;
      const robotH = { k: 'robot', cell: this.id, r: r.name };
      const kit = S.kit;
      const tote = e.type === 'tote';
      const part = tote ? this.newPart(L, { k: 'tote', tote: e.id, at: [0, 0, 0] }) : e;
      const P0 = tote
        ? [L.x, L.y + 0.04 + L.h * (1 - g), L.out]
        : [L.x, L.y + e.h * (1 - g), L.out];
      const P1 = [S.p[0] + at[0], S.p[1] + kitH + (at[2] ?? 0) + L.h * (1 - g), S.p[2] + at[1]];
      const from = tote ? { k: 'tote', tote: e.id } : e.holder;
      j.state = 'run';
      this.startOp(r, {
        label: `${L.part} ${L.id}→${S.name}`, time: op.time, zones, keys: this.pickKeys(P0, P1, true),
        events: [
          { t: PICK.grip, fn: () => {
            this.parts.hold(part, robotH, from);
            if (tote) {
              e.n--;
              L.left--;
              if (e.n <= 0) { L.items.shift(); this.parts.remove(e); }
            } else L.items.shift();
          } },
          { t: PICK.drop, fn: () => { this.parts.hold(part, { k: 'kit', kit: kit.id, at }, robotH); } },
        ],
        end: () => { j.state = 'done'; },
      });
      return;
    }
    const r = this.robots[op.robot];
    if (r.op) return;
    if (op.do === 'unload') {
      const T = this.out, Y = op.yield ? this.robots[op.yield.robot] : null;
      const zones = [`${S.name}s`, `${S.name}n`, this.outDock ? 'outdock' : 'dock'];
      if (!T || T.started || !S.kit || Y?.op || !this.free(zones, r)) return;
      T.started = true;
      j.state = 'run';
      if (Y) {
        const s = Y.yieldS ?? op.yield.s;
        this.startOp(Y, {
          label: `비켜섬(${r.name} 반출)`, time: op.time, zones: [], events: [],
          keys: [{ t: 0, p: null }, { t: 0.1, p: null, s }, { t: 0.9, p: null, s }, { t: 1, p: null }],
        });
      }
      const kit = S.kit, robotH = { k: 'robot', cell: this.id, r: r.name };
      const P0 = up(S.p, kitH * (1 - g)), P1 = [T.at[0], this.P.deck + kitH * (1 - g), T.at[1]];
      this.startOp(r, {
        label: op.label ?? `${S.name} 반출`, time: op.time, zones, ch: r.chOut ?? null,
        keys: this.outKeys(P0, P1), yaw0: 0, yaw1: T.yaw ?? 0,
        events: [
          { t: OUT.grip, fn: () => { this.parts.hold(kit, robotH, { k: 'station', cell: this.id, st: S.name }); S.kit = null; T.kit = kit; } },
          { t: OUT.drop, fn: () => {
            if (T.cancel) { this.parts.remove(kit); return; }
            this.parts.hold(kit, T.to, robotH); T.loaded = true;
          } },
          { t: OUT.release, fn: () => { T.released = true; } },
        ],
        end: () => { j.state = 'done'; this.out = null; },
      });
      return;
    }
    if (op.do === 'transfer') {
      const F = this.stations[S.flow.from];
      if (!F.kit) return;
      const zones = [`${F.name}s`, `${F.name}n`, `${S.name}s`, `${S.name}n`];
      if (!this.free(zones, r)) return;
      const kit = F.kit, robotH = { k: 'robot', cell: this.id, r: r.name };
      j.state = 'run';
      this.startOp(r, {
        label: `키트 ${F.name}→${S.name}`, time: op.time, zones,
        keys: this.pickKeys(up(F.p, kitH * (1 - g)), up(S.p, kitH * (1 - g))),
        events: [
          { t: PICK.grip, fn: () => { this.parts.hold(kit, robotH, { k: 'station', cell: this.id, st: F.name }); F.kit = null; F.phase = 'empty'; } },
          { t: PICK.drop, fn: () => { this.parts.hold(kit, { k: 'station', cell: this.id, st: S.name }, robotH); S.kit = kit; } },
        ],
        end: () => { j.state = 'done'; },
      });
      return;
    }
    if (op.do === 'path') {
      const zones = [`${S.name}s`, `${S.name}n`];
      if (!S.kit || !this.free(zones, r)) return;
      const pts = op.path.map(([dx, dz]) => [S.p[0] + dx, op.y, S.p[2] + dz]);
      const n = pts.length, keys = [{ t: 0, p: null }, { t: 0.14, p: up(pts[0], this.P.clear) }];
      pts.forEach((p, i) => keys.push({ t: 0.22 + (0.6 * i) / (n - 1), p }));
      keys.push({ t: 0.9, p: up(pts[n - 1], this.P.clear) }, { t: 1, p: null });
      j.state = 'run';
      this.startOp(r, { label: op.label ?? '경로 작업', time: op.time, zones, keys, events: [], end: () => { j.state = 'done'; } });
    }
  }

  // tuck: 가운데 준비 자세를 거친다(라인 배출 지점이 로봇 뒤라 반 바퀴 도는 투입 작업). 하역·이송은 가까워서 바로 간다.
  pickKeys(P0, P1, tuck = false) {
    const c = this.P.clear, pts = { A0: up(P0, c), P0, A1: up(P1, c), P1 };
    return PP.filter(([k, t]) => tuck || !(k === 'R' && t > 0 && t < 1)).map(([k, t]) => ({ t, p: k === 'R' ? null : pts[k], mid: k === 'R' && t > 0 && t < 1 }));
  }

  // 스테이션은 셀 x 축으로 늘어서 있다고 본다(PRESS·SCREW). 건너는 스테이션 = 마지막 스테이션과 도크 사이.
  outKeys(P0, P1) {
    const c = this.P.clear, kx = this.P.kit.size[0] / 2 + 0.1, u = Math.sign(P1[0] - P0[0]) || -1;
    const over = Object.values(this.stations).filter((S) => (S.p[0] - P0[0]) * u > 1e-6 && (P1[0] - S.p[0]) * u > 1e-6);
    const hy = Math.max(P0[1] + c, ...over.map((S) => S.p[1] + this.kitH + c + 0.06 + OUT.carry));
    const far = over.length ? over.reduce((a, S) => ((S.p[0] - a.p[0]) * u > 0 ? S : a)).p[0] + u * (kx + 0.05) : P0[0] + u * kx * 2;
    const pts = { A0: up(P0, c), P0, A1: up(P1, c), P1, E: [P0[0] + u * kx, hy, P0[2]], W: [far, hy, P0[2]] };
    return UP.map(([k, t]) => ({ t, p: k === 'R' ? null : pts[k] }));
  }

  // ── 구역 잠금: 작업 시작에 한 번에 잡고 끝에 푼다 ──
  free(zones, r) { return zones.every((z) => !this.locks[z] || this.locks[z] === r.name); }

  startOp(r, op) {
    for (const z of op.zones) {
      if (this.locks[z] && this.locks[z] !== r.name) this.lockFaults++;
      this.locks[z] = r.name;
    }
    op.el = 0; op.ei = 0; op.Q = null;
    r.op = op;
    r.label = op.label;
  }

  endOp(r) {
    const op = r.op;
    for (const z of op.zones) if (this.locks[z] === r.name) this.locks[z] = null;
    r.op = null;
    r.label = '대기';
    op.end?.();
  }

  runRobot(r, h) {
    const op = r.op;
    if (!op) { r.pose = r.ready; r.tcp = r.ch ? fk(r.ch, r.ready.q, r.ready.s).p : null; return; }
    op.el += h;
    const f = op.el >= op.time - 1e-9 ? 1 : op.el / op.time;
    this.poseAt(r, op, f);
    if (op.yaw0 != null && op.yaw1 != null) {
      const t0 = OUT.grip, t1 = OUT.drop;
      const u = f <= t0 ? 0 : f >= t1 ? 1 : smooth((f - t0) / (t1 - t0));
      op.kitYaw = op.yaw0 + wrap(op.yaw1 - op.yaw0) * u;
    }
    while (op.ei < op.events.length && op.events[op.ei].t <= f + 1e-12) op.events[op.ei++].fn();
    if (f >= 1) this.endOp(r);
  }

  // 키 프레임 사이: rig 있으면 관절 공간 보간(IK 해 사이), 없으면 작업 지점 직선 보간. 키 위에서는 둘 다 같은 TCP.
  poseAt(r, op, f) {
    const K = op.keys;
    let k = 0;
    while (k < K.length - 2 && K[k + 1].t <= f) k++;
    const A = K[k], B = K[k + 1];
    const u = B.t > A.t ? smooth(Math.min(1, Math.max(0, (f - A.t) / (B.t - A.t)))) : 1;
    if (r.ch) {
      if (!op.Q) { op.Q = this.solve(r, op); this.retime(r, op); }
      r.pose = lerpPose(op.Q[k], op.Q[k + 1], u);
      r.tcp = fk(r.ch, r.pose.q, r.pose.s).p;
      return;
    }
    r.pose = null;
    r.tcp = A.p && B.p ? lerp3(A.p, B.p, u) : A.p && u < 1e-9 ? A.p : B.p && u > 1 - 1e-9 ? B.p : null;
  }

  // 가운데 준비 자세의 시각: 들기~놓기 위 구간을 앞뒤 TCP 경로 길이(관절 보간 표본) 비율로 나눈다 — 두 구간 최고 속도를 맞춘다.
  // 사건 시각(물기·놓기)은 그대로라 공정 시각은 같다. rig 없으면 쓰지 않는다.
  retime(r, op) {
    const K = op.keys, i = K.findIndex((k) => k.mid);
    if (i < 1 || i >= K.length - 1) return;
    const len = (A, B) => {
      let d = 0, p = fk(r.ch, A.q, A.s).p;
      for (let j = 1; j <= 12; j++) { const P = lerpPose(A, B, j / 12), q = fk(r.ch, P.q, P.s).p; d += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); p = q; }
      return d;
    };
    const a = len(op.Q[i - 1], op.Q[i]), b = len(op.Q[i], op.Q[i + 1]);
    const u = a + b > 1e-9 ? Math.min(0.8, Math.max(0.2, a / (a + b))) : 0.5;
    K[i] = { ...K[i], t: K[i - 1].t + (K[i + 1].t - K[i - 1].t) * u };
  }

  // 키: p 없으면 준비 자세(s 를 주면 그 레일 위치에서). op.ch 가 있으면 그 사슬(넓힌 레일 범위)로 푼다.
  solve(r, op) {
    const ch = op.ch ?? r.ch;
    const id = `${r.name}${op.ch ? '+' : ''}|${op.keys.map((k) => (k.p ? k.p.map((v) => v.toFixed(4)).join(',') : `R${k.s ?? ''}`)).join(';')}`;
    const hit = this.cache.get(id);
    if (hit) return hit;
    let prev = r.ready;
    const Q = op.keys.map((k) => {
      if (!k.p) { prev = k.s == null ? r.ready : { q: r.ready.q, s: k.s }; return prev; }
      const sol = reach(ch, k.p, prev, r.ready);
      prev = { q: sol.q, s: sol.s, ok: sol.ok };
      return prev;
    });
    if (this.cache.size > 200) this.cache.clear();
    this.cache.set(id, Q);
    return Q;
  }

  // ── 위치(셀 로컬, 물건 밑면 중심). kit 소유자는 Plant 가 부모 키트 위치로 푼다. ──
  local(e) {
    const H = e.holder;
    switch (H.k) {
      case 'station': return this.stations[H.st].p.slice();
      case 'robot': { const t = this.robots[H.r].tcp; return t ? [t[0], t[1] - e.h * (1 - this.grip), t[2], this.robots[H.r].op?.kitYaw ?? 0] : null; }
      case 'gantry': { const L = this.lineOf[H.line]; return [L.x, L.gantry.y - e.h, L.gantry.z]; }
      case 'line': { const L = this.lineOf[H.line]; return [L.x, L.y, L.in + L.dir * H.s]; }
      case 'stock': { const L = this.lineOf[H.line]; return [L.x, L.feed.stockY, L.feed.stock]; }
      default: return null;
    }
  }

  // ── 점검: 잠금 없이 작업 구역(스테이션 반·도크) 작업 높이 안에 들어온 TCP ──
  zoneBoxes() {
    const out = [];
    const [kx, , kz] = this.P.kit.size, m = 0.05, top = this.kitH + this.P.clear + 0.06;
    for (const S of Object.values(this.stations)) {
      const [x, y, z] = S.p;
      out.push({ zone: `${S.name}s`, x0: x - kx / 2 - m, x1: x + kx / 2 + m, z0: z - kz / 2 - m, z1: z, y1: y + top });
      out.push({ zone: `${S.name}n`, x0: x - kx / 2 - m, x1: x + kx / 2 + m, z0: z, z1: z + kz / 2 + m, y1: y + top });
    }
    if (this.dock) out.push({ zone: 'dock', x0: this.dock.x - 0.6, x1: this.dock.x + 0.6, z0: this.dock.z - 0.45, z1: this.dock.z + 0.45, y1: this.P.deck + 0.5 });
    if (this.outDock) out.push({ zone: 'outdock', x0: this.outDock.x - 0.6, x1: this.outDock.x + 0.6, z0: this.outDock.z - 0.45, z1: this.outDock.z + 0.45, y1: this.P.deck + 0.5 });
    return out;
  }

  audit() {
    if (!this.rig) return;
    const boxes = this.zoneBoxes();
    for (const r of Object.values(this.robots)) {
      const t = r.tcp;
      if (!t) continue;
      for (const b of boxes) {
        if (t[0] < b.x0 || t[0] > b.x1 || t[2] < b.z0 || t[2] > b.z1 || t[1] > b.y1) continue;
        if (this.locks[b.zone] !== r.name) { this.intrude++; this.lastIntrude = `${r.name}@${b.zone}`; }
      }
    }
  }

  // ── 셀 요약(생산 단위) ──
  unit(down) {
    const S = this.stations, first = S[this.P.flow[0].station], last = S[this.P.flow.at(-1).station];
    const working = last.phase === 'work';
    const active = working || first.phase !== 'empty' || !!this.ticket || Object.values(this.robots).some((r) => r.op);
    return {
      state: down ? 'DOWN' : active ? 'BUSY' : 'IDLE',
      working,
      progress: working ? Math.min(1, last.el / this.P.takt) : 0,
      stock: first.kit && first.phase !== 'incoming' ? 1 : 0,
      done: this.done,
    };
  }

  // 그리기용: 로봇 자세·갠트리·롤러 이동량
  view() {
    return {
      robots: Object.values(this.robots).map((r) => ({ name: r.name, pose: r.pose, index: r.ch?.index ?? null, tcp: r.tcp, label: r.label, busy: !!r.op })),
      lines: this.lines.map((L) => ({ id: L.id, dir: L.dir, travel: L.travel, gantry: { z: L.gantry.z, y: L.gantry.y, busy: !!L.gantry.op }, rig: L.rig, count: L.items.length, left: L.left })),
      stations: Object.values(this.stations).map((S) => ({ name: S.name, phase: S.phase, step: S.stepI, kit: S.kit?.id ?? null })),
      locks: { ...this.locks },
    };
  }
}
