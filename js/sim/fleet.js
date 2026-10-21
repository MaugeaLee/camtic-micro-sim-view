// 공급 AMR 플릿: 통로 차로·도크 동선·앞차 감지·양보. DOM·three 없음.
// 동작 규칙은 micro-assembly js/sim.js Mover(yieldTo·sense)·line.js(AMR 전용 동선·대기열·선행 배차)를 이 필드 규모로 줄인 것이다.
// 대수·속도·배터리 수치는 가정이다. 견적 A08 서브부품 공급 AMR 2대(context/08-precision-y1-equip.md)를 기본으로 한다.
import { bounds } from './layout.js';

// field-def.js FIELD.lanes[0] 과 같아야 한다 (tests/fleet.mjs 가 대조한다).
export const AISLE = Object.freeze({ z: 12.2, half: 1.3 });
// 통로를 진행 방향별 차로로 나눈다(우측 통행). +x 로 가면 z+LANE, −x 로 가면 z−LANE.
export const LANE = 0.7;
// 대기·충전 줄: 통로 앞(+z) 바닥. 칸 간격 PITCH.
export const PARK = Object.freeze({ z: 14.3, pitch: 1.5, x0: 21 });
export const AMR = Object.freeze({
  radius: 0.62, width: 0.8,
  vEmpty: 1.5, vLoaded: 1.1, vCrawl: 0.08, vTurn: 0.4,
  accel: 0.7, yaw: 2.4,
  battery: Object.freeze({ move: 0.045, idle: 0.006, charge: 0.3, low: 30, ready: 85 }),
});

const DOCK_GAP = 0.9;   // 셀 앞 모서리 → 정차점
const BAY = 1.4;        // 정차점 → 진입·진출 꺾임점
const QUEUE = 1.8;      // 꺾임점 → 대기점

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const laneZ = (dir) => AISLE.z + (dir >= 0 ? LANE : -LANE);

// 셀 앞(+z 모서리) 도크. 들어올 때 x+LANE, 나갈 때 x−LANE (하향 진입 기준 우측 통행).
export function dockOf(id, pose) {
  const b = bounds(id, pose);
  if (!b) return null;
  const x = pose.x, z = b.z1 + DOCK_GAP;
  const edge = AISLE.z - AISLE.half - 0.5;
  const bay = z + BAY;
  return {
    id, x, z,
    inX: x + LANE, outX: x - LANE, bay,
    queue: Math.min(bay + QUEUE, edge),
    ok: bay <= edge && b.x0 > -24 && b.x1 < 24,
    holder: null, line: [],
  };
}

export function docksOf(layout) {
  const out = {};
  for (const [id, pose] of Object.entries(layout.cells)) out[id] = dockOf(id, pose);
  return out;
}

export const parkSlot = (i) => ({ x: PARK.x0 - i * PARK.pitch, z: PARK.z, heading: Math.PI });

// 동선 조각. 모두 {x,z} 점 배열.
export const leg = {
  // 정차점에서 진출 꺾임점까지
  undock: (d) => [{ x: d.outX, z: d.bay }],
  // 지금 자리에서 차로까지 (도크 앞이면 진출 줄로, 그 밖이면 바로 위·아래로)
  toLane: (p, dir, d = null) => [{ x: d ? d.outX : p.x, z: laneZ(dir) }],
  // 차로를 따라 목적 x 까지
  along: (x, dir) => [{ x, z: laneZ(dir) }],
  // 차로 → 도크 대기점 → (until) → 꺾임점 → 정차점
  toQueue: (d) => [{ x: d.inX, z: d.queue }],
  dockIn: (d) => [{ x: d.inX, z: d.bay }, { x: d.x, z: d.z }],
  toPark: (s) => [{ x: s.x, z: s.z }],
};

// 지금 자리 p 에서 목표 x 까지 차로 경로 (도크 d 앞이면 진출 줄 사용).
export function laneRoute(p, targetX, fromDock = null) {
  const startX = fromDock ? fromDock.outX : p.x;
  const dir = Math.sign(targetX - startX) || 1;
  return [...(fromDock ? leg.undock(fromDock) : []), ...leg.toLane(p, dir, fromDock), ...leg.along(targetX, dir)];
}

// 이동체 하나. 단계(step) 목록을 순서대로 실행한다: {go:[점]} {until:fn} {wait:s} {do:fn}
export class Amr {
  constructor(id, idx, slot) {
    this.id = id; this.idx = idx;
    this.x = slot.x; this.z = slot.z; this.heading = slot.heading;
    this.v = 0; this.dist = 0;
    this.slot = idx;
    this.battery = 100 - ((idx * 9) % 30);
    this.load = null;
    this.mode = 'park';       // park | job | return
    this.task = '대기';
    this.steps = []; this.path = null;
    this.blockedOn = null; this.blockT = 0; this.passT = 0; this.holdFor = null; this.holdT = 0;
    this.detours = 0; this.wantDir = null; this.moving = false; this.charging = false;
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
    this.moving = false; this.charging = false;
    if (this.passT > 0) this.passT -= h;
    let guard = 0;
    while (this.steps.length && guard++ < 8) {
      const st = this.steps[0];
      if (st.go) { this.drive(h, st, fleet); break; }
      if (st.until) { if (!st.until()) { if (st.label) this.task = st.label; break; } this.steps.shift(); continue; }
      if ('wait' in st) { st.wait -= h; if (st.wait > 0) { if (st.label) this.task = st.label; break; } this.steps.shift(); continue; }
      if (st.do) { this.steps.shift(); st.do(); continue; } // do 가 setTask 로 단계를 갈아끼울 수 있으므로 먼저 뺀다
      this.steps.shift();
    }
    if (!this.steps.length) this.v = 0;
    this.drain(h);
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
    if (!this.path.length) { this.path = null; this.steps.shift(); this.v = 0; return; }

    const p = this.path[0];
    const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz);
    const dir = { x: dx / d, z: dz / d };
    this.wantDir = dir;

    // 앞차·마주침 처리. true 면 이번 스텝은 선다.
    const gap = this.yieldTo(dir, h, fleet);
    if (gap === null) { this.v = Math.max(0, this.v - AMR.accel * 2 * h); return; }
    if (this.path[0] !== p) return;

    // 방향 전환: 차체가 목표 방향과 많이 틀어졌으면 제자리 회전에 가깝게 감속
    const want = Math.atan2(dir.x, dir.z);
    const err = wrap(want - this.heading);
    this.heading = wrap(this.heading + Math.sign(err) * Math.min(Math.abs(err), AMR.yaw * h));
    const align = Math.max(0, Math.cos(Math.min(Math.abs(err), Math.PI / 2)));

    // 꺾임점·종점 앞 감속 (사다리꼴 속도)
    const next = this.path[1] ?? (this.steps[1]?.go?.[0] ?? null);
    let vCorner = 0;
    if (next) {
      const nx = next.x - p.x, nz = next.z - p.z, nd = Math.hypot(nx, nz) || 1;
      const turn = Math.acos(Math.max(-1, Math.min(1, (dir.x * nx + dir.z * nz) / nd)));
      vCorner = turn < 0.15 ? this.vmax : turn < 0.8 ? AMR.vTurn * 1.6 : AMR.vTurn;
    }
    const vStop = Math.sqrt(vCorner * vCorner + 2 * AMR.accel * d);
    const vFollow = Number.isFinite(gap) ? Math.sqrt(2 * AMR.accel * Math.max(0, gap)) : Infinity;
    const target = Math.min(this.vmax * fleet.scale, vStop, vFollow) * (0.25 + 0.75 * align * align);
    this.v = this.v < target ? Math.min(target, this.v + AMR.accel * h) : Math.max(target, this.v - AMR.accel * 2 * h);
    const step = Math.min(d, Math.max(this.v, gap > 0.05 ? AMR.vCrawl : 0) * h);
    if (step <= 0) return;
    this.x += dir.x * step; this.z += dir.z * step; this.dist += step;
    this.moving = true;
  }

  // 반환: null = 멈춤, 수 = 앞차까지 여유 거리(m), Infinity = 막힘 없음.
  // micro-assembly Mover.yieldTo 규칙: 비켜선 자리 대기 → 우선 통행권 → 마주침(낮은 쪽이 비켜섬) → 교차 막힘(낮은 쪽이 물러남) → 선 장애물 우회 → 오래 막히면 낮은 쪽 비켜섬.
  yieldTo(dir, h, fleet) {
    if (this.holdFor) {
      this.holdT += h;
      const o = this.holdFor;
      if (this.holdT < 2.5 && o.moving && Math.hypot(o.x - this.x, o.z - this.z) < 2.0 + AMR.radius) { this.blockedOn = null; return null; }
      this.holdFor = null; this.holdT = 0;
    }
    if (this.passT > 0) { this.blockedOn = null; return Infinity; }
    if (this.blockT > 15 || this.detours > 12) {
      this.passT = 4; this.blockT = 0; this.detours = 0;
      if (this.path) { const keep = this.path.filter((p) => !p.detour); this.path = keep.length ? keep : this.path.slice(-1); }
      fleet.note?.(this, '교착 해소: 우선 통행 4초');
      return Infinity;
    }
    const hit = fleet.sense(this, dir);
    if (!hit) { this.blockedOn = null; this.blockT = 0; return Infinity; }
    const { o, along } = hit;
    const stopAt = 2 * AMR.radius + 0.35;
    const gap = along - stopAt;
    if (gap > 0.05) { this.blockedOn = null; this.blockT = 0; return gap; }
    // 같은 도크 대기열 뒤: 줄 서서 기다린다 (교착 아님 — 우선 통행·우회 없음)
    if (this.inLine && o.inLine === this.inLine) { this.blockedOn = o; this.blockT = 0; return null; }

    this.blockedOn = o; this.blockT += h;
    const off = 2 * AMR.radius + 0.35;
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
    const end = this.path[this.path.length - 1];
    const atDest = Math.hypot(o.x - end.x, o.z - end.z) < off + 0.4;
    const parked = o.idle || (!o.moving && (!o.steps[0]?.go || o.inLine));
    if (parked && !atDest && this.blockT > 1.5) {
      const ahead = along + off;
      return detour([{ x: this.x + sd.x * off, z: this.z + sd.z * off }, { x: this.x + sd.x * off + dir.x * ahead, z: this.z + sd.z * off + dir.z * ahead }]);
    }
    if (!atDest && this.blockT > 12 && this.prio < o.prio) return detour([{ x: this.x + sd.x * off, z: this.z + sd.z * off, hold: o }]);
    return null;
  }
}

export class Fleet {
  constructor(count, layout) {
    this.scale = 1;
    this.amrs = Array.from({ length: count }, (_, i) => new Amr(`AMR-${String(i + 1).padStart(2, '0')}`, i, parkSlot(i)));
    this.setLayout(layout);
  }

  setLayout(layout) {
    this.docks = docksOf(layout);
  }

  // 진행 방향 앞(차폭 안)에서 가장 가까운 AMR. {o, along} 또는 null.
  // 차폭 밖이라도 앞쪽 반원 안 개인 간격(반경 합 + 0.1m, 마주 오는 차로 간격 1.4m 보다 작게)에 들어오면 막힌 것으로 본다 — 차로 합류·교차.
  sense(m, dir) {
    let best = null;
    const look = 2 * AMR.radius + 0.35 + (m.v * m.v) / (2 * AMR.accel) + 0.8;
    const personal = 2 * AMR.radius + 0.1;
    for (const o of this.amrs) {
      if (o === m) continue;
      const rx = o.x - m.x, rz = o.z - m.z;
      let along = rx * dir.x + rz * dir.z;
      const lateral = Math.abs(rx * dir.z - rz * dir.x);
      const ahead = along > 0.15 && along < look && lateral < AMR.width + 0.1;
      if (!ahead && along > 0.1 && Math.hypot(rx, rz) < personal) along = 0.16;
      else if (!ahead) continue;
      if (!best || along < best.along) best = { o, along };
    }
    return best;
  }

  freeSlot() {
    const used = new Set(this.amrs.map((a) => a.slot).filter((s) => s != null));
    let i = 0; while (used.has(i)) i++;
    return i;
  }

  step(h) {
    for (const a of this.amrs) a.update(h, this);
  }
}
