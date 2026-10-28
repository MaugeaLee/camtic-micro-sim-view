// 키트 하나 공정 추적 문서. DOM·three 없음. 시뮬을 바꾸지 않고 매 스텝 읽기만 한다.
// 값은 이 뷰어 시뮬의 가정 공정이다. 현장 실측·OCS 수집·품질 RCA(F7)가 아니다.
export const TRACE_SCHEMA = 'microsim.process-trace/1';

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

const KIT = (e) => e?.type === 'kit';

export function expectedPath(route) {
  const seen = {};
  return (route ?? []).map((id) => {
    if (id === 'OUT' || id === route[0]) return id;
    const n = seen[id] ?? 0;
    seen[id] = n + 1;
    return `${id}/${n}`;
  });
}

export function kitsOf(state) {
  return (state.plant?.parts.list() ?? []).filter(KIT);
}

// 이미 분류 이후(메인 AMR·리프트·적재)면 처음부터가 아니다.
export function pastStart(state, e) {
  const P = state.plant;
  if (!e || !P) return true;
  if (P.inFlow.has(e) || (e.step ?? 0) > 0) return true;
  const k = e.holder?.k;
  return k === 'lift' || k === 'outg' || k === 'outslot' || k === 'slot'
    || (k === 'rack' && P.kits.some((x) => x.e === e))
    || (k === 'amr' && P.inFlow.has(e));
}

const EQ = (kind, id, label) => ({ kind, id, label: label ?? id });

function inboundAmr(P, e) {
  return P.allAmrs.find((x) => x.load?.e === e || (P.inM?.e === e && x.mission === P.inM)) ?? null;
}

export function stageOf(state, e) {
  if (!e) return null;
  const P = state.plant, H = e.holder;
  if (!P || !H) return null;
  if (H.k === 'store' || H.k === 'drop') {
    const a = inboundAmr(P, e);
    return { key: 'store', label: '원재료 창고', visit: null, equip: a ? EQ('amr', a.id, a.id) : EQ('amr', 'AMR', '입고 AMR') };
  }
  if (H.k === 'move') return null;
  if (H.k === 'rack') return { key: 'sort-rack', label: 'SORT 대기', visit: P.route?.[0] ?? 'SORT', equip: EQ('cell', 'SORT', 'SORT 양팔') };
  if (H.k === 'pair') {
    const unload = P.work[H.cell ?? P.def?.source]?.ticket?.kind === 'unload' || (!P.inFlow.has(e) && !P.kits.some((x) => x.e === e));
    return unload
      ? { key: 'sort-in', label: 'SORT 입고', visit: P.route?.[0] ?? 'SORT', equip: EQ('cell', 'SORT', 'SORT 양팔') }
      : { key: 'sort-load', label: 'SORT 출고', visit: P.route?.[0] ?? 'SORT', equip: EQ('cell', 'SORT', 'SORT 양팔') };
  }
  if (H.k === 'lift') {
    const cw = P.work[H.cell];
    const pass = cw?.ticket?.kit === e && cw.ticket.pass != null ? cw.ticket.pass : (cw?.lift.pass ?? 0);
    const phase = cw?.lift.phase;
    const extra = phase === 'rise' ? ' 올림' : phase === 'lower' ? ' 내림' : phase === 'done' ? ' 반출 대기' : '';
    const label = H.cell === 'SCREW' ? (pass === 0 ? 'SCREW 1차 체결' : 'SCREW 2차 체결') : H.cell === 'PRESS' ? 'PRESS 압입' : `${H.cell} ${pass + 1}차`;
    return { key: `${H.cell}/${pass}`, label: `${label}${extra}`, visit: `${H.cell}/${pass}`, equip: EQ('cell', H.cell, H.cell) };
  }
  if (H.k === 'outg') return { key: 'out-pick', label: '완료품 하역', visit: 'OUT', equip: EQ('site', 'OUT', '적재 협동로봇') };
  if (H.k === 'outslot') return { key: 'OUT', label: '완료품 책장', visit: 'OUT', equip: EQ('site', 'OUT', '완료품 적재') };
  if (H.k === 'amr') {
    const a = P.allAmrs.find((x) => x.id === H.id);
    const dest = a?.load?.dest ?? null;
    const inbound = P.inM?.e === e || (!P.inFlow.has(e) && !P.kits.some((x) => x.e === e));
    const eq = EQ('amr', H.id, inbound ? `입고 ${H.id}` : H.id);
    if (inbound) return { key: 'inbound', label: dest ? `입고 → ${dest}` : '입고 운반', visit: null, equip: eq };
    return { key: dest ? `to-${dest}` : 'amr-wait', label: dest ? `${dest}로 이송` : '이송 대기', visit: null, equip: eq };
  }
  return { key: H.k, label: H.k, visit: null, equip: null };
}

const BLURB = Object.freeze({
  depart: '창고로 이동',
  store: '선반에서 지그 대기',
  inbound: 'SORT로 운반',
  'sort-in': '양팔이 랙에 올림',
  'sort-rack': '랙에서 분류 대기',
  'sort-load': '양팔이 메인 AMR에 적재',
  'to-SCREW': '메인 AMR 이동',
  'to-PRESS': '메인 AMR 이동',
  'to-OUT': '적재 구역으로',
  'amr-wait': '다음 칸 대기',
  'SCREW/0': '벨트라인·스피커 그릴',
  'PRESS/0': '손잡이·베젤·클립 압입',
  'SCREW/1': '인서트·포켓·토크 검사',
  'out-pick': '협동로봇이 도어트림 집기',
  OUT: '책장에 세움',
});

// 화면 중앙 상단 배너용. 공정 이름 + 한 줄. DOM 없음.
export function headlineOf(stage, mode) {
  if (mode === 'wait') return { title: '공정 추적', detail: '다음 입고 대기' };
  if (!stage) return null;
  const phase = String(stage.label ?? '').match(/ (올림|내림|반출 대기)$/)?.[1] ?? null;
  const title = phase ? stage.label.slice(0, -(phase.length + 1)) : stage.label;
  const key = stage.key ?? '';
  const detail = phase
    ?? BLURB[key]
    ?? (key.startsWith('to-') ? '메인 AMR 이동' : key.startsWith('inbound') ? 'SORT로 운반' : '');
  return { title, detail };
}

function holderText(h) {
  if (!h) return '';
  switch (h.k) {
    case 'amr': return h.id;
    case 'lift': return `리프트 ${h.cell}`;
    case 'rack': return `${h.cell} 랙 #${h.i}`;
    case 'pair': return `${h.cell} 양팔`;
    case 'store': return `창고 #${h.i}`;
    case 'outg': return '적재 협동로봇';
    case 'outslot': return `책장 #${h.i}`;
    case 'move': return '옮김';
    default: return h.k;
  }
}

function waiting(state, e) {
  const H = e.holder, P = state.plant;
  if (H.k === 'store' || H.k === 'rack' || H.k === 'drop') return true;
  if (H.k === 'lift') return P.work[H.cell]?.lift.phase === 'done';
  if (H.k === 'amr') {
    const a = P.allAmrs.find((x) => x.id === H.id);
    return !!a && !a.moving && !a.charging;
  }
  return false;
}

function atCell(e) {
  const H = e.holder;
  if (H.k === 'lift' || H.k === 'rack' || H.k === 'pair') return H.cell;
  return null;
}

export class ProcessTrace {
  constructor() { this.clear(); }

  clear() {
    this.mode = 'off';
    this.kit = null;
    this.no = null;
    this.t0 = null;
    this.t1 = null;
    this.lastT = 0;
    this.wait = 0;
    this.visits = [];
    this.stages = [];
    this.faults = [];
    this.expected = [];
    this.route = [];
    this.report = null;
    this.why = null;
  }

  start(state) {
    this.clear();
    if (!state.plant?.route) {
      this.mode = 'off';
      this.why = '공정 순서 없음';
      return this.view(state);
    }
    this.mode = 'wait';
    this.route = [...state.plant.route];
    this.expected = expectedPath(this.route);
    this.lastT = state.time;
    return this.view(state);
  }

  stop() {
    this.clear();
    return this.view(null);
  }

  tick(state) {
    if (this.mode === 'off' || this.mode === 'done') return this.view(state);
    const P = state.plant;
    if (!P?.route) { this.mode = 'off'; this.why = '공정 순서 없음'; return this.view(state); }
    if (this.mode === 'wait') this.latch(state);
    if (this.mode === 'run') this.sample(state);
    return this.view(state);
  }

  latch(state) {
    const P = state.plant, m = P.inM;
    if (!m) return;
    const a = P.allAmrs.find((x) => x.mission === m);
    if (!a) return;
    if (m.e && pastStart(state, m.e)) return;
    this.begin(state, m.e ?? null, a.id);
  }

  begin(state, e, amrId) {
    this.mode = 'run';
    this.kit = e?.id ?? null;
    this.no = e?.no ?? null;
    this.t0 = r3(state.time);
    this.lastT = state.time;
    const stub = { holder: { k: 'amr', id: amrId } };
    this.push(state, e ?? stub, { key: 'depart', label: '입고 AMR 출발', visit: null, equip: EQ('amr', amrId, amrId) });
  }

  push(state, e, st) {
    if (!st) return;
    const t = r3(state.time);
    const prev = this.stages.at(-1);
    if (prev) {
      prev.dur = r1(state.time - prev._t0);
      prev.wait = r1(prev._wait);
      delete prev._t0;
      delete prev._wait;
    }
    this.stages.push({
      key: st.key, label: st.label, t, dur: 0, wait: 0,
      holder: holderText(e.holder),
      equip: st.equip ? { ...st.equip } : null,
      _t0: state.time, _wait: 0,
    });
    if (st.visit && this.visits.at(-1) !== st.visit) this.visits.push(st.visit);
  }

  sample(state) {
    const P = state.plant;
    if (this.kit == null && P.inM?.e) this.kit = P.inM.e.id;
    const e = this.kit != null ? P.parts.get(this.kit) : null;
    const dt = Math.max(0, state.time - this.lastT);
    this.lastT = state.time;
    this.no = e?.no ?? this.no;
    if (!e) {
      if (this.visits.includes('OUT')) { this.finish(state, true); return; }
      if (this.kit == null) return;
      this.finish(state, false, '키트가 사라짐');
      return;
    }
    const st = stageOf(state, e);
    if (st && this.stages.at(-1)?.key !== st.key) this.push(state, e, st);
    else if (st && this.stages.at(-1) && this.stages.at(-1).label !== st.label) this.stages.at(-1).label = st.label;
    if (this.stages.at(-1) && waiting(state, e)) this.stages.at(-1)._wait += dt;
    if (waiting(state, e)) this.wait += dt;
    const cell = atCell(e), u = cell ? P.units[cell] : null;
    if (u?.down && this.faults.at(-1)?.cell !== cell) {
      this.faults.push({ t: r3(state.time), cell, why: u.down.why ?? '고장' });
    }
    if (e.holder.k === 'outslot') this.finish(state, true);
  }

  finish(state, ok, why = null) {
    const last = this.stages.at(-1);
    if (last) {
      last.dur = r1(state.time - last._t0);
      last.wait = r1(last._wait);
      delete last._t0;
      delete last._wait;
    }
    this.t1 = r3(state.time);
    this.mode = 'done';
    this.why = why;
    const pathOk = ok && this.expected.every((k, i) => this.visits[i] === k) && this.visits.length === this.expected.length;
    this.report = this.doc(state, pathOk);
  }

  pose(state) {
    const e = this.kit != null ? state.plant?.parts.get(this.kit) : null;
    return e ? state.plant.poseOf(e) : null;
  }

  // 지금 공정 단위의 핵심 장비. 카메라는 도어트림이 아니라 여기를 본다.
  focus(state) {
    if (this.mode !== 'run' && this.mode !== 'done') return null;
    const last = this.stages.at(-1)?.equip;
    if (last) return last;
    const e = this.kit != null ? state.plant?.parts.get(this.kit) : null;
    return e ? stageOf(state, e)?.equip ?? null : null;
  }

  doc(state, ok) {
    const elapsed = this.t0 != null && this.t1 != null ? r1(this.t1 - this.t0) : this.t0 != null && state ? r1(state.time - this.t0) : null;
    return {
      schema: TRACE_SCHEMA,
      assumed: true,
      source: 'sim',
      mode: this.mode,
      kit: this.kit,
      no: this.no,
      t: r3(state?.time ?? this.t1 ?? 0),
      t0: this.t0,
      t1: this.t1,
      elapsed,
      wait: r1(this.wait),
      route: this.route,
      expected: this.expected,
      visits: [...this.visits],
      ok: this.mode === 'done' ? ok : null,
      why: this.why,
      faults: this.faults.map((f) => ({ ...f })),
      stages: this.stages.map(({ key, label, t, dur, wait, holder, equip }) => ({ key, label, t, dur, wait, holder, equip })),
      focus: this.focus(state),
      banner: headlineOf(this.stages.at(-1) ?? null, this.mode),
    };
  }

  view(state) {
    if (this.mode === 'off') return { schema: TRACE_SCHEMA, assumed: true, source: 'sim', mode: 'off', why: this.why, kit: null, stages: [] };
    if (this.mode === 'done' && this.report) return this.report;
    return this.doc(state, null);
  }
}
