// 도어트림 원재료 창고(STORE, 가정 — 부품 창고 동쪽): 선반 칸마다 지그째 키트 엔티티. 입고 부품 AMR 이 도크에 서면
// 휴머노이드가 한 칸을 집어 적재면에 올리고, 빈 칸은 입고 팔레트(receive)에서 restock 초마다 한 칸씩 채운다.
// 창고 밖 물류(트럭·지게차)는 가정이고 그리지 않는다. 키트는 칸·팔레트 → 휴머노이드 → AMR — AMR·랙 위에서 생기지 않는다. DOM·three 없음.
import { SLOW } from './incidents.js';
import { HumanoidWork, amrDeckAt, humanoidDef } from './humanoid.js';

export class Store {
  // def: process cells.SORT.inbound.store, plant: move·timer·time·parts 를 쓴다
  constructor(id, def, plant, spec) {
    this.id = id;
    this.def = def;
    this.plant = plant;
    this.spec = spec;
    this.items = def.slots.map(() => null);
    this.next = 0;
    this.received = 0;
    this.taken = 0;
    this.arm = new HumanoidWork(id, humanoidDef(def.humanoid, { time: def.move }), plant.parts);
    for (let i = 0; i < this.items.length; i++) this.items[i] = plant.parts.add('kit', this.holder(i), spec);
  }

  holder(i) { return { k: 'store', cell: this.id, i }; }
  pt(i) { const p = this.def.slots[i]; return [p.x, p.y, p.z]; }

  // 칸에 놓인(옮기는 중 아님) 키트 수
  get ready() { return this.items.filter((e) => e && e.holder.k === 'store').length; }

  step(h = 0) {
    this.arm.step(h);
    for (let n = 0; n < this.items.length; n++) {
      const e = this.items[n];
      if (e && e.holder.k === 'amr') this.items[n] = null;
    }
    const P = this.plant, i = this.items.indexOf(null);
    if (i < 0 || P.time < this.next || this.arm.busy) return;
    const hold = P.supplyHold?.('raw');
    if (hold?.mode === 'stop') return;
    const r = this.def.receive;
    const e = P.parts.add('kit', { k: 'drop', cell: this.id, at: [r.x, r.y, r.z] }, this.spec);
    this.items[i] = e;
    this.next = P.time + this.def.restock * (hold?.mode === 'slow' ? SLOW : 1);
    this.received++;
    P.move(e, this.holder(i), this.def.move);
    P.timer(this.def.move, () => { if (P.parts.get(e.id)) P.parts.hold(e, this.holder(i), e.holder); });
  }

  // 도크에 선 AMR 로 한 칸. 티켓(released = 적재면에 닿음)과 키트. 칸이 비었거나 휴머노이드가 바쁜 경우 null.
  take(a, dur) {
    if (this.arm.busy) return null;
    const i = this.items.findIndex((e) => e && e.holder.k === 'store');
    if (i < 0) return null;
    const e = this.items[i], to = { k: 'amr', id: a.id };
    this.next = Math.max(this.next, this.plant.time + this.def.move);
    this.taken++;
    const deck = amrDeckAt(this.plant, this.id, to);
    const T = this.arm.offer([{
      e, from: this.pt(i), to, toAt: deck.at, fromYaw: 0, toYaw: deck.yaw, time: dur ?? this.arm.time, label: `${this.id} 출고`,
    }]);
    return T ? { e, T } : null;
  }

  // 싣던 키트를 거둠: 같은 칸에 아직 있으면 그 칸으로, 빈 칸이 있으면 그 칸으로, 없으면 지운다.
  giveBack(e) {
    const P = this.plant;
    if (!e || !P.parts.get(e.id)) return;
    const have = this.items.indexOf(e);
    if (have >= 0) { P.parts.hold(e, this.holder(have)); return; }
    const i = this.items.indexOf(null);
    if (i < 0) { P.parts.remove(e); return; }
    this.items[i] = e;
    P.parts.hold(e, this.holder(i));
  }
}
