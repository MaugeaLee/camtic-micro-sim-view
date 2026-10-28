// 부속 부품 공급(가정). 도어트림 AMR 과 따로 도는 두 번째 ACS(자기 루트·충전 자리)가 두 구간을 맡는다:
//   ① 창고 → SORT 투입: 라인 팔레트 남은 수가 reorder 이하인 라인마다 요청이 쌓이고, 부품 AMR 하나가 창고에서 쌓인 요청만큼(최대 batch)
//      토트를 싣고 SORT 투입 자리(SORT:IN)에 선다. 투입 이송기가 다 옮기면 다른 일로 간다.
//   ② SORT 레인 → 라인: 컨베이어 바코드 스캔으로 토트의 목적 라인 → 레인(색)이 정해지면 그 레인 자리 픽업 미션을 건다. AMR 이 레인 자리에
//      미리 와서 기다리다 내림 이송기가 내려 준 토트를 받아 그 라인 적재 팔레트 도크로 가 상자를 덤프한다.
//      셀 직교이송이 상자를 롤러에 올리고, 롤러가 당기면 협동로봇이 상자에서 부품을 집는다(토트는 비울 때까지 유지).
// SORT 레인은 도어트림 AMR 이 듀얼암 적재 자리로 지나가는 한 줄 통로와 같다(같은 칸·같은 잠금, acs.js shareCross).
// 같은 ACS 가 도어트림 원재료 입고(원재료 창고 STORE → SORT:RAW, scenario.js inMission)도 받는다 — 두 창고가 남쪽 창고 줄에 붙어 있다.
// 수량·시간·창고 자리·분류 규칙 모두 가정이다. DOM·three 없음.
import { Acs } from './acs.js';
import { partsLayout, toLocal } from './layout.js';

export const PARTS_SITE = 'PARTS';
export const INFEED = 'SORT:IN';

// Admin 에서 옮긴 부품 AMR 도킹 자리 점검(경고만). 이송기는 한 축이라 축에서 벗어난 자리의 토트는 집지 못하고,
// 라인 도크가 팔레트에서 멀면 하역 토트가 먼 거리를 옮겨진다. layout: 정규화된 레이아웃, P: 공정 정의.
export function dockIssues(layout, P) {
  const F = P?.cells?.SORT?.feed, out = [];
  if (!F || !layout?.parts) return out;
  const IN = layout.parts.cells[INFEED]?.stops.at(-1);
  if (IN && Math.abs(IN.z - F.conveyor.z) > 0.15) out.push(`${INFEED} 도킹 자리가 투입 이송기 축(셀 로컬 z ${F.conveyor.z})에서 ${Math.abs(IN.z - F.conveyor.z).toFixed(2)} m 벗어남`);
  const stops = layout.amr.cells.SORT?.stops ?? [];
  for (const l of F.lanes) if (!stops.some((s) => Math.abs(s.x - l.x) < 0.3)) out.push(`SORT 레인 ${l.id} 받는 칸 없음(셀 로컬 x ${l.x} ± 0.3)`);
  for (const [cell, C] of Object.entries(P.cells)) {
    for (const L of C.lines ?? []) {
      const d = layout.parts.cells[`${cell}:${L.id}`]?.stops.at(-1);
      if (d && Math.abs(d.x - L.x) > 0.5) out.push(`${cell}:${L.id} 도크가 라인(x ${L.x})에서 ${Math.abs(d.x - L.x).toFixed(2)} m 옆`);
    }
  }
  return out;
}

export class Supply {
  // plant: Plant(timer·move·parts·poseOf·units). S: supplyDef. count: 부품 AMR 대수. feed: SORT 분류(SortFeed).
  constructor(plant, S, layout, count, feed) {
    this.plant = plant;
    this.S = S;
    this.feed = feed;
    this.cell = feed.id;
    this.acs = new Acs(Math.min(count, layout.parts.homes.length), partsLayout(layout), { prefix: 'P-AMR' });
    this.acs.note = (a, text) => plant.host?.log('info', `${a.id} ${text}`);
    for (const a of this.acs.amrs) a.deck = S.top;
    this.seq = 0;
    this.delivered = 0;
    this.trips = 0;
    this.lines = [];
    this.unserved = [];
    this.waiting = [];          // 요청했지만 아직 창고에서 싣지 않은 라인
    this.fetch = null;          // 아직 싣지 않은 창고 미션(하나만 — 그동안 요청이 쌓인다)
    this.resetting = false;
    const h = S.tote.size[1];
    this.slots = [[-0.27, 0, 0], [0.27, 0, 0], [-0.27, 0, h], [0.27, 0, h]].slice(0, S.batch);
    for (const id of plant.def.sinks) {
      const cw = plant.work[id];
      if (!cw?.lines) continue;
      cw.enableTote(S);
      for (const L of cw.lines) {
        const dock = `${id}:${L.id}`, lane = feed.laneOf(dock);
        if (lane) this.lines.push({ cell: id, cw, L, dock, lane });
        else this.unserved.push(dock);
      }
    }
    feed.onScan = (e, lane) => this.laneTrip(e, lane);
  }

  // 레이아웃이 바뀌면 ACS 가 미션을 모두 거둔다(대기 줄 포함) — 분류 중인 토트도 치우고 요청부터 다시.
  setLayout(layout) {
    this.resetting = true;
    this.acs.setLayout(partsLayout(layout));
    for (const a of this.acs.amrs) a.deck = this.S.top;
    this.resetting = false;
    this.feed.clear();
    for (const { L } of this.lines) L.incoming = 0;
    this.waiting = [];
    this.fetch = null;
  }

  step(h) {
    this.dispatch();
    this.acs.step(h);
  }

  dispatch() {
    for (const x of this.lines) {
      const { L } = x;
      if (L.incoming > 0 || L.left > this.S.reorder || !this.acs.ok(x.dock)) continue;
      L.incoming = 1;
      this.waiting.push(x);
    }
    if (this.waiting.length && !this.fetch && this.acs.ok(PARTS_SITE) && this.acs.ok(INFEED)) this.fetch = this.acs.request(this.fetchMission());
  }

  // SORT 레인 칸 번호(ACS SORT 정차 칸 중 레인 x 에 있는 것). 없으면 -1.
  laneStop(lane) {
    const stops = this.acs.layout.amr.cells[this.cell]?.stops ?? [];
    return stops.findIndex((s) => Math.abs(s.x - lane.x) < 0.3);
  }

  // 토트 밑면을 SORT 셀 로컬 [x,y,z] 로
  localOf(e) {
    const P = this.plant, w = P.poseOf(e);
    if (!w) return null;
    const l = toLocal(P.cellPose(this.cell), w);
    return [l.x, w.y, l.z];
  }

  // ① 창고 → SORT 투입
  fetchMission() {
    const P = this.plant, S = this.S;
    const m = {
      from: PARTS_SITE,
      totes: [],
      what: {
        pick: '부품 창고로',
        wait: '부품 창고 대기',
        hand: '토트 적재',
        carry: (id, l) => `토트 ${l.totes.length}개 → SORT 투입`,
      },
      ready: () => true,
      pickup: (a) => {
        if (this.fetch === m) this.fetch = null;
        const take = this.waiting.splice(0, S.batch);
        const at = [S.shelf.x, S.shelf.y, S.shelf.z];
        m.totes = take.map((x, i) => {
          const e = P.parts.add('tote', { k: 'drop', cell: PARTS_SITE, at }, { size: S.tote.size, h: S.tote.size[1], color: S.tote.color ?? '#2f7dd1', part: x.L.part, dock: x.dock, n: S.qty });
          const to = { k: 'amr', id: a.id, at: this.slots[i] };
          P.move(e, to, S.load);
          return { e, x, to };
        });
        m.T = P.timer(S.load, () => { for (const t of m.totes) P.parts.hold(t.e, t.to, t.e.holder); });
        return m.T;
      },
      load: () => ({ id: ++this.seq, totes: m.totes, dest: null }),
      dest: () => (this.acs.ok(INFEED) ? INFEED : null),
      canDrop: () => !P.units[this.cell]?.down && !this.feed.infeed,
      unload: () => {
        const order = [...m.totes].sort((p, q) => q.to.at[2] - p.to.at[2] || p.to.at[0] - q.to.at[0]).map((t) => t.e);
        m.U = this.feed.feedIn(order, (e) => this.localOf(e));
        return m.U;
      },
      drop: () => { this.trips++; },
      // 미션을 거둠: AMR 에 남은 토트는 창고로 돌린 셈 치고 지우고 그 라인은 다시 요청한다. 컨베이어에 오른 것은 그대로 흐른다.
      abort: () => {
        if (this.fetch === m) this.fetch = null;
        if (m.T && !m.T.released) m.T.cancel = true;
        if (m.U && !m.U.released) m.U.cancel = true;
        for (const t of m.totes) {
          const k = P.parts.get(t.e.id)?.holder.k;
          if (k !== 'amr' && k !== 'move' && k !== 'drop') continue;
          P.parts.remove(t.e);
          t.x.L.incoming = 0;
        }
      },
    };
    return m;
  }

  // ② 스캔된 토트 하나 → 그 레인 자리 픽업 → 라인 도크
  laneTrip(e, lane) {
    const P = this.plant, S = this.S;
    const stop = lane ? this.laneStop(lane) : -1;
    if (stop < 0) { P.host?.log('warn', `${this.cell} 레인 ${lane?.id ?? '?'} AMR 칸 없음`, { obs: `토트 #${e.id} 레인에 남음` }); return; }
    const m = {
      from: this.cell,
      stop,
      lane: lane.id,
      what: {
        pick: `SORT 레인 ${lane.id}로(${e.dock})`,
        wait: `레인 ${lane.id} 토트 대기`,
        hand: `레인 ${lane.id} 내림`,
        carry: (id, l) => `${l.part} 토트 #${l.e?.id} → ${id}`,
      },
      ready: () => true,
      pickup: (a) => {
        m.T = this.feed.handTo(lane.id, { k: 'amr', id: a.id, at: [0, 0, 0] }, toLocal(P.cellPose(this.cell), a), S.top);
        return m.T;
      },
      load: () => {
        const t = m.T?.tote ?? null;
        m.x = t ? this.lines.find((x) => x.dock === t.dock) ?? null : null;
        return { id: ++this.seq, e: t, part: t?.part ?? '-', dest: null };
      },
      dest: () => (m.x && this.acs.ok(m.x.dock) ? m.x.dock : null),
      canDrop: () => !P.units[m.x.cell]?.down && m.x.cw.canAcceptTote(m.x.L),
      unload: (a) => {
        const t = a.load.e, x = m.x, { L } = x;
        P.move(t, P.worldOf(x.cell, [L.x, L.feed.stockY, L.feed.stock]), S.unload);
        m.U = P.timer(S.unload, () => {
          x.cw.acceptTote(L, t);
          this.delivered++;
        });
        return m.U;
      },
      drop: () => {},
      // 거둠: 실은 토트는 지우고 그 라인을 다시 요청한다. 아직 못 받았으면 토트는 레인에 남으니 새 픽업 미션을 건다.
      abort: (a) => {
        if (m.T && !m.T.released) m.T.cancel = true;
        if (m.U && !m.U.released) m.U.cancel = true;
        const t = a?.load?.e ?? (m.T?.released ? m.T.tote : null);
        if (t) {
          const k = P.parts.get(t.id)?.holder.k;
          if (k === 'stock' || k === 'gantry' || k === 'line' || k === 'tote') return;
          if (P.parts.get(t.id)) P.parts.remove(t);
          const x = this.lines.find((l) => l.dock === t.dock);
          if (x) x.L.incoming = 0;
        } else if (!this.resetting) this.laneTrip(e, lane);
      },
    };
    this.acs.request(m);
  }

  // 그리기·UI: 라인별 팔레트 남은 수 · 분류 상태
  view() {
    return {
      delivered: this.delivered,
      trips: this.trips,
      waiting: this.waiting.length,
      feed: this.feed.view(),
      lines: this.lines.map(({ cell, L, dock, lane }) => ({ cell, line: L.id, dock, lane: lane.id, part: L.part, left: L.left, incoming: L.incoming })),
    };
  }
}
