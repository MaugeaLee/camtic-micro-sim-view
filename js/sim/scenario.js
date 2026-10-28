// 시나리오: 시뮬 시간축으로 셀 상태(IDLE/BUSY/DOWN)를 구동하고, 운반은 ACS(acs.js)에 미션으로 넘긴다. DOM·three 없음.
// 흐름 가정: 부품 AMR이 원재료 창고(STORE)의 도어트림 키트를 SORT 랙 뒤(SORT:RAW)에 하역하면 협동로봇이 랙에 올리고, 분류된 키트를 북쪽 양팔 도크에서 AMR에 실어 SCREW·PRESS 로 나른다.
// 사이클·재고·고장 시각은 모두 가정값이다. 실측·확정 공정이 아니다. 기본 시나리오에는 고장이 없다.
// 공정 정의(process.default.json)를 주면 키트(지그 + 도어트림)·부품이 엔티티(소유자 하나)가 된다.
// 공정 순서 route(SORT → SCREW → PRESS → SCREW → OUT): 양팔이 지그째 메인 AMR MAIN 패널에 올림 → 셀 리프트 자리에 서면 클립이 지그를
// 들어 올리고 AMR 은 직진해 빠짐 → 그 방문(pass) 작업 → 빈 메인 AMR 이 리프트 밑에 서면 내려 안착 → 다음 칸. 마지막은 완료품 적재 구역(OUT,
// outwork.js) — 협동로봇이 도어트림만 집어 책장에 꽂고, 빈 지그를 실은 AMR 은 충전 자리로 돌아가 지그를 내려놓는다(회수 물류는 가정, 그리지 않음).
// 리프트 셀(PRESS·SCREW)은 cellwork.js 가 돌리고, 셀 상태·진행률·재고는 거기서 읽는다. SORT 적재는 sortwork.js.
// 흐름 없는 셀은 지그 자리(slots)로 옮김만 한다. 공정 정의가 없으면 예전처럼 사이클 타이머만 돈다.
// 교착 방지: 키트는 다음 칸 리프트가 비고 예약이 없을 때만 예약하고 간다(없으면 실은 채 충전 자리 대기, 뒤 공정 키트 먼저).
// 흐름 안 키트 수(WIP)는 플릿 − 1 이하 — 리프트에 키트가 있으면 빈 AMR 이 적어도 한 대 있다.
import { Acs, shareCross } from './acs.js';
import { Hound } from './hound.js';
import { CellHealth, InspectHound } from './patrol.js';
import { DRONE, DroneFleet } from './drone.js';
import { AMR_HOMES_MAX, RAW_IN, STORE } from './amrdata.js';
import { CellWork } from './cellwork.js';
import { placeOf, toLocal, toWorld } from './layout.js';
import { OutWork } from './outwork.js';
import { Parts } from './parts.js';
import { SortFeed } from './sortfeed.js';
import { SortWork } from './sortwork.js';
import { Store } from './store.js';
import { normalizeProcess, outDef, passOf, supplyDef, workDef } from './process.js';
import { Supply } from './supply.js';
import { Incidents, titleOf } from './incidents.js';

const smooth = (u) => u * u * (3 - 2 * u);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// 옮김(move) 소유자: 몸체 없는 이송(랙→AMR, AMR→지그). 위로 이만큼 호를 그린다.
const ARC = 0.25;

// 충전 자리 상한과 같다. AMR은 그 자리에 미리 서 있다.
export const AMR_MAX = AMR_HOMES_MAX;

const base = {
  assumed: true,
  amr: 6,
  parts: 6,     // 부속 부품 AMR(도어트림 AMR 과 따로 — 창고→SORT 투입, SORT 레인→라인 두 구간)
  stage: 3,
  source: 'SORT',
  sinks: ['SCREW', 'PRESS'],
  cycle: { SORT: 14, SCREW: 52, PRESS: 28 },   // 리프트 셀은 키트 하나에 쓰는 로봇 작업 합(SCREW 1차 21 + 2차 31)
  stock: { init: 0, cap: 2 },   // init: PRESS·SCREW 시작 키트 — 0이면 운송 AMR 이 먼저 가져와야 돈다
  buffer: 3,
  faults: [],
  period: 0,
  inspect: true,  // 설비 점검 견마(HOUND-02, patrol.js)
  drones: 3,      // 공정 검사 2 + 재고 실사 1 (drone.js)
};

export const SCENARIOS = Object.freeze({
  supply: Object.freeze({ ...base, label: '공급 흐름' }),
  // 점검용. 기본값이 아니다 — 선택하거나 ?scenario=faults 일 때만.
  faults: Object.freeze({
    ...base,
    label: '공급 흐름 + 고장(점검용)',
    period: 540,
    faults: Object.freeze([
      { at: 110, id: 'PRESS', dur: 55, why: '압입 설비 이상(가정)' },
      { at: 250, id: 'SORT', dur: 40, why: '분류 비전 오류(가정)' },
      { at: 390, id: 'SCREW', dur: 50, why: '체결 토크 이상(가정)' },
    ]),
  }),
});
export const DEFAULT_SCENARIO = 'supply';

export function validateScenario(def) {
  const errors = [];
  if (!def || typeof def !== 'object') return ['시나리오가 객체 아님'];
  if (!(def.amr >= 0 && def.amr <= AMR_MAX)) errors.push(`amr은 0~${AMR_MAX}`);
  if (def.parts != null && !(def.parts >= 0 && def.parts <= AMR_MAX)) errors.push(`parts는 0~${AMR_MAX}`);
  if (def.drones != null && !(Number.isInteger(def.drones) && def.drones >= 0 && def.drones <= DRONE.pads.length)) errors.push(`drones는 0~${DRONE.pads.length}`);
  for (const id of [def.source, ...(def.sinks ?? [])]) if (!(def.cycle?.[id] > 0)) errors.push(`${id} cycle은 양수`);
  if (def.period && def.faults.some((f) => f.at + f.dur > def.period)) errors.push('고장 구간이 period 밖');
  return errors;
}

export class Plant {
  constructor(def, { layout, cells, amr, process = null, drones = null, inspect = null } = {}) {
    if (amr != null) def = { ...def, amr };
    if (drones != null) def = { ...def, drones };
    if (inspect != null) def = { ...def, inspect };
    const errors = validateScenario(def);
    if (errors.length) throw new Error(errors.join(' · '));
    this.def = def;
    const ids = new Set(cells.map((c) => c.id));
    this.units = {};
    for (const id of [def.source, ...def.sinks]) {
      if (!ids.has(id)) throw new Error(`시나리오 셀 없음: ${id}`);
      this.units[id] = { id, role: id === def.source ? 'source' : 'sink', state: 'IDLE', progress: 0, working: false, stock: id === def.source ? 0 : def.stock.init, done: 0, down: null };
    }
    this.kits = [];
    this.kitSeq = 0;
    this.time = 0;
    this.layout = layout;
    this.acs = new Acs(Math.min(def.amr, layout.amr.homes.length), layout);
    this.acs.note = (a, text) => this.host?.log('info', `${a.id} ${text}`);
    this.host = null;
    this.delivered = 0;
    this.outbound = 0;          // 완료품 적재 구역에 내린 수
    this.outSeq = 0;
    this.parts = new Parts();
    this.timed = [];            // 시간 티켓(옮김): { end, released, done() }
    this.work = {};
    this.slots = {};
    this.rack = null;
    this.supply = null;         // 부속 부품 AMR 플릿(공정 정의에 supply 가 있을 때)
    this.inM = null;            // 도어트림 입고 미션(한 건)
    this.store = null;          // 도어트림 원재료 창고(공정 정의 SORT inbound.store 와 레이아웃 STORE 자리가 있을 때)
    this.route = null;          // 공정 순서(공정 정의 route) — 있으면 키트 엔티티 step 이 그 칸 번호
    this.lifts = [];            // 리프트 셀 id
    this.inFlow = new Set();    // 분류 뒤 ~ 적재 구역 전 키트 엔티티
    this.acs.onHome = (a) => this.dropJig(a);
    this.hound = new Hound({ layout });   // 견마: 통로 관제 보행 · 이상 감지·전파·접촉 리커버리(가정)
    this.health = new CellHealth([def.source, ...def.sinks]);
    this.inspector = def.inspect === false ? null : new InspectHound({ layout, cells: [def.source, ...def.sinks], health: this.health });
    const dogs = [this.hound, this.inspector].filter(Boolean);
    for (const d of dogs) d.peers = dogs;
    this.drones = new DroneFleet({ count: def.drones ?? 0 });
    this.incidents = new Incidents();   // 운영자 주입(고장·공급 차질·현장 이벤트·플릿 설정)
    this.bindFleet(this.acs, 'trim');
    this.proc = process ? normalizeProcess(process, { cycle: def.cycle }) : null;
    if (this.proc) this.setupProcess();
  }

  setupProcess() {
    const P = this.proc, S = this.def.source;
    const J = P.jig ?? null;
    this.kitSpec = {
      size: P.kit.size, h: P.kit.size[1] + (J?.size[1] ?? 0), color: P.kit.color, model: P.kit.model ?? null, lay: P.kit.lay ?? null,
      fit: P.kit.fit ?? null, jig: J ? { size: J.size, color: J.color } : null,
    };
    const src = P.cells[S];
    if (src?.rack) this.rack = { cell: S, pts: src.rack, items: src.rack.map(() => null), time: src.pickup };
    const U = supplyDef(P);
    const feed = U && this.def.parts > 0 && this.layout.parts && src?.feed ? new SortFeed(S, src.feed, this.parts) : null;
    if (this.rack && src.load) this.work[S] = new SortWork(S, { ...src.load, kit: P.kit, jig: J, deck: P.deck }, this.parts, this.rack, feed);
    this.route = P.route ?? null;
    for (const id of this.def.sinks) {
      const W = workDef(P, id), C = P.cells[id], u = this.units[id];
      if (W) {
        const cw = new CellWork(id, W, this.parts);
        this.work[id] = cw;
        this.lifts.push(id);
        if (u.stock > 0) {
          const e = cw.seed({ ...this.kitSpec });
          if (e && this.route) { e.step = this.route.indexOf(id); this.inFlow.add(e); }
        }
        Object.assign(u, cw.unit(false));
      } else if (C?.slots) {
        const sl = { cell: id, pts: C.slots, items: C.slots.map(() => null), time: C.handoff, active: null };
        this.slots[id] = sl;
        for (let i = 0; i < Math.min(u.stock, sl.items.length); i++) sl.items[i] = this.parts.add('kit', { k: 'slot', cell: id, i }, this.kitSpec);
      }
    }
    const O = outDef(P);
    if (O) {
      this.work.OUT = new OutWork('OUT', O, this.parts);
      this.work.OUT.onShip = (n) => this.host?.log('info', `완료품 ${n}개 묶음 출하`, { obs: `적재 구역 누적 ${this.work.OUT.shipped}개 · 출하 규칙은 가정` });
    }
    if (feed && this.work[S]?.feed === feed) {
      this.supply = new Supply(this, U, this.layout, this.def.parts, feed);
      this.bindFleet(this.supply.acs, 'parts');
      this.linkCross();
    }
    // 원재료 창고는 부품 창고 옆(남쪽 통로)이라 부품 AMR 이 나른다. 부품 플릿이 없으면 창고도 없다(아래 inCarrier).
    const cA = this.supply?.acs;
    if (this.rack && src.inbound?.store && cA?.cells[STORE] && cA.cells[RAW_IN] && placeOf(this.layout, STORE)) this.store = new Store(STORE, src.inbound.store, this, this.kitSpec);
    if (this.route) {
      const miss = this.route.slice(1, -1).filter((id) => !this.lifts.includes(id));
      if (miss.length || this.route[0] !== S || !this.work.OUT) throw new Error(`공정 순서 ${this.route.join('→')}: 시나리오 셀·OUT 과 안 맞음 ${miss.join(',')}`);
    }
    this.placeDocks();
  }

  // 주입 기록을 ACS 에 잇는다: 멈출 차(고장·통로 통제·플릿 정지)와 속도 배율.
  bindFleet(acs, key) {
    acs.fleetKey = key;
    acs.hold = (a) => this.incidents.amrStop(a.id, this.time);
  }

  // 공급 차질(incidents.js SUPPLY 키). Store·Supply 가 읽는다.
  supplyHold(target) { return this.incidents.supply(target, this.time); }

  // 두 플릿 루트가 만나는 교차로: 같은 구역 객체를 두 ACS 가 같이 잡는다.
  linkCross() {
    if (this.supply) shareCross(this.acs, this.supply.acs);
  }

  // 두 플릿 AMR 모두
  get allAmrs() { return this.supply ? [...this.acs.amrs, ...this.supply.acs.amrs] : this.acs.amrs; }

  // 셀 도크(마지막 정차 칸)를 셀 로컬로 — 리프트 셀은 리프트 밑 칸.
  placeDocks() {
    for (const [id, cw] of Object.entries(this.work)) {
      const pose = placeOf(this.layout, id);
      const C = this.acs.cells[id];
      cw.dock = C && pose ? toLocal(pose, C.stops.at(-1)) : null;
    }
  }

  // 빈 지그를 실은 AMR 이 충전 자리에 닿음 → 지그를 내려놓는다(지그 회수는 가정, 그리지 않음)
  dropJig(a) {
    if (a.keep) { this.parts.remove(a.keep); a.keep = null; }
  }

  setLayout(layout) {
    this.layout = layout;
    this.acs.setLayout(layout);
    for (const a of this.acs.amrs) a.keep = null;
    for (const e of this.parts.list()) if (e.type === 'jig' && e.holder.k === 'amr') this.parts.remove(e);
    this.supply?.setLayout(layout);
    this.hound.bind(layout);
    this.hound.reset();
    this.inspector?.bind(layout);
    this.inspector?.reset();
    this.drones.reset();
    this.linkCross();
    this.placeDocks();
    this.inM = null;
  }

  attachRig(id, rig) { return this.work[id]?.attachRig(rig) ?? null; }

  step(h, host) {
    this.host = host;
    this.time = host.time;
    this.noteIncidents(host);
    this.faults(host.time, host);
    this.acs.scale = this.incidents.fleetScale('trim', this.time);
    if (this.supply) this.supply.acs.scale = this.incidents.fleetScale('parts', this.time);
    this.runSource(h);
    for (const id of this.def.sinks) {
      const cw = this.work[id], u = this.units[id];
      if (cw) { cw.step(h, !!u.down); Object.assign(u, cw.unit(!!u.down)); }
      else this.runSink(u, h);
    }
    this.work.OUT?.step(h);
    this.store?.step();
    this.runTimed();
    this.dispatch();
    this.acs.step(h);
    this.supply?.step(h);
    this.hound.step(h, this.allAmrs, host, this.layout);
    this.health.step(h, this.units);
    this.inspector?.step(h, this.allAmrs, host, this.layout);
    this.drones.step(h, this, host);
    for (const u of Object.values(this.units)) host.setCellState(u.id, u.state);
  }

  // 순찰·점검 로봇(견마·드론) — 목록·추적·hub
  get robots() {
    return [this.hound.view(), ...(this.inspector ? [this.inspector.view()] : []), ...this.drones.drones.map((d) => d.view())];
  }

  runTimed() {
    if (!this.timed.length) return;
    const keep = [];
    for (const t of this.timed) {
      if (t.cancel) continue;
      if (this.time >= t.end - 1e-9) { t.released = true; t.done?.(); }
      else keep.push(t);
    }
    this.timed = keep;
  }

  // ── 엔티티 위치(필드 좌표, 밑면 중심 + yaw) ──
  cellPose(id) { return placeOf(this.layout, id); }

  worldOf(id, p) {
    const pose = this.cellPose(id), w = toWorld(pose, { x: p[0], z: p[2] });
    return { x: w.x, y: p[1], z: w.z, yaw: (pose.rotY * Math.PI) / 180 + (p[3] ?? 0), tilt: p[4] ?? 0 };
  }

  // 키트 위 부품. 키트 yaw(Y) 다음 tilt(Z) — parts.js YZX 와 같음.
  onKit(P, kit, at) {
    const [dx, dz, dy = 0] = at, y0 = kit.h + dy, yaw = P.yaw, tilt = P.tilt ?? 0;
    const c = Math.cos(yaw), s = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    const x1 = dx * c + dz * s, z1 = -dx * s + dz * c;
    return { x: P.x + x1 * ct - y0 * st, y: P.y + x1 * st + y0 * ct, z: P.z + z1, yaw, tilt };
  }

  poseOf(e, depth = 0) {
    const H = e.holder;
    switch (H.k) {
      case 'amr': {
        const a = this.allAmrs.find((x) => x.id === H.id);
        if (!a) return null;
        const yaw = a.heading - Math.PI / 2, y = a.deck ?? this.proc.deck;
        if (!H.at) return { x: a.x, y, z: a.z, yaw };
        const c = Math.cos(yaw), s = Math.sin(yaw), [dx, dz, dy = 0] = H.at;
        return { x: a.x + dx * c + dz * s, y: y + dy, z: a.z - dx * s + dz * c, yaw };
      }
      case 'rack': return this.worldOf(H.cell, [...this.ptArr(this.rack.pts[H.i]), this.work[H.cell]?.rackYaw?.() ?? 0]);
      case 'slot': return this.worldOf(H.cell, this.ptArr(this.slots[H.cell].pts[H.i]));
      case 'store': return this.worldOf(H.cell, this.store.pt(H.i));
      case 'move': {
        const u = smooth(Math.min(1, Math.max(0, (this.time - H.t0) / H.dur)));
        const A = H.from, B = this.target(H.to) ?? H.from;
        return {
          x: A.x + (B.x - A.x) * u, z: A.z + (B.z - A.z) * u,
          y: A.y + (B.y - A.y) * u + ARC * Math.sin(Math.PI * u),
          yaw: A.yaw + wrap(B.yaw - A.yaw) * u,
          tilt: (A.tilt ?? 0) + ((B.tilt ?? 0) - (A.tilt ?? 0)) * u,
        };
      }
      case 'kit': {
        const k = this.parts.get(H.kit);
        const P = k && depth < 4 ? this.poseOf(k, depth + 1) : null;
        if (!P) return null;
        return this.onKit(P, k, H.at);
      }
      case 'tote': {
        const t = this.parts.get(H.tote);
        const P = t && depth < 4 ? this.poseOf(t, depth + 1) : null;
        if (!P) return null;
        const c = Math.cos(P.yaw), s = Math.sin(P.yaw), [dx, dz, dy = 0] = H.at ?? [0, 0, 0];
        return { x: P.x + dx * c + dz * s, y: P.y + 0.04 + dy, z: P.z - dx * s + dz * c, yaw: P.yaw };
      }
      case 'drop': return this.worldOf(H.cell, H.at);
      default: {
        const cw = this.work[H.cell];
        const p = cw?.local(e);
        return p ? this.worldOf(H.cell, p) : null;
      }
    }
  }

  ptArr(p) { return [p.x, p.y, p.z]; }

  // 옮김 목적지: 움직이는 AMR 이면 지금 자리, 고정 자리면 그 자리.
  target(to) { return to.k ? this.poseOf({ holder: to }) : to; }

  move(e, to, dur) {
    const from = this.poseOf(e);
    this.parts.hold(e, { k: 'move', from, to, t0: this.time, dur }, e.holder);
  }

  // 그리기용: 엔티티 위치 목록
  partPoses() {
    const out = [];
    for (const e of this.parts.items.values()) {
      const p = this.poseOf(e);
      if (p) out.push({ id: e.id, type: e.type, size: e.size, color: e.color, model: e.model ?? null, lay: e.lay ?? null, fit: e.fit ?? null, jig: e.jig ?? null, holder: e.holder.k, ...p });
    }
    return out;
  }

  // ── 고장 타임라인 (period 마다 되풀이). 기본 시나리오는 faults 가 비어 있다. ──
  // 운영자 주입(incidents.js)도 같은 자리(u.down)로 셀을 세운다. 시나리오 고장이 먼저.
  faults(t, host) {
    const { period, faults } = this.def;
    const tl = period ? t % period : t;
    for (const u of Object.values(this.units)) {
      const f = faults.find((x) => x.id === u.id && tl >= x.at && tl < x.at + x.dur) ?? null;
      const want = f ?? this.incidents.cellStop(u.id, t);
      if (want === u.down) continue;
      if (u.down && !faults.includes(u.down) && !this.incidents.list.includes(u.down)) continue;   // 다른 쪽(점검)이 세운 정지는 그대로
      const was = u.down;
      u.down = want;
      if (f) host.log('error', `${f.id} 고장`, { obs: `${f.why} · ${f.dur}s 정지 예정` });
      else if (!want && was && faults.includes(was)) host.log('info', `${u.id} 복구`);
    }
  }

  // 주입 시작·끝 로그(플릿 설정은 ViewerState 가 남긴다)
  noteIncidents(host) {
    for (const { x, on } of this.incidents.changes(this.time)) {
      if (x.kind === 'fleet') continue;
      if (on) host.log(x.kind === 'fault' ? 'error' : 'warn', titleOf(x), { obs: `${x.why}${x.end != null ? ` · ${Math.round(x.end - x.at)} s` : ''}` });
      else host.log('info', `${titleOf(x)} 해제`, { obs: x.kind === 'fault' ? '복구' : '정상 운영' });
    }
  }

  runSource(h) {
    const u = this.units[this.def.source];
    const sw = this.work[u.id];
    sw?.step(h, !!u.down);
    if (u.down) { u.state = 'DOWN'; return; }
    const cap = this.rack ? Math.min(this.def.buffer, this.rack.items.length) : this.def.buffer;
    // 공정 정의가 있으면 키트는 랙에 생기지 않는다 — 도어트림 AMR 이 랙 뒤(SORT:RAW)에 하역해야 협동로봇이 랙에 올린다.
    if (this.proc && this.rack && sw) {
      const C = this.inCarrier;
      if (this.inM && !C?.queue.includes(this.inM) && !C?.amrs.some((a) => a.mission === this.inM)) this.inM = null;
      if (C && this.rack.items.includes(null) && !this.inM && C.ok(u.id) && C.ok(RAW_IN) && (!this.store || C.ok(STORE))) this.inM = C.request(this.inMission());
      const raw = this.inM || C?.amrs.some((a) => a.mission?.raw);
      const busy = !!sw.op || raw;
      if (this.kits.length >= cap && !busy) { u.state = 'IDLE'; u.progress = 0; return; }
      u.state = busy ? 'BUSY' : 'IDLE';
      u.progress = sw.op ? sw.op.el / sw.op.time : 0;
      return;
    }
    if (this.kits.length >= cap || (this.rack && !this.rack.items.includes(null))) { u.state = 'IDLE'; return; }
    u.state = 'BUSY';
    u.progress += h / this.def.cycle[u.id];
    if (u.progress >= 1) {
      u.progress = 0; u.done++;
      this.kits.push({ id: ++this.kitSeq, dest: this.nextDest(), e: this.rackKit() });
    }
  }

  // 랙에 올라온 입고 키트를 분류 버퍼에 넣는다(중복 없음).
  acceptIn(e) {
    if (!e || !this.parts.get(e.id) || this.kits.some((k) => k.e === e)) return;
    if (this.rack && !this.rack.items.includes(e)) return;
    e.no = ++this.kitSeq;
    this.kits.push({ id: e.no, dest: this.route ? this.route[1] : this.nextDest(), e });
    this.units[this.def.source].done++;
  }

  // 입고 운반 ACS: 원재료 창고가 있으면 부품 플릿, 없으면(예전 공정 정의·예전 레이아웃) SORT:RAW 가 있는 도어트림 플릿. 둘 다 없으면 null.
  get inCarrier() {
    if (this.store) return this.supply.acs;
    return this.acs.cells[RAW_IN] ? this.acs : null;
  }

  // 도어트림 입고: 원재료 창고(STORE) 도크에서 선반 키트를 싣고 SORT 랙 뒤(SORT:RAW)에 하역(부품 AMR). 적재는 북쪽 양팔 도크.
  // 창고가 없으면 도어트림 AMR 이 충전 자리에서 싣는다(그때는 키트가 AMR 위에 생긴다).
  inMission() {
    const S = this.def.source, sw = this.work[S], W = this.store;
    const loadT = this.proc?.cells?.[S]?.inbound?.load ?? 5;
    const m = {
      raw: true,
      from: W ? STORE : null,
      what: W
        ? { pick: '원재료 창고로', wait: '창고 선반 키트 대기', hand: '원재료 적재', tag: STORE, dock: S, carry: () => `${S} 뒤쪽 도크로 하역` }
        : { pick: '도어트림 입고', wait: '원재료 적재 대기', hand: '원재료 적재', tag: '입고', dock: S, carry: () => `${S} 뒤쪽 도크로 하역` },
      ready: () => !this.units[S].down && (!W || W.ready > 0),
      pickup: (a) => {
        if (W) {
          const got = W.take(a, loadT);
          if (!got) return false;
          m.e = got.e; m.T = got.T;
          return got.T;
        }
        m.e = this.parts.add('kit', { k: 'amr', id: a.id }, this.kitSpec);
        return this.timer(loadT);
      },
      load: (a) => ({ id: `R${m.e.id}`, e: m.e, dest: RAW_IN, amr: a.id, raw: true }),
      dest: () => (this.inCarrier?.ok(RAW_IN) ? RAW_IN : null),
      canDrop: () => !this.units[S].down && this.rack.items.includes(null) && !sw.busy(),
      unload: (a) => {
        const e = a.load?.e;
        if (!e) return this.timer(1);
        m.U = sw.unload(e, { k: 'amr', id: a.id }, toLocal(this.cellPose(S), a), (kit) => this.acceptIn(kit), a.heading);
        return m.U;
      },
      drop: (load) => {
        if (this.inM === m) this.inM = null;
        if (load.e) this.acceptIn(load.e);
      },
      abort: (a) => {
        if (this.inM === m) this.inM = null;
        if (m.T && !m.T.released) m.T.cancel = true;
        if (m.U?.started) return;
        if (m.U) m.U.cancel = true;
        const e = a?.load?.e ?? m.e;
        if (e && this.parts.get(e.id) && e.holder.k !== 'rack' && e.holder.k !== 'pair' && e.holder.k !== 'store') {
          const i = this.rack.items.indexOf(e);
          if (i >= 0) this.rack.items[i] = null;
          if (W && i < 0) W.giveBack(e);
          else this.parts.remove(e);
        }
      },
    };
    return m;
  }

  rackKit() {
    if (!this.rack) return null;
    const i = this.rack.items.indexOf(null);
    if (i < 0) return null;
    const e = this.parts.add('kit', { k: 'rack', cell: this.rack.cell, i }, this.kitSpec);
    this.rack.items[i] = e;
    return e;
  }

  freeRack(e) {
    const i = this.rack?.items.indexOf(e) ?? -1;
    if (i >= 0) this.rack.items[i] = null;
  }

  // 수요가 가장 큰(재고+운반중+대기 키트가 가장 적은) 셀로 보낸다. ACS가 못 가는 셀은 뺀다.
  nextDest() {
    const want = (id) => this.units[id].stock + this.kits.filter((k) => k.dest === id).length
      + this.acs.amrs.filter((a) => a.load?.dest === id).length + (this.units[id].working ? 0 : -0.5);
    const ok = this.def.sinks.filter((id) => this.acs.ok(id));
    return [...(ok.length ? ok : this.def.sinks)].sort((a, b) => want(a) - want(b))[0];
  }

  runSink(u, h) {
    if (u.down) { u.state = 'DOWN'; return; }
    const sl = this.slots[u.id];
    if (!u.working && u.stock > 0) {
      u.stock--; u.working = true; u.progress = 0;
      if (sl) sl.active = sl.items.find((e) => e && e.holder.k === 'slot') ?? null;
    }
    if (!u.working) { u.state = 'IDLE'; return; }
    u.state = 'BUSY';
    u.progress += h / this.def.cycle[u.id];
    if (u.progress >= 1) {
      u.progress = 0; u.working = false; u.done++;
      if (sl?.active) { sl.items[sl.items.indexOf(sl.active)] = null; this.parts.remove(sl.active); sl.active = null; }
    }
  }

  // 배차 요청: 키트 수(+10초 안에 나올 키트)만큼, 선행 배차 상한 stage 안에서 ACS에 픽업 미션을 넣는다.
  // 공정 순서(route)가 있으면: 리프트 셀 작업이 곧 끝나면(cellwork outSoon) 셀마다 반출(hop) 미션 하나, 분류 적재는 흐름 안 키트(WIP)가
  // 플릿 − 1 이하일 때만 — 리프트에 키트가 있으면 빈 AMR 이 늘 남는다(실은 차가 모두 리프트 비기를 기다리는 교착이 없다).
  // 리프트 하나에 2개(작업 중 1 + 오가는 1)를 넘으면 실은 채 충전 자리에서 기다리는 차만 는다 — 그 위로는 싣지 않는다(가정).
  dispatch() {
    const S = this.def.source;
    let need = Math.min(this.def.stage, this.kits.length) - this.acs.pendingFrom(S);
    if (this.route) {
      for (const id of this.lifts) {
        const cw = this.work[id];
        if (!cw.outM && !this.units[id].down && cw.outSoon()) cw.outM = this.acs.request(this.hopMission(id));
      }
      const fleet = this.acs.amrs.filter((a) => !a.off).length;
      need = Math.min(need, Math.min(Math.max(1, fleet - 1), 2 * this.lifts.length) - this.wip());
    }
    for (let i = 0; i < need; i++) this.acs.request(this.mission());
  }

  // 흐름 안 키트 수: 분류 뒤 ~ 적재 구역 내리기 전 키트 + 아직 안 실은 분류 적재 미션
  wip() {
    for (const e of this.inFlow) if (!this.parts.get(e.id)) this.inFlow.delete(e);
    return this.inFlow.size + this.acs.pendingFrom(this.def.source);
  }

  // 수요 기반 목적지(공정 순서 없을 때)
  pickSink(kit) { return this.acs.ok(kit.dest) ? kit.dest : this.nextDest(); }

  // ── 공정 순서: 키트 엔티티 step = 마지막으로 들른 route 칸 번호(분류 SORT = 0) ──
  nextOf(e) { return this.route?.[(e?.step ?? 0) + 1] ?? null; }

  // 다음 칸 예약. 리프트 셀은 리프트가 비고 다른 예약이 없을 때만, 뒤 공정(step 큰) 키트가 같은 셀을 기다리면 양보. 없으면 null(충전 자리 대기).
  stageOf(load) {
    const e = load.e;
    if (!e) return this.acs.ok('OUT') ? 'OUT' : null;
    const id = this.nextOf(e);
    if (!id || !this.acs.ok(id)) return null;
    if (id === 'OUT') return id;
    const cw = this.work[id];
    if (!cw) return null;
    if (cw.reserved === load.amr) return id;
    if (cw.reserved || this.units[id].down || !cw.canAccept(false)) return null;
    // 뒤 공정 키트 먼저, 같은 공정이면 먼저 분류된 키트 먼저(줄 순서 — 대기 차 배열 순서로 정하면 뒤 번호 차가 굶는다)
    const first = (x, y) => (x.step ?? 0) > (y.step ?? 0) || ((x.step ?? 0) === (y.step ?? 0) && (x.no ?? x.id) < (y.no ?? y.id));
    if (this.acs.amrs.some((b) => b.load?.e && b.load !== load && b.load.dest == null && this.nextOf(b.load.e) === id && first(b.load.e, e))) return null;
    cw.reserved = load.amr;
    return id;
  }

  // 실은 키트를 다음 칸으로: 리프트 셀이면 리프트에 넘기고(그 방문 pass), OUT 이면 협동로봇이 도어트림만 집는다(빈 지그는 AMR 에 남음).
  carry(m) {
    const O = this.work.OUT;
    m.what = { ...m.what, drop: (id) => (id === 'OUT' ? '하역' : '지그 올림') };
    m.dest = (load) => this.stageOf(load);
    m.canDrop = (id) => (id === 'OUT' ? O.canAccept() : !this.units[id].down && this.work[id].canAccept(false));
    m.unload = (a, id) => {
      const e = a.load?.e;
      if (!e) return this.timer(1);
      if (id === 'OUT') { m.U = O.offer(e, { k: 'amr', id: a.id }, toLocal(this.cellPose('OUT'), a), a.heading - Math.PI / 2); return m.U; }
      const k = (e.step ?? 0) + 1;
      e.step = k;
      m.U = this.work[id].offer(e, { k: 'amr', id: a.id }, toLocal(this.cellPose(id), a), passOf(this.route, k));
      return m.U;
    };
    m.drop = (load, id) => {
      if (id !== 'OUT') { this.delivered++; return; }
      if (load.e) { this.outbound++; this.inFlow.delete(load.e); }
      const a = this.acs.amrs.find((x) => x.id === load.amr);
      if (a && m.U?.jig && this.parts.get(m.U.jig.id)) a.keep = m.U.jig;
    };
    return m;
  }

  // 반출(hop): 빈 AMR 이 리프트 밑에 서면 지그를 내려 안착 → 다음 칸(리프트 셀 또는 OUT)으로.
  hopMission(id) {
    const cw = this.work[id];
    const m = {
      from: id, hop: true,
      what: {
        pick: `${id} 지그 받으러`, wait: `${id} 작업 끝 대기(지그 밑)`, hand: '지그 내림', tag: id,
        carry: (to, l) => `키트 #${l.id} → ${to === 'OUT' ? '적재 구역' : to}`,
      },
      ready: () => !this.units[id].down && cw.outReady(),
      pickup: (a) => { m.T = cw.offerOut({ k: 'amr', id: a.id }, toLocal(this.cellPose(id), a)); return m.T; },
      load: (a) => {
        if (cw.outM === m) cw.outM = null;
        const e = m.T?.loaded && this.parts.get(m.T.kit?.id) ? m.T.kit : null;
        return { id: e?.no ?? e?.id ?? `F${++this.outSeq}`, e, from: id, amr: a.id };
      },
      abort: (a) => {
        if (cw.outM === m) cw.outM = null;
        for (const c of this.lifts) if (this.work[c].reserved === a.id) this.work[c].reserved = null;
        if (!a.load) { if (m.T) cw.cancelOut(m.T); return; }
        const W = this.work[a.load.dest];
        if (W && a.ticket && W.cancel(a.ticket)) return;   // 리프트·협동로봇이 이미 물었다 — 그쪽 몫
        const e = a.load.e;
        if (e && this.parts.get(e.id)) { this.inFlow.delete(e); this.parts.remove(e); }
      },
    };
    return this.carry(m);
  }

  mission() {
    const S = this.def.source, cap = this.def.stock.cap;
    const m = {
      from: S,
      ready: () => !this.units[S].down && this.kits.length > 0 && !this.work[S]?.busy?.(),
      load: (a) => {
        const i = Math.max(0, this.kits.findIndex((k) => k.e && k.e === m.picked));
        const k = this.kits.splice(i, 1)[0];
        m.picked = null;
        if (k.e) {
          this.freeRack(k.e);
          this.parts.hold(k.e, { k: 'amr', id: a.id }, k.e.holder);
          if (this.route) { k.e.step = 0; this.inFlow.add(k.e); }
        }
        return { ...k, amr: a.id };
      },
      dest: (kit) => this.pickSink(kit),
      canDrop: (id) => {
        const u = this.units[id];
        if (u.down) return false;
        if (this.work[id]) return this.work[id].canAccept(false);
        if (this.slots[id] && !this.slots[id].items.includes(null)) return false;
        return u.stock < cap;
      },
      drop: (kit, id) => {
        this.delivered++;
        if (this.work[id]) return;
        this.units[id].stock++;
        if (kit.e && !this.slots[id]) this.parts.remove(kit.e);
      },
      abort: (a) => {
        for (const id of this.def.sinks) if (this.work[id] && this.work[id].reserved === a.id) this.work[id].reserved = null;
        if (a.ticket) a.ticket.cancel = true;
        if (m.picked && !a.ticket?.started) {
          const i = this.rack.items.indexOf(m.picked);
          if (i >= 0) this.parts.hold(m.picked, { k: 'rack', cell: this.rack.cell, i });
          m.picked = null;
        }
        if (!a.load) return;
        const e = a.load.e;
        const W = this.work[a.load.dest];
        if (W && a.ticket && W.cancel(a.ticket)) return;   // 로봇·리프트가 이미 물었다 — 키트는 셀 몫
        for (const sl of Object.values(this.slots)) { const j = sl.items.indexOf(e); if (j >= 0) sl.items[j] = null; }
        if (e) {
          this.inFlow.delete(e);
          e.step = 0;
          const i = this.rack ? this.rack.items.indexOf(null) : -1;
          if (i >= 0) { this.rack.items[i] = e; this.parts.hold(e, { k: 'rack', cell: this.rack.cell, i }); }
          else this.parts.remove(e);
        }
        this.kits.unshift({ id: a.load.id, dest: a.load.dest, e: e && this.parts.get(e.id) ? e : null });
      },
    };
    if (!this.proc) return m;
    // SORT 랙 → AMR 적재면 옮김(시간 티켓). 맨 앞 키트를 잡는다.
    const sw = this.work[this.def.source];
    m.pickup = (a) => {
      if (sw) {
        // 랙 맨 위(가장 높은 칸) 키트를 양팔이 지그째 집어 메인 AMR MAIN 패널에 놓는다
        const k = this.kits.filter((x) => x.e && this.rack.items.includes(x.e)).sort((x, y) => this.rack.items.indexOf(y.e) - this.rack.items.indexOf(x.e))[0];
        if (!k) return this.timer(4);
        m.picked = k.e;
        return sw.load(k.e, { k: 'amr', id: a.id }, toLocal(this.cellPose(this.def.source), a), (e, from) => this.backToRack(e, from));
      }
      const k = this.kits[0];
      if (!k?.e) return this.timer(this.rack?.time ?? 4);
      m.picked = k.e;
      this.move(k.e, { k: 'amr', id: a.id }, this.rack.time);
      return this.timer(this.rack.time);
    };
    if (this.route) return this.carry(m);
    m.unload = (a, id) => {
      const e = a.load?.e;
      const sl = this.slots[id];
      if (sl && e) {
        const i = sl.items.indexOf(null);
        sl.items[i] = e;
        const to = this.worldOf(id, this.ptArr(sl.pts[i]));
        this.move(e, to, sl.time);
        return this.timer(sl.time, () => this.parts.hold(e, { k: 'slot', cell: id, i }, e.holder));
      }
      return this.timer(4);
    };
    return m;
  }

  // 취소된 적재: 팔이 놓으려던 키트를 랙 제자리로 옮긴다(자리는 적재가 끝날 때까지 잡혀 있다).
  backToRack(e, from) {
    const i = this.rack.items.indexOf(e);
    if (i < 0) { this.parts.remove(e); return; }
    this.parts.hold(e, { k: 'drop', cell: this.rack.cell, at: this.work[this.rack.cell].local(e) }, from);
    this.move(e, this.poseOf({ holder: { k: 'rack', cell: this.rack.cell, i } }), this.rack.time);
    this.timer(this.rack.time, () => this.parts.hold(e, { k: 'rack', cell: this.rack.cell, i }, e.holder));
  }

  timer(dur, done = null) {
    const t = { end: this.time + dur, released: false, done };
    this.timed.push(t);
    return t;
  }

  summary() {
    return {
      kits: this.kits.length,
      delivered: this.delivered,
      outbound: this.outbound,
      shipped: this.work.OUT?.shipped ?? 0,
      units: Object.values(this.units).map(({ id, state, stock, done, progress }) => ({ id, state, stock, done, progress })),
      wip: this.route ? this.wip() : null,
      acs: this.acs.summary(),
      supply: this.supply ? { delivered: this.supply.delivered, acs: this.supply.acs.summary() } : null,
      hound: this.hound.view(),
      inspector: this.inspector?.view() ?? null,
      drones: this.drones.view(),
      health: this.health.view(),
      parts: this.parts.items.size,
      violations: this.parts.violationCount,
    };
  }
}
