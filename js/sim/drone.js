// 드론(가정): 공정 검사 2대 + 재고 실사 1대. 참조 레포 micro-assembly js/drone.js(순찰 드론: 셀 상공 순회·사고 현장 우선 출동·배터리 귀환)를 본떴다.
//  · 공정 검사(DRONE-01·02): 리프트 셀이 pass 하나를 끝내거나 OUT 이 키트를 받으면 그 자리 상공으로 날아가 저고도 정지 비행 비전 검사(3 s).
//    셀이 DOWN 이 되면 가장 가까운 가용 드론이 먼저 날아가 복구될 때까지 현장 중계(최대 600 s). 검사 결과 판정은 결정론 해시 3 % 재검(가정).
//  · 재고 실사(DRONE-03): 완료품 책장 · SORT 랙 · 부품 창고 상공을 돌며 엔티티 수(실사)와 셀 카운터(장부)를 맞춰 본다. 어긋나면 warn.
// 비행 24분 · 충전 4분 · 25 % 아래 귀환(참조 레포 값). 순항 고도는 드론마다 달라(4.8 · 5.6 · 6.4 m) 서로 피하지 않고, 저고도(3.6 m)는 한 자리에 한 대만.
// 셀 GLB 높이 ≤ 2.4 m, 벽 8 m. 지상 이동체와 높이가 달라 AMR·견마와도 서로 피하지 않는다. 시뮬 배우일 뿐 실제 비행 제어·영상 처리가 아니다. DOM·three 없음.
// 2027 A-4-4 비전 센서 드론(견적 항목)과 이 시뮬 드론을 같은 것으로 보지 않는다.
import { placeOf, toWorld } from './layout.js';

export const DRONE = Object.freeze({
  pads: Object.freeze([{ x: 31.5, z: 11 }, { x: 33.7, z: 11 }, { x: 35.9, z: 11 }].map(Object.freeze)),   // 간격 2.2 m > 저고도 한 자리 반경
  padR: 0.7,
  roles: Object.freeze(['process', 'process', 'stock']),
  cruise: Object.freeze([4.8, 5.6, 6.4]),
  low: 3.6,                 // 검사·중계 고도
  speed: 2.4,               // m/s 수평(스텝 0.24 m ≤ 순간이동 게이트 0.25)
  climb: 1.2,               // m/s 수직
  yaw: 1.6,
  inspect: 3,               // s
  count: 5,                 // s, 재고 실사 한 곳
  relayMax: 600,
  drain: 100 / (24 * 60),   // %/s 비행
  charge: 100 / (4 * 60),   // %/s
  low_: 25, full: 98,
  queue: 8,                 // 검사 대기 상한. 넘으면 오래된 검사부터 건너뜀(표본 검사로 기록)
  ng: 0.03,
  sep: 2.0,                 // 저고도 한 자리 반경
  layer: 0.75,              // 이 고도 차 안이면 같은 층으로 본다(순항 고도 간격 0.8 m)
  clear: 1.3,               // 같은 층 수평 최소 간격(로터 폭 1.16 m)
});

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 결정론 [0,1) — 같은 셀·같은 회차면 같은 값
export function unit(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export class Drone {
  constructor(i) {
    this.idx = i;
    this.id = `DRONE-${String(i + 1).padStart(2, '0')}`;
    this.role = DRONE.roles[i] ?? 'process';
    this.pad = DRONE.pads[i];
    this.cruise = DRONE.cruise[i] ?? 5;
    this.reset();
  }

  reset() {
    this.recall();
    this.battery = 100 - this.idx * 20;    // 충전이 겹치지 않게 엇갈려 시작
    this.stats = { inspected: 0, ng: 0, relays: 0, counts: 0, mismatch: 0, flight: 0 };
  }

  // 끼임 해소: 이착륙장으로. 누적 검사 수는 유지.
  recall() {
    this.x = this.pad.x; this.z = this.pad.z; this.y = 0; this.heading = Math.PI; this.v = 0; this.vy = 0;
    this.mode = 'idle';
    this.job = null; this.workT = 0; this.wp = 0;
    this.task = '이륙 대기';
  }

  get flying() { return this.y > 0.3; }
  get available() { return this.mode !== 'return' && this.mode !== 'charge' && this.battery >= DRONE.low_ + 5 && this.job?.kind !== 'fault'; }

  // 목표 상공으로: 순항 고도까지 오른 뒤 수평 이동, 도착하면 alt 로 오르내림. 도착하면 true.
  toward(h, gx, gz, alt, others) {
    const dx = gx - this.x, dz = gz - this.z, d = Math.hypot(dx, dz);
    this.v = 0; this.vy = 0;
    if (d > 0.2) {
      if (this.y < this.cruise - 0.05) { this.vy = DRONE.climb; this.y = Math.min(this.cruise, this.y + DRONE.climb * h); return false; }
      if (this.y > this.cruise + 0.05) { this.vy = -DRONE.climb; this.y = Math.max(this.cruise, this.y - DRONE.climb * h); return false; }
      const dh = wrap(Math.atan2(dx, dz) - this.heading);
      this.heading = wrap(this.heading + Math.sign(dh) * Math.min(Math.abs(dh), DRONE.yaw * h));
      const v = Math.min(DRONE.speed, d * 1.2) * (Math.abs(dh) > 1.2 ? 0.3 : 1);
      const step = Math.min(d, v * h);
      const nx = this.x + (dx / d) * step, nz = this.z + (dz / d) * step;
      // 내 고도를 지나는(이착륙·오르내리는) 드론에 다가가면 제자리 정지 비행. 오르내림은 기다리지 않으므로 서로 막히지 않는다.
      const cross = others.find((o) => o !== this && o.flying && Math.abs(o.y - this.y) < DRONE.layer
        && Math.hypot(o.x - nx, o.z - nz) < DRONE.clear && Math.hypot(o.x - nx, o.z - nz) < Math.hypot(o.x - this.x, o.z - this.z));
      if (cross) { this.task = `${this.task.split(' (')[0]} (${cross.id} 통과 대기)`; return false; }
      this.x = nx; this.z = nz; this.v = v;
      return false;
    }
    if (alt < this.y - 0.05 && others.some((o) => o !== this && o.flying && Math.hypot(o.x - this.x, o.z - this.z) < DRONE.sep
      && (o.y < this.cruise - 0.3 || o.vy < 0))) {
      this.task = `${this.task.split(' (')[0]} (저고도 자리 대기)`;
      return false;
    }
    if (Math.abs(alt - this.y) > 0.05) {
      const s = Math.sign(alt - this.y);
      this.vy = s * DRONE.climb;
      this.y += s * Math.min(Math.abs(alt - this.y), DRONE.climb * h);
      return false;
    }
    return true;
  }

  view() {
    return {
      id: this.id, role: this.role, x: this.x, y: this.y, z: this.z, heading: this.heading, v: this.v, vy: this.vy,
      mode: this.mode, task: this.task, battery: this.battery, flying: this.flying,
      job: this.job ? { kind: this.job.kind, cell: this.job.cell, x: this.job.x, z: this.job.z } : null,
      scanning: this.mode === 'work' && this.flying ? (this.job?.kind ?? null) : null,
      stats: { ...this.stats },
    };
  }
}

export class DroneFleet {
  constructor({ count = 3 } = {}) {
    this.drones = Array.from({ length: Math.min(count, DRONE.pads.length) }, (_, i) => new Drone(i));
    this.queue = [];
    this.turn = 0;
    this.skipped = 0;
    this.seen = null;          // 셀별 마지막으로 본 done · OUT stored
    this.down = new Set();
    this.results = [];         // 최근 검사·실사(최대 40)
  }

  reset() {
    for (const d of this.drones) d.reset();
    this.queue = []; this.turn = 0; this.skipped = 0; this.seen = null; this.down.clear(); this.results = [];
  }

  // 셀 작업 카운터·DOWN 을 보고 검사·중계 작업을 만든다.
  watch(plant, host) {
    const now = {};
    for (const id of plant.lifts ?? []) now[id] = plant.work[id]?.done ?? 0;
    if (plant.work.OUT) now.OUT = plant.work.OUT.stored;
    if (!this.seen) { this.seen = now; return; }
    for (const [id, n] of Object.entries(now)) {
      for (let k = (this.seen[id] ?? 0) + 1; k <= n; k++) this.enqueue({ kind: 'inspect', cell: id, n: k, ...this.spot(plant, id) });
    }
    this.seen = now;
    for (const u of Object.values(plant.units ?? {})) {
      if (u.down && !this.down.has(u.id)) {
        this.down.add(u.id);
        this.dispatchFault(plant, u, host);
      } else if (!u.down) this.down.delete(u.id);
    }
  }

  // 리프트 정차 칸(셀 로컬 dock) 상공, 없으면 셀 중심
  spot(plant, id) {
    const pose = placeOf(plant.layout, id);
    if (!pose) return { x: 0, z: 0 };
    const dock = plant.work[id]?.dock;
    return dock ? toWorld(pose, dock) : { x: pose.x, z: pose.z };
  }

  enqueue(job) {
    this.queue.push(job);
    while (this.queue.length > DRONE.queue) { this.queue.shift(); this.skipped++; }
  }

  dispatchFault(plant, u, host) {
    const at = this.spot(plant, u.id);
    const free = this.drones.filter((d) => d.available).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z));
    const d = free[0];
    if (!d) { host?.log('warn', `${u.id} 고장 · 출동 가능한 드론 없음`); return; }
    if (d.job?.kind === 'inspect') this.queue.unshift(d.job);
    d.job = { kind: 'fault', cell: u.id, ...at, t0: plant.time };
    d.mode = 'fly'; d.workT = 0;
    const eta = Math.max(1, Math.round(Math.hypot(d.x - at.x, d.z - at.z) / DRONE.speed));
    host?.log('act', `${d.id} ${u.id} 고장 현장 우선 출동`, { obs: `${u.down?.why ?? '설비 정지'} · 도착 약 ${eta}초 · 복구까지 상공 중계(가정)` });
  }

  step(h, plant, host) {
    this.watch(plant, host);
    for (const d of this.drones) this.stepOne(d, h, plant, host);
  }

  stepOne(d, h, plant, host) {
    const all = this.drones;
    if (d.flying) { d.battery = Math.max(0, d.battery - DRONE.drain * h); d.stats.flight += h; }
    if (d.mode === 'charge') {
      d.battery = Math.min(100, d.battery + DRONE.charge * h);
      d.task = `무선 충전 ${d.battery.toFixed(0)}%`;
      if (d.battery >= DRONE.full) { d.mode = 'idle'; host?.log('info', `${d.id} 충전 완료`); }
      return;
    }
    if (d.mode !== 'return' && d.battery < DRONE.low_) {
      if (d.job?.kind === 'inspect') this.queue.unshift(d.job);
      if (d.job?.kind === 'fault') host?.log('warn', `${d.id} 배터리 부족 · ${d.job.cell} 중계 중단`, { obs: `${d.battery.toFixed(0)}%` });
      d.job = null; d.mode = 'return';
    }
    if (d.mode === 'return') {
      d.task = `귀환 · 배터리 ${d.battery.toFixed(0)}%`;
      if (d.toward(h, d.pad.x, d.pad.z, 0, all)) { d.mode = 'charge'; d.y = 0; host?.log('info', `${d.id} 착륙`, { obs: `배터리 ${d.battery.toFixed(0)}% · 무선 충전 시작` }); }
      return;
    }
    if (!d.job) this.assign(d, plant);
    if (!d.job) {
      if (!d.flying) d.battery = Math.min(100, d.battery + DRONE.charge * h);
      d.task = d.flying ? '패드 복귀' : `대기 (패드 · ${d.battery.toFixed(0)}%)`;
      if (d.flying && d.toward(h, d.pad.x, d.pad.z, 0, all)) { d.y = 0; d.mode = 'idle'; }
      return;
    }
    const J = d.job;
    if (d.mode !== 'work') {
      d.mode = 'fly';
      d.task = J.kind === 'fault' ? `고장 현장 출동 → ${J.cell}` : J.kind === 'inspect' ? `검사 이동 → ${J.cell}` : `실사 이동 → ${J.label}`;
      if (d.toward(h, J.x, J.z, DRONE.low, all)) { d.mode = 'work'; d.workT = 0; if (J.kind === 'fault') d.stats.relays++; }
      return;
    }
    d.workT += h;
    d.v = 0; d.vy = 0;
    if (J.kind === 'fault') {
      d.heading = wrap(d.heading + 0.35 * h);
      const u = plant.units[J.cell];
      d.task = `현장 중계 · ${J.cell} ${u?.down?.why ?? ''}`.trim();
      if (!u?.down || d.workT > DRONE.relayMax) {
        host?.log('ok', `${d.id} ${J.cell} 중계 종료`, { obs: u?.down ? '최대 중계 시간' : '설비 복구 확인' });
        d.job = null; d.mode = 'fly';
      }
      return;
    }
    if (J.kind === 'inspect') {
      d.task = `비전 검사 · ${J.cell} #${J.n}`;
      if (d.workT >= DRONE.inspect) this.finishInspect(d, J, plant, host);
      return;
    }
    d.heading = wrap(d.heading + 0.5 * h);
    d.task = `재고 실사 · ${J.label}`;
    if (d.workT >= DRONE.count) this.finishCount(d, J, plant, host);
  }

  // 공정 검사 드론: 큐 앞(다른 드론이 같은 셀을 보고 있지 않은 것). 재고 실사 드론: 다음 실사 지점. 비면 공정 검사도 거든다.
  assign(d, plant) {
    const busy = new Set(this.drones.filter((o) => o !== d && o.job).map((o) => o.job.cell));
    if (d.role === 'stock') {
      const pts = stockPoints(plant);
      if (!pts.length) return;
      const p = pts[d.wp % pts.length];
      d.wp++;
      if (!busy.has(p.cell)) d.job = { kind: 'count', ...p };
      return;
    }
    // 공정 검사는 번갈아 맡는다: 차례인 드론이 비어 있으면 그 드론에 넘긴다.
    const turn = this.drones.filter((o) => o.role === 'process')[this.turn % 2];
    if (turn && turn !== d && turn.available && !turn.job && d.role === 'process') return;
    const i = this.queue.findIndex((j) => !busy.has(j.cell));
    if (i >= 0) { d.job = this.queue.splice(i, 1)[0]; d.workT = 0; if (d.role === 'process') this.turn++; }
  }

  finishInspect(d, J, plant, host) {
    const ng = unit(`${J.cell}#${J.n}`) < DRONE.ng;
    d.stats.inspected++;
    if (ng) d.stats.ng++;
    const r = { t: plant.time, by: d.id, kind: 'inspect', cell: J.cell, n: J.n, result: ng ? '재검' : '합격' };
    this.push(r);
    if (ng) host?.log('warn', `${d.id} 비전 검사 · ${J.cell} #${J.n} 재검 필요(가정)`, { obs: '판정은 결정론 3 % 가정 — 재작업 흐름은 시뮬하지 않음' });
    host?.emit('robot:inspect', { id: d.id, cell: J.cell, n: J.n, result: r.result });
    d.job = null; d.mode = 'fly';
  }

  finishCount(d, J, plant, host) {
    const c = J.count(plant);
    d.stats.counts++;
    // 장부 > 실사 는 자리를 잡고 옮기는 중인 물건(이동 중). 실사 > 장부 는 기록 없는 물건 — 이것만 불일치.
    const result = c.ledger == null ? '기록' : c.counted === c.ledger ? '일치' : c.counted < c.ledger ? `이동 중 ${c.ledger - c.counted}` : '불일치';
    if (result === '불일치') d.stats.mismatch++;
    this.push({ t: plant.time, by: d.id, kind: 'count', cell: J.cell, counted: c.counted, ledger: c.ledger, result });
    if (result === '불일치') host?.log('warn', `${d.id} 재고 실사 불일치 · ${J.label}`, { obs: `실사 ${c.counted} · 장부 ${c.ledger}` });
    host?.emit('robot:count', { id: d.id, cell: J.cell, counted: c.counted, ledger: c.ledger });
    d.job = null; d.mode = 'fly';
  }

  push(r) {
    this.results.unshift(r);
    if (this.results.length > 40) this.results.length = 40;
  }

  view() {
    return { drones: this.drones.map((d) => d.view()), queue: this.queue.length, skipped: this.skipped, results: this.results.slice(0, 12) };
  }
}

// 재고 실사 지점. counted = 그 자리에 놓인 엔티티 수(실사), ledger = 셀 카운터·자리 예약(장부). 장부가 없으면 null.
// OUT: 장부 = 적재(stored) − 출하(shipped). 랙·원재료 창고: 장부 = 잡힌 칸(옮기는 중 포함). 부품 창고: 대기 중 부품 AMR 대수만 센다.
export function stockPoints(plant) {
  const out = [];
  const at = (id) => placeOf(plant.layout, id);
  const O = plant.work?.OUT;
  if (O && at('OUT')) {
    out.push({ cell: 'OUT', label: '완료품 책장', ...pick(at('OUT')),
      count: (p) => ({ counted: p.parts.on((h) => h.k === 'outslot').length, ledger: p.work.OUT.stored - p.work.OUT.shipped }) });
  }
  if (plant.rack && at(plant.rack.cell)) {
    out.push({ cell: plant.rack.cell, label: `${plant.rack.cell} 랙`, ...pick(at(plant.rack.cell)),
      count: (p) => ({ counted: p.parts.on((h) => h.k === 'rack').length, ledger: p.rack.items.filter(Boolean).length }) });
  }
  if (plant.store && at(plant.store.id)) {
    out.push({ cell: plant.store.id, label: '원재료 창고', ...pick(at(plant.store.id)),
      count: (p) => ({ counted: p.parts.on((h) => h.k === 'store').length, ledger: p.store.items.filter(Boolean).length }) });
  }
  if (at('PARTS')) {
    out.push({ cell: 'PARTS', label: '부품 창고', ...pick(at('PARTS')),
      count: (p) => ({ counted: p.supply ? p.supply.acs.amrs.filter((a) => a.at?.kind === 'home').length : 0, ledger: null }) });
  }
  return out;
}

const pick = (p) => ({ x: p.x, z: p.z });
