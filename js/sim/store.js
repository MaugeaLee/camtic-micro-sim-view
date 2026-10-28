// 도어트림 원재료 창고(STORE, 가정 — 부품 창고 동쪽): 선반 칸마다 지그째 키트 엔티티. 입고 부품 AMR 이 도크에 서면 한 칸을 적재면으로 옮기고,
// 빈 칸은 입고 팔레트(receive)에서 restock 초마다 한 칸씩 채운다. 창고 밖 물류(트럭·지게차)는 가정이고 그리지 않는다.
// 키트는 칸·팔레트 → 옮김(move) → 칸·AMR 으로만 간다 — AMR·랙 위에서 생기지 않는다. DOM·three 없음.
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
    for (let i = 0; i < this.items.length; i++) this.items[i] = plant.parts.add('kit', this.holder(i), spec);
  }

  holder(i) { return { k: 'store', cell: this.id, i }; }
  pt(i) { const p = this.def.slots[i]; return [p.x, p.y, p.z]; }

  // 칸에 놓인(옮기는 중 아님) 키트 수
  get ready() { return this.items.filter((e) => e && e.holder.k === 'store').length; }

  step() {
    const P = this.plant, i = this.items.indexOf(null);
    if (i < 0 || P.time < this.next) return;
    const r = this.def.receive;
    const e = P.parts.add('kit', { k: 'drop', cell: this.id, at: [r.x, r.y, r.z] }, this.spec);
    this.items[i] = e;
    this.next = P.time + this.def.restock;
    this.received++;
    P.move(e, this.holder(i), this.def.move);
    P.timer(this.def.move, () => { if (P.parts.get(e.id)) P.parts.hold(e, this.holder(i), e.holder); });
  }

  // 도크에 선 AMR 로 한 칸. 티켓(released = 적재면에 닿음)과 키트. 칸이 비었으면 null.
  take(a, dur) {
    const P = this.plant, i = this.items.findIndex((e) => e && e.holder.k === 'store');
    if (i < 0) return null;
    const e = this.items[i], to = { k: 'amr', id: a.id };
    this.items[i] = null;
    this.next = Math.max(this.next, P.time + this.def.move);
    this.taken++;
    P.move(e, to, dur);
    const T = P.timer(dur, () => { if (P.parts.get(e.id)) P.parts.hold(e, to, e.holder); });
    return { e, T };
  }

  // 싣던 키트를 거둠: 빈 칸이 있으면 그 칸으로 돌려놓고, 없으면 지운다(창고로 반납한 셈).
  giveBack(e) {
    const P = this.plant;
    if (!e || !P.parts.get(e.id)) return;
    const i = this.items.indexOf(null);
    if (i < 0) { P.parts.remove(e); return; }
    this.items[i] = e;
    P.parts.hold(e, this.holder(i));
  }
}
