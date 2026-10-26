// AMR 한 대의 주행: 단계 실행 · 가감속 · 제자리 회전 · 후진 · 앞차 감지 · 양보. DOM·three 없음.
// 감지·양보 규칙은 micro-assembly js/sim.js Mover(yieldTo·sense)를 이 필드 규모로 줄인 것이다. 배차·경로·잠금은 acs.js.
// 대수·속도·배터리 수치는 가정이다.
import { BODY_R } from './route.js';

export const AMR = Object.freeze({
  radius: BODY_R, width: 0.8, length: 1.1,
  vEmpty: 1.5, vLoaded: 1.1, vCrawl: 0.08, vTurn: 0.4, vCreep: 0.3, vRev: 0.45,
  accel: 0.7, yaw: 1.6,
  turnStop: 0.3,          // 진행 방향과 차체가 이 각도(rad) 넘게 틀어지면 서서 돈다
  battery: Object.freeze({ move: 0.045, idle: 0.006, charge: 0.3, low: 30, ready: 85 }),
});

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 단계: {go:[점], rev?, creep?, gate?} {face:heading} {until:fn} {wait:s} {do:fn}. label 은 대기 중 표시.
export class Amr {
  constructor(id, idx, home) {
    this.id = id; this.idx = idx;
    this.x = home.x; this.z = home.z; this.heading = home.heading ?? 0;
    this.v = 0; this.dist = 0;
    this.home = idx;
    this.battery = 100 - ((idx * 9) % 30);
    this.load = null;
    this.ticket = null;       // 셀과 주고받는 중인 티켓(acs.js handover)
    this.mode = 'park';       // park | job | return
    this.task = '대기';
    this.at = { kind: 'home', i: idx };
    this.mission = null;
    this.inBranch = null;     // 잠금을 잡고 들어간 셀 id
    this.waitFor = null;      // 진입 대기점에 서 있는 셀 id
    this.bound = null;        // 향하는 셀 id (잠금 잡기 전까지)
    this.off = false;         // 운휴: 충전 자리가 모자라 배차·주행·감지에서 빠짐
    this.steps = []; this.path = null; this.reverse = false;
    this.blockedOn = null; this.blockT = 0; this.passT = 0; this.holdFor = null; this.holdT = 0;
    this.detours = 0; this.wantDir = null; this.moving = false; this.charging = false; this.docked = false;
    this.pathRev = 0;
  }

  get idle() { return this.steps.length === 0; }
  get prio() { return (this.load ? 20 : this.mode === 'park' ? 0 : 10) - this.idx * 0.1; }
  get vmax() { return this.load ? AMR.vLoaded : AMR.vEmpty; }

  setTask(name, steps) { this.task = name; this.steps = steps; this.path = null; this.detours = 0; this.pathRev++; }

  // 남은 경로(그리기용): 지금 go 단계 + 뒤따르는 go 단계 점들
  plan() {
    const pts = [];
    if (this.path) pts.push(...this.path);
    for (let i = this.path ? 1 : 0; i < this.steps.length; i++) if (this.steps[i].go) pts.push(...this.steps[i].go);
    return pts;
  }

  update(h, fleet) {
    this.moving = false; this.charging = false; this.docked = false;
    if (this.passT > 0) this.passT -= h;
    let guard = 0;
    while (this.steps.length && guard++ < 12) {
      const st = this.steps[0];
      if (st.go) {
        // 진입 게이트: 대기점 GATE m 앞에서 잠금이 잡히면 서지 않고 대기 단계를 건너뛴다
        if (st.gate && this.remaining(st) < GATE && st.gate()) { this.steps.splice(0, 2); this.path = null; continue; }
        this.drive(h, st, fleet);
        break;
      }
      if ('face' in st) { if (!this.face(h, st.face)) break; this.steps.shift(); continue; }
      if (st.until) { if (!st.until()) { if (st.label) this.task = st.label; this.v = 0; break; } this.steps.shift(); continue; }
      if ('wait' in st) { st.wait -= h; if (st.wait > 0) { if (st.label) this.task = st.label; break; } this.steps.shift(); continue; }
      if (st.do) { this.steps.shift(); st.do(); continue; } // do 가 setTask 로 단계를 갈아끼울 수 있으므로 먼저 뺀다
      this.steps.shift();
    }
    if (!this.steps.length) this.v = 0;
    fleet.zonesFree?.(this);
    this.drain(h);
  }

  // 지금 go 다음에 이어 달릴 점: 사이 단계가 pass(서지 않는 do)거나 peek(미리 잡아도 되는 칸 예약 — 잡히면 통과)뿐일 때.
  flowNext() {
    for (let k = 1; k < this.steps.length; k++) {
      const s = this.steps[k];
      if (s.go) return s.go[0] ?? null;
      if (s.pass) continue;
      if (s.peek && s.until()) continue;
      return null;
    }
    return null;
  }

  remaining(st) {
    const pts = this.path ?? st.go;
    let s = 0, p = this;
    for (const q of pts) { s += Math.hypot(q.x - p.x, q.z - p.z); p = q; }
    return s;
  }

  face(h, want) {
    const err = wrap(want - this.heading);
    this.v = 0;
    if (Math.abs(err) < 0.01) { this.heading = want; return true; }
    this.heading = wrap(this.heading + Math.sign(err) * Math.min(Math.abs(err), AMR.yaw * h));
    this.moving = true;
    return false;
  }

  drain(h) {
    const B = AMR.battery;
    const parked = this.mode === 'park' && !this.steps.length;
    if (parked) { this.charging = this.battery < 100; this.battery = Math.min(100, this.battery + B.charge * h); return; }
    this.battery = Math.max(0, this.battery - (this.moving ? B.move * (this.load ? 1.2 : 1) : B.idle) * h);
  }

  drive(h, st, fleet) {
    if (!this.path) this.path = st.go.map((p) => ({ ...p }));
    while (this.path.length && Math.hypot(this.path[0].x - this.x, this.path[0].z - this.z) < 1e-3) {
      const p = this.path.shift();
      if (p.detour && this.detours > 0) this.detours--;
      if (p.hold) { this.holdFor = p.hold; this.holdT = 0; }
    }
    if (!this.path.length) { const flow = this.flowNext(); this.path = null; this.steps.shift(); if (!flow) this.v = 0; return; }

    const p = this.path[0];
    const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz);
    const dir = { x: dx / d, z: dz / d };
    this.wantDir = dir;
    this.reverse = !!st.rev;

    const gap = this.yieldTo(dir, h, fleet);
    if (gap === null) { this.v = Math.max(0, this.v - AMR.accel * 2 * h); return; }
    if (this.path[0] !== p) return;

    // 차체 방향: 전진이면 진행 방향, 후진이면 그 반대. 많이 틀어졌으면 서서 돈다.
    const want = st.rev ? Math.atan2(-dir.x, -dir.z) : Math.atan2(dir.x, dir.z);
    const err = wrap(want - this.heading);
    this.heading = wrap(this.heading + Math.sign(err) * Math.min(Math.abs(err), AMR.yaw * h));
    if (Math.abs(err) > AMR.turnStop) {
      this.v = Math.max(0, this.v - AMR.accel * 2 * h);
      if (this.v < 0.05) { this.moving = true; return; }
    }

    // 꺾임점·종점 앞 감속 (사다리꼴 속도)
    const next = this.path[1] ?? this.flowNext();
    let vCorner = 0;
    if (next) {
      const nx = next.x - p.x, nz = next.z - p.z, nd = Math.hypot(nx, nz) || 1;
      const turn = Math.acos(Math.max(-1, Math.min(1, (dir.x * nx + dir.z * nz) / nd)));
      vCorner = turn < 0.15 ? this.vmax : turn < 0.8 ? AMR.vTurn * 1.6 : AMR.vTurn;
      if (this.steps[1]?.go && !this.path[1] && !!this.steps[1].rev !== !!st.rev) vCorner = 0;
    }
    const vStop = Math.sqrt(vCorner * vCorner + 2 * AMR.accel * d);
    const zg = fleet.zoneGap ? fleet.zoneGap(this, dir, d) : Infinity;
    const room = Math.min(gap, zg);
    const vFollow = Number.isFinite(room) ? Math.sqrt(2 * AMR.accel * Math.max(0, room)) : Infinity;
    const cap = st.rev ? AMR.vRev : st.creep ? AMR.vCreep : this.vmax * fleet.scale;
    const target = Math.min(cap, vStop, vFollow);
    this.v = this.v < target ? Math.min(target, this.v + AMR.accel * h) : Math.max(target, this.v - AMR.accel * 2 * h);
    const step = Math.min(d, Math.max(this.v, room > 0.05 ? AMR.vCrawl : 0) * h);
    if (step <= 0) return;
    if (fleet.zonesOk && !fleet.zonesOk(this, this.x + dir.x * step, this.z + dir.z * step)) { this.v = 0; return; }
    this.x += dir.x * step; this.z += dir.z * step; this.dist += step;
    this.moving = true;
  }

  // 반환: null = 멈춤, 수 = 앞차까지 여유 거리(m), Infinity = 막힘 없음.
  // micro-assembly Mover.yieldTo 규칙: 비켜선 자리 대기 → 우선 통행권 → 마주침(낮은 쪽이 비켜섬) → 교차 막힘(낮은 쪽이 물러남) → 선 장애물 우회 → 오래 막히면 낮은 쪽 비켜섬.
  // 셀 안(잠금 구간)과 같은 자리를 향한 줄서기는 우회·우선 통행 없이 기다린다 — 잠금이 마주침을 막는다.
  yieldTo(dir, h, fleet) {
    if (this.holdFor) {
      this.holdT += h;
      const o = this.holdFor;
      if (this.holdT < 2.5 && o.moving && Math.hypot(o.x - this.x, o.z - this.z) < 2.0 + AMR.radius) { this.blockedOn = null; return null; }
      this.holdFor = null; this.holdT = 0;
    }
    if (this.passT > 0 && !this.inBranch) { this.blockedOn = null; return Infinity; }
    if (!this.inBranch && (this.blockT > 15 || this.detours > 12)) {
      this.passT = 4; this.blockT = 0; this.detours = 0;
      if (this.path) { const keep = this.path.filter((p) => !p.detour); this.path = keep.length ? keep : this.path.slice(-1); }
      fleet.note?.(this, '교착 해소: 우선 통행 4초');
      return Infinity;
    }
    const hit = fleet.sense(this, dir);
    if (!hit) { this.blockedOn = null; this.blockT = 0; return Infinity; }
    const { o, along } = hit;
    // 내가 잡은 구역 밖에 선 차는 들어가려고 기다리는 중(yieldTo 가 zoneGap 보다 먼저라 zoneWait 가 비어 있을 수 있다).
    const mine = fleet.zones?.filter((Z) => Z.holder === this) ?? [];
    if (mine.length && mine.every((Z) => Math.hypot(o.x - Z.x, o.z - Z.z) >= Z.r - 0.05)) {
      this.blockedOn = null; this.blockT = 0; return Infinity;
    }
    const stopAt = 2 * AMR.radius + 0.35;
    const gap = along - stopAt;
    if (gap > 0.05) { this.blockedOn = null; this.blockT = 0; return gap; }

    const end = this.path[this.path.length - 1];
    const off = 2 * AMR.radius + 0.35;
    const atDest = Math.hypot(o.x - end.x, o.z - end.z) < off + 0.4;
    // 같은 셀로 가는 차끼리는 줄을 선다(앞차가 대기 중이거나 이미 그 셀 잠금 안). 셀 안에서는 그냥 기다린다.
    const b = this.bound;
    const od0 = o.wantDir ?? { x: Math.sin(o.heading), z: Math.cos(o.heading) };
    const behind = dir.x * od0.x + dir.z * od0.z > 0.7;
    // 같은 칸 잠금 안에서는 줄로 선다. 다른 칸 차(G2: SCREW·PRESS:OUT)와는 줄이 아니다 — 구역을 잡은 쪽이 지나고
    // 아닌 쪽은 구역 간격으로 선다. 잠금 구간에서는 우회하지 않는다(지선 밖으로 빠져 서로 막지 않게).
    const queued = (this.inBranch && o.inBranch === this.inBranch) || (o.zoneWait && !fleet.holding?.(this)) || (b && behind && (o.waitFor === b || o.inBranch === b || (o.bound === b && !o.moving)));
    if (queued) { this.blockedOn = o; this.blockT = 0; return null; }

    this.blockedOn = o; this.blockT += h;
    if (this.inBranch) return null;
    const cross = dir.x * (o.z - this.z) - dir.z * (o.x - this.x);
    const sgn = cross > 0 ? 1 : -1;
    const sd = { x: -dir.z * sgn, z: dir.x * sgn };
    const detour = (pts) => { this.path.unshift(...pts.map((p) => ({ ...p, detour: true }))); this.detours += pts.length; this.blockT = 0; this.pathRev++; return 0; };

    if (o.blockedOn === this) {
      const od = o.wantDir ?? { x: Math.sin(o.heading), z: Math.cos(o.heading) };
      if (dir.x * od.x + dir.z * od.z < -0.7) {
        if (this.prio < o.prio && this.blockT > 0.3) return detour([{ x: this.x + sd.x * off, z: this.z + sd.z * off, hold: o }]);
        return null;
      }
      if (this.prio < o.prio && this.blockT > 0.3) return detour([{ x: this.x - dir.x * off * 0.7, z: this.z - dir.z * off * 0.7 }]);
      return null;
    }
    const parked = o.idle || (!o.moving && !o.steps[0]?.go);
    if (parked && !atDest && this.blockT > 1.5) {
      const ahead = along + off;
      return detour([{ x: this.x + sd.x * off, z: this.z + sd.z * off }, { x: this.x + sd.x * off + dir.x * ahead, z: this.z + sd.z * off + dir.z * ahead }]);
    }
    if (!atDest && this.blockT > 12 && this.prio < o.prio) return detour([{ x: this.x + sd.x * off, z: this.z + sd.z * off, hold: o }]);
    return null;
  }
}

const GATE = 4;
// 개인 간격에서 옆으로 이만큼 넘게 떨어진 차는 맞은편 차로로 본다(중심 간격 ≥ 2·반경, 차폭 0.78 둘 사이 0.52 m). 우회 뒤 차로에서
// 조금 비켜 선 차를 막힘으로 보면, 구역을 잡은 차가 그 구역을 기다리는 맞은편 차에 막혀 둘 다 선다.
const SIDE = 1.3;

// 진행 방향 앞(차폭 안)에서 가장 가까운 AMR. {o, along} 또는 null.
// 차폭 밖이라도 앞쪽 반원 안 개인 간격(반경 합 + 0.1m, 마주 오는 차로 간격 1.4m 보다 작게)에 들어오면 막힌 것으로 본다 — 차로 합류·교차.
export function sense(amrs, m, dir) {
  let best = null;
  const look = 2 * AMR.radius + 0.35 + (m.v * m.v) / (2 * AMR.accel) + 0.8;
  const personal = 2 * AMR.radius + 0.1;
  for (const o of amrs) {
    if (o === m || o.off) continue;
    const rx = o.x - m.x, rz = o.z - m.z;
    let along = rx * dir.x + rz * dir.z;
    const lateral = Math.abs(rx * dir.z - rz * dir.x);
    // 옆으로 볼 폭: 내 차폭 절반 + 상대 차체가 옆으로 내민 만큼(나란하면 차폭 절반, 가로지르면 길이 절반) + 0.1
    const across = Math.abs(Math.sin(o.heading) * dir.z - Math.cos(o.heading) * dir.x);
    const ahead = along > 0.15 && along < look && lateral < AMR.width / 2 + 0.1 + (AMR.length / 2) * across + (AMR.width / 2) * (1 - across);
    // 내가 잡은 구역을 기다리며 서 있는 차는 나를 비켜 주는 중이다 — 진로(차폭) 밖이면 개인 간격으로 막지 않는다(서로 기다림 방지).
    const yielding = !o.moving && o.zoneWait?.holder === m;
    if (!ahead && !yielding && along > 0.1 && Math.hypot(rx, rz) < personal && lateral < SIDE) along = 0.16;
    else if (!ahead) continue;
    if (!best || along < best.along) best = { o, along };
  }
  return best;
}
