// SORT 부속 부품 분류(가정): 투입 자리 AMR 적재면의 토트 → 투입 이송기가 컨베이어에 올림 → 바코드 스캔(목적 라인 → 레인) →
// 컨베이어가 레인 앞까지 → 레인 분기 이송기가 레인 롤러로 → 롤러 끝 → 내림 이송기가 레인 자리에 선 AMR 적재면에 내림. DOM·three 없음.
// 이송기는 GLB Transfer_* · Lane_*_transfer_* (가로 한 축 + 승강, 흡착). 시각·속도는 정의(cells.SORT.feed)와 시뮬 시간만 따른다 — rig 유무와 같다.
// 컨베이어·레인 롤러는 한 줄 큐(앞 토트를 넘지 못한다). 레인 롤러 칸 수 ≥ 레인에 동시에 있을 수 있는 토트 수(라인 2개 × 한 번에 하나)라
// 분기에서 막혀 컨베이어가 서는 일이 없다 — 레인 AMR 이 늦어도 다른 레인 토트는 흐른다. 실제 분류 설비 제어는 셀 PLC 몫이다.

const smooth = (u) => u * u * (3 - 2 * u);
const baseName = (n) => String(n ?? '').replace(/\.\d+$/, '');
// 이송 키(작업 비율): 쉼 → 집는 자리 위 → 내려 잡음 → 듦 → 놓는 자리 위 → 내려 놓음 → 듦 → 쉼
const KEYS = [['R', 0], ['A0', 0.12], ['P0', 0.22], ['P0', 0.3], ['A0', 0.4], ['A1', 0.62], ['P1', 0.72], ['P1', 0.78], ['A1', 0.86], ['R', 1]];
export const XFER = Object.freeze({ grip: 0.3, lift: 0.4, drop: 0.78 });
const CLEAR = 0.12;   // 들고 갈 때 토트 윗면 여유(집는·놓는 자리 중 높은 쪽 위)

// 가로 한 축(axis 'x'|'z') + 승강 이송기. p = 가로 위치, y = 흡착 패드 밑면 높이(셀 로컬). fix = 다른 가로 축 좌표.
class Transfer {
  constructor(name, axis, fix, home, rest) {
    Object.assign(this, { name, axis, fix, home, rest, p: home, y: rest, op: null, node: null, done: 0 });
  }

  get busy() { return !!this.op; }

  pad() { return this.axis === 'x' ? [this.p, this.y, this.fix] : [this.fix, this.y, this.p]; }

  // 집는 자리 p0(토트 윗면 y0) → 놓는 자리 p1(윗면 y1). events: {t, fn, need?} — need 가 거짓이면 그 시각에서 멈춰 기다린다.
  start(p0, y0, p1, y1, time, events) {
    const c = Math.max(y0, y1) + CLEAR;
    const at = { R: [this.home, this.rest], A0: [p0, c], P0: [p0, y0], A1: [p1, c], P1: [p1, y1] };
    this.op = { el: 0, ei: 0, time, keys: KEYS.map(([k, t]) => ({ t, p: at[k][0], y: at[k][1] })), events };
    this.op.keys[0] = { t: 0, p: this.p, y: this.y };
  }

  step(h) {
    const op = this.op;
    if (!op) return;
    const ev = op.events[op.ei];
    const cap = ev?.need && !ev.need() ? ev.t * op.time : Infinity;
    op.el = Math.min(op.el + h, cap);
    const f = op.el >= op.time - 1e-9 ? 1 : op.el / op.time;
    const K = op.keys;
    let k = 0;
    while (k < K.length - 2 && K[k + 1].t <= f) k++;
    const A = K[k], B = K[k + 1];
    const u = B.t > A.t ? smooth(Math.min(1, Math.max(0, (f - A.t) / (B.t - A.t)))) : 1;
    this.p = A.p + (B.p - A.p) * u;
    this.y = A.y + (B.y - A.y) * u;
    while (op.ei < op.events.length && op.events[op.ei].t <= f + 1e-12) {
      const e = op.events[op.ei];
      if (e.need && !e.need()) break;
      op.ei++;
      e.fn();
    }
    if (f >= 1) { this.op = null; this.done++; }
  }

  view() {
    return { gantry: { z: this.p, y: this.y }, travel: 0, dir: 1, rig: this.node ? { gantry: { node: this.node, home: this.home0, padHome: this.rest0 } } : null };
  }
}

export class SortFeed {
  // F: 공정 정의 cells.SORT.feed. parts: 엔티티 등록부.
  constructor(id, F, parts) {
    this.id = id;
    this.F = F;
    this.parts = parts;
    const C = F.conveyor, I = F.infeed;
    this.inT = new Transfer(I.transfer, 'x', C.z, I.drop.x, C.y + 0.6);
    this.lanes = F.lanes.map((l) => ({
      id: l.id, x: l.x, to: l.to, items: [], ticket: null,
      div: new Transfer(l.divert, 'z', l.x, C.z, C.y + 0.6),
      hand: new Transfer(l.hand, 'z', l.x, F.lane.to, C.y + 0.6),
      rollers: l.rollers, travel: 0,
    }));
    this.belt = [];             // 컨베이어 위 토트(투입 쪽 → 레인 쪽)
    this.infeed = null;         // 투입 티켓
    this.onScan = null;         // (tote, lane) → 레인 AMR 요청(Supply)
    this.travel = 0;
    this.scanned = 0;
    this.handed = 0;
    this.rigNodes = { rollers: [] };
  }

  get transfers() { return [this.inT, ...this.lanes.flatMap((L) => [L.div, L.hand])]; }

  // 그리기용 노드·쉼 자리(rig). 시뮬 시각은 rig 와 무관하다.
  attachRig(rig) {
    const found = [], missing = [];
    for (const T of this.transfers) {
      const g = rig?.gantries.find((x) => baseName(x.name) === T.name);
      if (!g) { missing.push(T.name); continue; }
      T.node = g.node;
      T.home0 = T.axis === 'x' ? g.toolOrigin[0] : g.toolOrigin[2];
      T.rest0 = g.toolLow ?? g.toolOrigin[1];
      T.home = T.home0; T.rest = T.rest0;
      if (!T.op) { T.p = T.home; T.y = T.rest; }
      found.push(T.name);
    }
    const roll = (name, dir) => { const R = rig?.rollers.find((x) => baseName(x.name) === name); return R ? { node: R.node, dir } : null; };
    this.rigNodes.rollers = [...(this.F.conveyor.rollers ?? []).map((n) => roll(n, 1)), ...this.lanes.map((L) => roll(L.rollers, -1))].filter(Boolean);
    return { gantries: found, rollers: this.rigNodes.rollers.length, missing };
  }

  laneOf(dock) { return this.lanes.find((L) => L.to.includes(dock)) ?? null; }

  // ── 투입: AMR 이 투입 자리에 서면 Supply 가 부른다. totes 는 집는 순서(위 칸부터), pick(e) → 토트 밑면 셀 로컬 [x,y,z].
  // 마지막 토트를 들어 올리면 released → AMR 출발.
  feedIn(totes, pick) {
    this.infeed = { totes: [...totes], pick, released: !totes.length, cancel: false };
    return this.infeed;
  }

  // ── 레인 내림: 레인 자리에 선 AMR(to: 소유자, at: 셀 로컬 {x,z}, top: 적재면 높이) — 레인 롤러 끝 토트를 내려 준다.
  // 놓으면 released, T.tote = 받은 토트.
  handTo(lane, to, at, top) {
    const L = this.lanes.find((x) => x.id === lane);
    if (!L) return { released: true, tote: null };
    L.ticket = { to, at, top, tote: null, gripped: false, released: false, cancel: false };
    return L.ticket;
  }

  step(h) {
    const C = this.F.conveyor, LN = this.F.lane;
    this.travel += C.speed * h;
    this.stepInfeed();
    // 컨베이어: 앞(레인 쪽)부터. 스캔 중이면 서 있고, 제 레인 앞에서 선다.
    const belt = this.belt.sort((a, b) => b.x - a.x);
    let front = Infinity;
    for (const t of belt) {
      if (t.scan > 0) {
        t.scan -= h;
        if (t.scan <= 0) {
          t.lane = this.laneOf(t.e.dock);
          this.scanned++;
          this.onScan?.(t.e, t.lane);
        }
      } else if (t.lane) t.x = Math.max(t.x, Math.min(t.x + C.speed * h, t.lane.x, front - C.pitch));
      front = t.x;
      if (t.lane && Math.abs(t.x - t.lane.x) < 1e-6) this.divert(t);
    }
    for (const L of this.lanes) {
      L.travel += LN.speed * h;
      let lead = Infinity;
      for (const t of L.items.sort((a, b) => b.z - a.z)) { t.z = Math.max(t.z, Math.min(t.z + LN.speed * h, LN.to, lead - LN.pitch)); lead = t.z; }
      if (L.ticket?.cancel && !L.ticket.gripped) L.ticket = null;
      const end = L.items[0];
      if (L.ticket && !L.ticket.gripped && !L.hand.busy && end && Math.abs(end.z - LN.to) < 1e-6) this.handDown(L, end);
    }
    for (const T of this.transfers) T.step(h);
  }

  stepInfeed() {
    const I = this.infeed, T = this.inT, C = this.F.conveyor;
    if (!I || T.busy) return;
    if (I.cancel || !I.totes.length) { if (!I.totes.length) I.released = true; this.infeed = null; return; }
    const entryFree = () => !this.belt.some((t) => t.x < this.F.infeed.drop.x + C.pitch);
    if (!entryFree()) return;
    const e = I.totes[0], p = I.pick(e);
    if (!p || !this.parts.get(e.id)) { I.totes.shift(); return; }
    const last = I.totes.length === 1;
    const H = { k: 'xfer', cell: this.id, t: T.name };
    T.start(p[0], p[1] + e.h, this.F.infeed.drop.x, C.y + e.h, this.F.infeed.time, [
      { t: XFER.grip, fn: () => { I.totes.shift(); if (this.parts.get(e.id)) { this.parts.hold(e, H, e.holder); T.held = e; } } },
      { t: XFER.lift, fn: () => { if (last) I.released = true; } },
      { t: XFER.drop, need: entryFree, fn: () => {
        if (T.held !== e) return;
        T.held = null;
        this.parts.hold(e, { k: 'belt', cell: this.id, line: 'main' }, H);
        this.belt.push({ e, x: this.F.infeed.drop.x, scan: this.F.scan, lane: null });
      } },
    ]);
  }

  // 레인 분기: 제 레인 앞에 선 토트를 레인 롤러 시작으로. 이송기가 비고 롤러 시작이 비어야 한다.
  divert(t) {
    const L = t.lane, D = L.div, C = this.F.conveyor, LN = this.F.lane;
    const startFree = () => !L.items.some((x) => x.z < LN.from + LN.pitch);
    if (D.busy || t.moving || !startFree()) return;
    t.moving = true;
    const H = { k: 'xfer', cell: this.id, t: D.name };
    D.start(C.z, C.y + t.e.h, LN.from, C.y + t.e.h, LN.divert, [
      { t: XFER.grip, fn: () => { this.belt = this.belt.filter((x) => x !== t); this.parts.hold(t.e, H, t.e.holder); D.held = t.e; } },
      { t: XFER.drop, need: startFree, fn: () => {
        D.held = null;
        this.parts.hold(t.e, { k: 'belt', cell: this.id, line: L.id }, H);
        L.items.push({ e: t.e, z: LN.from });
      } },
    ]);
  }

  handDown(L, t) {
    const T = L.ticket, X = L.hand, C = this.F.conveyor, LN = this.F.lane;
    T.gripped = true;
    const H = { k: 'xfer', cell: this.id, t: X.name };
    X.start(LN.to, C.y + t.e.h, T.at.z, T.top + t.e.h, LN.hand, [
      { t: XFER.grip, fn: () => { L.items = L.items.filter((x) => x !== t); this.parts.hold(t.e, H, t.e.holder); X.held = t.e; } },
      { t: XFER.drop, fn: () => {
        X.held = null;
        if (T.cancel) { this.parts.hold(t.e, { k: 'belt', cell: this.id, line: L.id }, H); L.items.unshift({ e: t.e, z: LN.to }); }
        else { this.parts.hold(t.e, T.to, H); T.tote = t.e; this.handed++; }
        T.released = true;
        if (L.ticket === T) L.ticket = null;
      } },
    ]);
  }

  // 레이아웃 변경 등으로 다시 시작: 분류 중인 토트를 모두 치운다(Supply 가 라인 요청을 다시 낸다).
  clear() {
    for (const t of this.belt) this.parts.remove(t.e);
    this.belt = [];
    for (const L of this.lanes) { for (const t of L.items) this.parts.remove(t.e); L.items = []; L.ticket = null; }
    for (const T of this.transfers) { if (T.held) this.parts.remove(T.held); T.held = null; T.op = null; T.p = T.home; T.y = T.rest; }
    this.infeed = null;
  }

  // 토트 위치(셀 로컬 밑면 중심, 넷째 = yaw). 이송기에 들린 것은 패드 밑.
  local(e) {
    const H = e.holder, C = this.F.conveyor;
    if (H.k === 'xfer') {
      const T = this.transfers.find((x) => x.name === H.t);
      if (!T) return null;
      const p = T.pad();
      return [p[0], p[1] - e.h, p[2], 0];
    }
    if (H.k !== 'belt') return null;
    if (H.line === 'main') { const t = this.belt.find((x) => x.e === e); return t ? [t.x, C.y, C.z, 0] : null; }
    const L = this.lanes.find((x) => x.id === H.line), t = L?.items.find((x) => x.e === e);
    return t ? [L.x, C.y, t.z, 0] : null;
  }

  // 그리기: 이송기(갠트리 한 축 + 승강) · 컨베이어·레인 롤러 회전
  lines() {
    return [
      ...this.transfers.map((T) => T.view()),
      ...this.rigNodes.rollers.map((r) => ({ gantry: null, travel: this.travel, dir: r.dir, rig: { rollers: { node: r.node } } })),
    ];
  }

  view() {
    return {
      belt: this.belt.length, scanned: this.scanned, handed: this.handed,
      lanes: this.lanes.map((L) => ({ id: L.id, items: L.items.length, waiting: !!L.ticket })),
      infeed: this.infeed ? this.infeed.totes.length : 0,
    };
  }
}
