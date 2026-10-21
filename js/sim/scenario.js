// 시나리오: 시뮬 시간축으로 셀 상태(IDLE/BUSY/DOWN)를 구동하고 공급 AMR을 배차한다. DOM·three 없음.
// 흐름 가정: SORT가 서브부품을 분류해 키트를 만들고, 공급 AMR이 SCREW·PRESS 셀 앞 도크로 나른다.
// 사이클·재고·고장 시각은 모두 가정값이다. 실측·확정 공정이 아니다.
import { AMR, Fleet, laneRoute, leg, parkSlot } from './fleet.js';

const { low: AMR_LOW, ready: AMR_READY } = AMR.battery;
// 도크 진입로(대기점~통로 사이)에 2대까지만 줄 선다. 6대부터 줄이 통로로 넘쳐 우회가 되풀이된다.
export const AMR_MAX = 5;

const base = {
  assumed: true,
  amr: 2,
  stage: 2,
  source: 'SORT',
  sinks: ['SCREW', 'PRESS'],
  cycle: { SORT: 14, SCREW: 42, PRESS: 36 },
  handle: { load: 4, unload: 4 },
  stock: { init: 1, cap: 2 },
  buffer: 3,
  faults: [],
  period: 0,
};

export const SCENARIOS = Object.freeze({
  supply: Object.freeze({ ...base, label: '공급 흐름' }),
  faults: Object.freeze({
    ...base,
    label: '공급 흐름 + 고장',
    period: 540,
    faults: Object.freeze([
      { at: 110, id: 'PRESS', dur: 55, why: '압입 설비 이상(가정)' },
      { at: 250, id: 'SORT', dur: 40, why: '분류 비전 오류(가정)' },
      { at: 390, id: 'SCREW', dur: 50, why: '체결 토크 이상(가정)' },
    ]),
  }),
});
export const DEFAULT_SCENARIO = 'faults';

export function validateScenario(def) {
  const errors = [];
  if (!def || typeof def !== 'object') return ['시나리오가 객체 아님'];
  if (!(def.amr >= 0 && def.amr <= AMR_MAX)) errors.push(`amr은 0~${AMR_MAX}`);
  for (const id of [def.source, ...(def.sinks ?? [])]) if (!(def.cycle?.[id] > 0)) errors.push(`${id} cycle은 양수`);
  if (def.period && def.faults.some((f) => f.at + f.dur > def.period)) errors.push('고장 구간이 period 밖');
  return errors;
}

export class Plant {
  constructor(def, { layout, cells, amr } = {}) {
    if (amr != null) def = { ...def, amr };
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
    this.fleet = new Fleet(def.amr, layout);
    this.fleet.note = (a, text) => this.host?.log('info', `${a.id} ${text}`);
    this.host = null;
    this.delivered = 0;
  }

  setLayout(layout) {
    this.fleet.setLayout(layout);
    // 도크가 옮겨졌으면 이동 중 경로는 버리고 대기 줄로 돌려보낸다 (실은 키트는 들고 간다)
    for (const a of this.fleet.amrs) if (a.mode !== 'park' || !a.idle) this.sendHome(a, '레이아웃 변경 — 복귀');
    for (const d of Object.values(this.fleet.docks)) d.holder = null;
  }

  get docks() { return this.fleet.docks; }

  step(h, host) {
    this.host = host;
    this.faults(host.time, host);
    this.runSource(h);
    for (const id of this.def.sinks) this.runSink(this.units[id], h);
    this.dispatch();
    this.fleet.step(h);
    for (const u of Object.values(this.units)) host.setCellState(u.id, u.state);
  }

  // ── 고장 타임라인 (period 마다 되풀이) ──
  faults(t, host) {
    const { period, faults } = this.def;
    const tl = period ? t % period : t;
    for (const f of faults) {
      const u = this.units[f.id];
      const on = tl >= f.at && tl < f.at + f.dur;
      if (on && !u.down) { u.down = f; host.log('error', `${f.id} 고장`, { obs: `${f.why} · ${f.dur}s 정지 예정` }); }
      else if (!on && u.down === f) { u.down = null; host.log('info', `${f.id} 복구`); }
    }
  }

  runSource(h) {
    const u = this.units[this.def.source];
    if (u.down) { u.state = 'DOWN'; return; }
    if (this.kits.length >= this.def.buffer) { u.state = 'IDLE'; return; }
    u.state = 'BUSY';
    u.progress += h / this.def.cycle[u.id];
    if (u.progress >= 1) {
      u.progress = 0; u.done++;
      this.kits.push({ id: ++this.kitSeq, dest: this.nextDest(), amr: null });
    }
  }

  // 수요가 가장 큰(재고+운반중+대기 키트가 가장 적은) 셀로 보낸다.
  nextDest() {
    const want = (id) => this.units[id].stock + this.kits.filter((k) => k.dest === id).length
      + this.fleet.amrs.filter((a) => a.load?.dest === id).length + (this.units[id].working ? 0 : -0.5);
    return [...this.def.sinks].sort((a, b) => want(a) - want(b))[0];
  }

  runSink(u, h) {
    if (u.down) { u.state = 'DOWN'; return; }
    if (!u.working && u.stock > 0) { u.stock--; u.working = true; u.progress = 0; }
    if (!u.working) { u.state = 'IDLE'; return; }
    u.state = 'BUSY';
    u.progress += h / this.def.cycle[u.id];
    if (u.progress >= 1) { u.progress = 0; u.working = false; u.done++; }
  }

  // ── 배차: 키트 수(+곧 나올 키트)만큼 공급 AMR을 SORT 도크로 부른다. 선행 배차 상한 stage ──
  dispatch() {
    const src = this.units[this.def.source];
    const coming = this.fleet.amrs.filter((a) => a.mode === 'job' && !a.load).length;
    const soon = !src.down && src.state === 'BUSY' && (1 - src.progress) * this.def.cycle[src.id] < 10 ? 1 : 0;
    const need = Math.min(this.def.stage, this.kits.length + soon) - coming;
    for (let i = 0; i < need; i++) {
      const a = this.pickAmr();
      if (!a) break;
      this.assign(a);
    }
  }

  pickAmr() {
    const d = this.docks[this.def.source];
    if (!d?.ok) return null;
    const free = this.fleet.amrs.filter((a) => a.mode === 'park' && a.idle && a.battery >= (a.lowLock ? AMR_READY : AMR_LOW));
    free.sort((a, b) => Math.abs(a.x - d.inX) - Math.abs(b.x - d.inX));
    return free[0] ?? null;
  }

  assign(a) {
    const S = this.docks[this.def.source];
    a.mode = 'job'; a.slot = null; a.lowLock = false;
    a.setTask(`${S.id} 픽업으로`, [
      { go: laneRoute(a, S.inX) },
      ...this.claim(a, S, () => !this.units[S.id].down, `${S.id} 도크 대기`),
      { until: () => !this.units[S.id].down && this.kits.some((k) => !k.amr), label: `${S.id} 키트 대기` },
      { do: () => { const k = this.kits.find((k) => !k.amr); k.amr = a.id; a.kit = k; } },
      { wait: this.def.handle.load, label: `${S.id} 적재 중` },
      { do: () => { this.kits = this.kits.filter((k) => k !== a.kit); a.load = a.kit; a.kit = null; this.deliver(a); } },
    ]);
  }

  deliver(a) {
    const S = this.docks[this.def.source], D = this.docks[a.load.dest], u = this.units[a.load.dest];
    if (!D?.ok) { this.sendHome(a, `${a.load.dest} 도크 도달 불가 — 복귀`); return; }
    a.setTask(`${D.id}로 키트 #${a.load.id}`, [
      { go: leg.undock(S) },
      { do: () => this.release(S, a) },
      { go: laneRoute({ x: S.outX, z: S.bay }, D.inX) },
      ...this.claim(a, D, () => !u.down && u.stock < this.def.stock.cap, `${D.id} 도크 대기`),
      { until: () => !u.down && u.stock < this.def.stock.cap, label: `${D.id} 하역 대기` },
      { wait: this.def.handle.unload, label: `${D.id} 하역 중` },
      { do: () => { u.stock++; this.delivered++; a.load = null; this.home(a, D); } },
    ]);
  }

  // 도크 점유: 대기열(FIFO)에 줄 서고, 맨 앞이고 도크가 비고 조건이 맞을 때만 들어간다 (micro-assembly 진입 게이트 규칙).
  claim(a, d, ok, label) {
    return [
      { do: () => { if (!d.line.includes(a)) d.line.push(a); a.inLine = d; } },
      { go: leg.toQueue(d) },
      { until: () => d.line[0] === a && (!d.holder || d.holder === a) && ok(), label },
      { do: () => { d.holder = a; d.line.shift(); a.inLine = null; } },
      { go: leg.dockIn(d) },
    ];
  }

  release(d, a) { if (d.holder === a) d.holder = null; }

  home(a, from) {
    const slot = this.fleet.freeSlot();
    const s = parkSlot(slot);
    a.slot = slot; a.mode = 'return';
    const low = a.battery < AMR_LOW;
    if (low) { a.lowLock = true; this.host?.log('warn', `${a.id} 배터리 ${a.battery.toFixed(0)}% — 충전 복귀`); }
    a.setTask(low ? '충전 복귀' : '대기 줄 복귀', [
      { go: leg.undock(from) },
      { do: () => this.release(from, a) },
      { go: laneRoute({ x: from.outX, z: from.bay }, s.x) },
      { go: leg.toPark(s) },
      { do: () => { a.mode = 'park'; a.task = '대기'; } },
    ]);
  }

  sendHome(a, why) {
    for (const d of Object.values(this.docks)) {
      if (d.holder === a) d.holder = null;
      d.line = d.line.filter((k) => k !== a);
    }
    a.inLine = null;
    if (a.kit) { a.kit.amr = null; a.kit = null; }
    const slot = a.mode === 'park' && a.slot != null ? a.slot : this.fleet.freeSlot();
    const s = parkSlot(slot);
    a.slot = slot; a.mode = a.load ? 'job' : 'return';
    a.setTask(why, [
      { go: laneRoute(a, s.x) },
      { go: leg.toPark(s) },
      { do: () => {
        a.mode = 'park'; a.task = '대기';
        if (a.load) { this.kits.unshift({ ...a.load, amr: null }); a.load = null; }
      } },
    ]);
  }

  summary() {
    return {
      kits: this.kits.length,
      delivered: this.delivered,
      units: Object.values(this.units).map(({ id, state, stock, done, progress }) => ({ id, state, stock, done, progress })),
    };
  }
}