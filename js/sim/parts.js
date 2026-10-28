// 부품·키트 엔티티 등록부. 엔티티마다 소유자(holder)는 정확히 하나다. 옮김은 hold(e, 새 소유자, 예상 소유자)로만 한다. DOM·three 없음.
// holder 종류(k): amr{id} · rack{cell,i} · slot{cell,i} · store{cell,i}(원재료 창고 선반) · human{cell}(창고 휴머노이드) · station{cell,st} · robot{cell,r} · gantry{cell,line} · line{cell,line,s}
//   · stock{cell,line} · kit{kit,at:[dx,dz]} · tote{tote,at?}(상자 안 부품) · move{from,to,t0,dur,arc}(두 자리 사이 옮김 — 몸체 없는 이송)
//   · amr{id,at:[dx,dz,dy]}(한 AMR 여러 칸) · xfer{cell,t}(이송기) · belt{cell,line}(컨베이어·레인 롤러 위, 여럿)
//   · lift{cell}(셀 작업대 리프트가 든 지그+도어트림)
// 위치는 소유자가 정한다(scenario.js Plant.poseOf). 여기는 소유 관계와 위반만 다룬다.

// 혼자만 가질 수 있는 소유자 열쇠. line·kit·move 는 여럿(같은 줄 위 다른 s, 키트 위 다른 자리)이라 따로 본다.
export function holderKey(h) {
  switch (h?.k) {
    case 'amr': return h.at ? `amr:${h.id}:${h.at.join(',')}` : `amr:${h.id}`;
    case 'xfer': return `xfer:${h.cell}:${h.t}`;
    case 'rack': case 'slot': case 'store': return `${h.k}:${h.cell}:${h.i}`;
    case 'station': return `station:${h.cell}:${h.st}`;
    case 'lift': return `lift:${h.cell}`;
    case 'robot': return `robot:${h.cell}:${h.r}`;
    case 'human': return `human:${h.cell}`;
    case 'gantry': case 'stock': return `${h.k}:${h.cell}:${h.line}`;
    case 'kit': return `kit:${h.kit}:${h.at.join(',')}`;
    case 'tote': return `tote:${h.tote}`;
    default: return null;
  }
}

const same = (a, b) => {
  if (!a || !b || a.k !== b.k) return false;
  const ka = holderKey(a);
  if (ka) return ka === holderKey(b);
  if (a.k === 'line' || a.k === 'belt') return a.cell === b.cell && a.line === b.line;
  return a === b;
};

export class Parts {
  constructor() {
    this.items = new Map();
    this.seq = 0;
    this.violations = [];
    this.violationCount = 0;
    this.moves = 0;
  }

  add(type, holder, extra = {}) {
    const e = { id: ++this.seq, type, holder, ...extra };
    this.claim(e, holder);
    this.items.set(e.id, e);
    return e;
  }

  get(id) { return this.items.get(id) ?? null; }

  // 소유자 옮김. from 을 주면 지금 소유자가 그것인지 본다(아니면 위반 기록 — 두 곳에서 같은 물건을 잡은 것).
  hold(e, holder, from = null) {
    if (!e || !this.items.has(e.id)) { this.violate('없는 엔티티 옮김', e, holder); return false; }
    if (from && !same(e.holder, from)) this.violate(`소유자 불일치: ${holderKey(e.holder) ?? e.holder?.k} ≠ ${holderKey(from) ?? from.k}`, e, holder);
    this.claim(e, holder);
    e.holder = holder;
    this.moves++;
    return true;
  }

  claim(e, holder) {
    const key = holderKey(holder);
    if (!key) return;
    for (const o of this.items.values()) if (o !== e && holderKey(o.holder) === key) this.violate(`자리 중복: ${key}`, e, holder);
  }

  remove(e) {
    if (!e) return;
    for (const o of this.items.values()) {
      if (o.holder?.k === 'kit' && o.holder.kit === e.id) this.items.delete(o.id);
      if (o.holder?.k === 'tote' && o.holder.tote === e.id) this.items.delete(o.id);
    }
    this.items.delete(e.id);
  }

  violate(why, e, holder) {
    this.violations.push({ why, id: e?.id ?? null, to: holderKey(holder) ?? holder?.k ?? null });
    if (this.violations.length > 50) this.violations.shift();
    this.violationCount++;
  }

  list() { return [...this.items.values()]; }
  on(pred) { return this.list().filter((e) => pred(e.holder, e)); }
  kitParts(kit) { return this.on((h) => h.k === 'kit' && h.kit === kit.id); }

  // 점검: 혼자 소유 자리에 둘 이상, 키트 위 소유자가 없는 키트. 반환 문자열 배열(빈 배열 = 정상).
  audit() {
    const seen = new Map(), out = [];
    for (const e of this.items.values()) {
      const key = holderKey(e.holder);
      if (e.holder?.k === 'kit' && !this.items.has(e.holder.kit)) out.push(`#${e.id} 키트 #${e.holder.kit} 없음`);
      if (e.holder?.k === 'tote' && !this.items.has(e.holder.tote)) out.push(`#${e.id} 토트 #${e.holder.tote} 없음`);
      if (!key) continue;
      if (seen.has(key)) out.push(`${key}: #${seen.get(key)} · #${e.id}`);
      else seen.set(key, e.id);
    }
    return out;
  }
}
