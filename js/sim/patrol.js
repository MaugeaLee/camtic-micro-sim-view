// 설비 점검 견마(가정): 셀마다 남쪽 모서리에 서서 열화상·진동·소음을 스캔하고(4 s), 결과를 이벤트로 낸다.
// 참조 레포 micro-assembly 의 사족보행 순찰 점검(planPatrol·patrolScan)을 이 레포 셀 3개 규모로 줄였다. 배터리가 30 % 아래면 충전 자리로 간다.
// 전용 차로: 셀 발자국(+여유) 남쪽 바로 바깥 직선(점검 차로). 리커버리 견마(HOUND-01) 통로 격자와 1.4 m 넘게 떨어져 있고, 충전 자리는 그 동쪽 끝.
// 리커버리 견마가 2.4 m 안으로 오면 차로를 따라 물러난다(리커버리 견마는 비키지 않는다 — 서로 기다리는 교착 없음).
// 설비 건강도는 BUSY 시간에 비례해 떨어지는 가정 모델이다(실측 아님). 예지정비 권고 뒤 정비는 시간을 쓰지 않고 바로 회복한 것으로 둔다 — 정비 인력·정지 시간은 시뮬하지 않는다.
// 이 모듈은 시뮬 안의 순찰 배우다. 실제 셀 PLC·OCS 제어가 아니다. DOM·three 없음.
import { HOUND, Hound, clearSeg, inField, keepouts } from './hound.js';
import { bounds, placeOf } from './layout.js';

export const INSPECT = Object.freeze({
  id: 'HOUND-02',
  scan: 4,                          // s, 한 셀 스캔
  stationX: 27.2,                   // 충전 자리 x (점검 차로 동쪽 끝). 리커버리 견마 동쪽 통로(≈25.3)와 부품 AMR 세로 루트(x 29) 사이
  low: 30, full: 98,                // %
  drain: 100 / (90 * 60),           // %/s 보행 중(90분 운용 가정)
  idle: 100 / (240 * 60),           // %/s 서 있을 때
  charge: 100 / (20 * 60),          // %/s(20분 충전 가정)
  pm: 72,                           // 건강도 이 아래면 예지정비 권고
  cal: 0.15,                        // 드리프트 이 위면 재보정 권고
  side: 0.02,                       // 발자국 여유(pad) 밖으로 이만큼
  keep: 2.4,                        // 리커버리 견마와 이 거리 안이면 가까워지는 걸음은 안 한다
});

// 셀 설비 건강도(가정). BUSY 1초마다 wear % 감소, drift 증가. 셀마다 계수만 다르다(결정론, 난수 없음).
export const WEAR = Object.freeze({ SORT: 0.0032, PRESS: 0.0045, SCREW: 0.0038 });
export const DRIFT = 0.000022;

export class CellHealth {
  constructor(ids) {
    this.cells = Object.fromEntries(ids.map((id) => [id, { id, health: 100, drift: 0, busy: 0, lastScan: null, scans: 0 }]));
  }

  step(h, units) {
    for (const u of Object.values(units)) {
      const c = this.cells[u.id];
      if (!c || u.state !== 'BUSY') continue;
      c.busy += h;
      c.health = Math.max(0, c.health - (WEAR[u.id] ?? 0.004) * h);
      c.drift += DRIFT * h;
    }
  }

  // 스캔 결과 판정. 권고가 나면 정비·재보정을 마친 것으로 바로 되돌린다(정비 시간 시뮬 없음).
  judge(id, t) {
    const c = this.cells[id];
    if (!c) return null;
    c.lastScan = t; c.scans++;
    const r = { id, t, health: Math.round(c.health * 10) / 10, drift: Math.round(c.drift * 1000) / 10, result: '정상' };
    if (c.health < INSPECT.pm) { r.result = '예지정비'; c.health = 100; }
    else if (c.drift > INSPECT.cal) { r.result = '재보정'; c.drift = 0; }
    return r;
  }

  view() { return Object.values(this.cells).map(({ id, health, drift, scans }) => ({ id, health: Math.round(health * 10) / 10, drift: Math.round(drift * 1000) / 10, scans })); }
}

// 점검 차로 z: 점검 셀 발자국 + 여유의 가장 남쪽 바로 바깥
export function laneOf(layout, ids) {
  const zs = ids.map((id) => { const p = placeOf(layout, id); return p ? bounds(id, p)?.z0 : null; }).filter(Number.isFinite);
  return zs.length ? Math.min(...zs) - HOUND.pad - INSPECT.side : null;
}

// 스캔 자리: 셀 가운데 x · 점검 차로 위
export function scanPoint(layout, id, ids = [id]) {
  const pose = placeOf(layout, id);
  const b = pose ? bounds(id, pose) : null;
  const z = laneOf(layout, ids);
  return b && z != null ? { x: (b.x0 + b.x1) / 2, z } : null;
}

export class InspectHound extends Hound {
  constructor({ layout, cells, health }) {
    super({ layout, id: INSPECT.id, rank: 1 });
    this.cellIds = cells;
    this.health = health;
    this.battery = 100;
    this.round = 0;
    this.target = null;
    this.scanT = 0;
    this.scans = 0;
    this.log = [];              // 최근 스캔 결과(최대 30)
    this.counts = { 정상: 0, 예지정비: 0, 재보정: 0 };
    this.bind(layout);
    this.reset();
  }

  get parked() { return this.mode === 'scan' || this.mode === 'charge'; }
  taskBase() { return this.mode === 'return' ? '충전 복귀' : '점검 순찰'; }

  bind(layout) {
    super.bind(layout);
    this.layout = layout;
    const z = laneOf(layout, this.cellIds) ?? -8.2;
    this.home = { x: INSPECT.stationX, z };
    const xs = this.cellIds.map((id) => scanPoint(layout, id, this.cellIds)?.x).filter(Number.isFinite);
    this.lane = { z, x0: Math.min(...xs, INSPECT.stationX), x1: INSPECT.stationX };
    this.laneClear = xs.length > 0 && inField(this.lane.x0, z) && inField(this.lane.x1, z)
      && clearSeg({ x: this.lane.x0, z }, { x: this.lane.x1, z }, keepouts(layout));
  }

  reset() {
    super.reset();
    this.x = this.home.x; this.z = this.home.z; this.heading = -Math.PI / 2;
    this.battery = 100; this.round = 0; this.target = null; this.scanT = 0; this.yieldT = 0;
    this.mode = 'patrol'; this.task = '점검 순찰';
  }

  // 차로 위 → 차로 위는 직선. 차로가 막혔거나(배치 변경) 차로 밖이면 통로 격자로.
  plan(goal) {
    const onLane = (p) => this.laneClear && Math.abs(p.z - this.lane.z) < 0.05;
    if (onLane(goal) && onLane(this)) { this.way = [{ x: goal.x, z: goal.z }]; this.wi = 0; }
    else super.plan(goal);
  }

  // 리커버리 견마가 가까우면(2.4 m) 다가가는 걸음은 안 한다.
  peerAhead(nx, nz) {
    return this.peers.find((p) => p !== this && Math.hypot(p.x - nx, p.z - nz) < INSPECT.keep
      && Math.hypot(p.x - nx, p.z - nz) < Math.hypot(p.x - this.x, p.z - this.z)) ?? null;
  }

  // 차로를 따라 상대 반대쪽으로 물러난다. 차로 밖이면 상대에게서 곧장 멀어진다.
  backOff(peer, h) {
    const step = Math.min(0.2, HOUND.speed * h);
    const onLane = this.laneClear && Math.abs(this.z - this.lane.z) < 0.05;
    let ux, uz;
    if (onLane) { ux = this.x >= peer.x ? 1 : -1; uz = 0; }
    else { const dx = this.x - peer.x, dz = this.z - peer.z, d = Math.hypot(dx, dz) || 1; ux = dx / d; uz = dz / d; }
    const nx = this.x + ux * step, nz = this.z + uz * step;
    if (onLane && (nx < this.lane.x0 - 1.5 || nx > this.lane.x1)) return false;
    if (!inField(nx, nz) || this.world.boxes.some((b) => nx > b.x0 && nx < b.x1 && nz > b.z0 && nz < b.z1)) return false;
    this.x = nx; this.z = nz;
    return true;
  }

  // Hound.step 은 AMR 이상 감지·리커버리를 하므로 쓰지 않는다. 점검 견마는 이상에 출동하지 않는다.
  step(h, amrs, host, layout) {
    if (layout && layout !== this.layout) this.bind(layout);
    this.gait += h;
    if (this.mode === 'charge') {
      this.v = 0;
      this.battery = Math.min(100, this.battery + INSPECT.charge * h);
      this.task = `충전 중 ${this.battery.toFixed(0)}%`;
      if (this.battery >= INSPECT.full) { this.mode = 'patrol'; host?.log('info', `${this.id} 점검 순찰 재개`, { obs: '배터리 충전 완료' }); }
      return;
    }
    this.battery = Math.max(0, this.battery - (this.v > 0.05 ? INSPECT.drain : INSPECT.idle) * h);
    if (this.mode !== 'return' && this.mode !== 'scan' && this.battery < INSPECT.low) {
      this.mode = 'return'; this.target = null; this.scanT = 0;
      this.plan(this.home);
      host?.log('info', `${this.id} 충전 자리 복귀`, { obs: `배터리 ${this.battery.toFixed(0)}%` });
    }
    if (this.mode === 'return') {
      if (this.wi >= this.way.length) this.plan(this.home);
      this.task = `충전 복귀 · ${this.battery.toFixed(0)}%`;
      this.follow(h, amrs);
      if (Math.hypot(this.x - this.home.x, this.z - this.home.z) < 0.3) { this.mode = 'charge'; this.v = 0; this.heading = -Math.PI / 2; }
      return;
    }
    if (this.mode === 'scan') {
      this.v = 0;
      this.scanT += h;
      this.task = `스캔 · ${this.target.id} (열화상·진동·소음)`;
      if (this.scanT >= INSPECT.scan) this.finishScan(host);
      return;
    }
    if (!this.target) this.pick();
    if (!this.target) { this.task = '점검 대상 없음'; return; }
    if (this.wi >= this.way.length) this.plan(this.target.at);
    this.task = `점검 이동 → ${this.target.id}`;
    this.follow(h, amrs);
    if (Math.hypot(this.x - this.target.at.x, this.z - this.target.at.z) < 0.3) {
      this.mode = 'scan'; this.scanT = 0; this.v = 0; this.way = []; this.wi = 0;
      this.heading = 0;   // 셀(북쪽)을 본다
    }
  }

  pick() {
    const ids = this.cellIds.filter((id) => this.health.cells[id]);
    if (!ids.length) return;
    const id = ids[this.round % ids.length];
    this.round++;
    const at = scanPoint(this.layout, id, this.cellIds);
    this.target = at ? { id, at } : null;
    this.way = []; this.wi = 0;
  }

  finishScan(host) {
    const r = this.health.judge(this.target.id, host?.time ?? 0);
    this.scans++;
    this.counts[r.result] = (this.counts[r.result] ?? 0) + 1;
    this.log.unshift({ ...r, by: this.id });
    if (this.log.length > 30) this.log.length = 30;
    if (r.result !== '정상') {
      host?.log('warn', `${this.id} 점검 · ${r.id} ${r.result} 권고`, { obs: `건강도 ${r.health}% · 드리프트 ${r.drift}% (가정 모델) — 정비 시간은 시뮬하지 않음` });
    }
    host?.emit('robot:scan', { id: this.id, cell: r.id, result: r.result, health: r.health, drift: r.drift });
    this.mode = 'patrol'; this.target = null; this.scanT = 0;
  }

  follow(h, amrs) { super.follow(h, amrs, null); }

  view() {
    return {
      ...super.view(), role: 'inspect', battery: this.battery, scanning: this.mode === 'scan' ? this.target?.id ?? null : null,
      scans: this.scans, counts: { ...this.counts }, job: null, home: { x: this.home.x, z: this.home.z },
    };
  }
}
