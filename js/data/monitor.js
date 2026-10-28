// 장비 상태 문서(JSON). 선택한 셀·AMR·순찰 로봇의 상태 · 지금 하는 공정 · 신호 목록을 한 문서로 만든다. DOM·three 없음.
// 값은 전부 이 뷰어 시뮬의 계산값(가정)이다. 실제 셀 PLC 태그·주소나 OCS 수집 규격이 아니다.
// 신호 하나 = { id, group, label, type: bool|int|real|string, value, unit? }. 같은 장비는 시각만 달라도 신호 id 목록이 같다.
export const STATUS_SCHEMA = 'microsim.equipment-status/1';

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const mm = (p) => (p ? p.map((v) => Math.round(v * 1000)) : null);
const deg = (v) => r1((v * 180) / Math.PI);
const int = (v) => (Number.isFinite(v) ? Math.round(v) : null);
const hdg = (a) => r1(((((a * 180) / Math.PI) % 360) + 360) % 360);

export const LIFT_PHASE = Object.freeze({ empty: '빈 리프트', rise: '올림(클립 물기)', work: '작업 중', done: '작업 끝 · 반출 대기', lower: '내림(AMR 안착)' });
const OP_STATE = Object.freeze({ wait: '대기', run: '진행', dwell: '진행', done: '완료' });

class Signals {
  constructor() { this.list = []; this.group = ''; }
  in(group) { this.group = group; return this; }
  add(id, label, type, value, unit) {
    const v = value === undefined ? null : value;
    this.list.push({ id, group: this.group, label, type, value: type === 'bool' ? !!v : v, ...(unit ? { unit } : {}) });
    return this;
  }
}

// 문서를 만들 수 있는 장비 id: 셀 · AMR(두 플릿) · 견마·드론 · 셀 안 장비(로봇·직교이송·리프트)
export function equipmentIds(state) {
  const parts = (state.equip ?? []).map((e) => (typeof e === 'string' ? e : e.id));
  return [...state.cells.map((c) => c.id), ...state.amrs.map((a) => a.id), ...(state.plant?.robots ?? []).map((r) => r.id), ...parts];
}

export function equipmentStatus(state, id) {
  if (!id) return null;
  const cell = state.cell(id);
  const part = !cell && state.equipOf ? state.equipOf(id) : null;
  const body = cell ? cellStatus(state, cell)
    : state.amrs.find((a) => a.id === id) ? amrStatus(state, state.amrs.find((a) => a.id === id))
      : part ? partStatus(state, part)
        : robotStatus(state, state.plant?.robots.find((r) => r.id === id));
  if (!body) return null;
  return { schema: STATUS_SCHEMA, assumed: true, source: 'sim', t: r3(state.time), id, ...body };
}

// ── 셀 ──
function cellStatus(state, c) {
  const P = state.plant, u = P?.units[c.id] ?? null, down = u?.down ?? null;
  const S = new Signals().in('상태')
    .add('STATE', '셀 상태', 'string', c.state)
    .add('RUN', '가동', 'bool', c.state === 'BUSY')
    .add('FAULT', '고장', 'bool', c.state === 'DOWN')
    .add('MODEL', '셀 모델 로드', 'bool', c.loaded);
  const doc = { kind: 'cell', name: c.label, state: c.state, fault: down ? { why: down.why, dur: down.dur } : null, process: null, robots: [], signals: S.list };
  if (!u) return doc;
  const cw = P.work[c.id];
  S.add('DONE', '완료 수', 'int', cw?.done ?? u.done);
  if (cw?.lift) liftCell(P, cw, u, S, doc);
  else if (cw?.rack || P.rack?.cell === c.id) sortCell(P, cw, u, S, doc);
  else {
    S.add('PROGRESS', '사이클 진행률', 'real', r1(u.progress * 100), '%').add('STOCK', '재고', 'int', u.stock);
    doc.process = { label: u.role === 'source' ? '분류 사이클(타이머)' : '작업 사이클(타이머)', progress: r3(u.progress), stock: u.stock, done: u.done };
  }
  health(P, c.id, S);
  return doc;
}

// 리프트 셀(PRESS·SCREW): 방문(pass) 단계 · 리프트 · 투입/반출 핸드셰이크 · 로봇 · 공급 라인 · 구역 잠금
function liftCell(P, cw, u, S, doc) {
  const Lf = cw.lift, f = cw.P.passes[Lf.pass], down = !!u.down;
  const total = cw.passTime[Lf.pass];
  const visits = (P.route ?? []).map((id, i) => ({ i, id })).filter((v) => v.id === cw.id);
  const steps = Lf.kit && f ? f.steps.map((ops, i) => ({
    i,
    ops: ops.map((op, k) => {
      const j = Lf.phase === 'work' && i === Lf.stepI ? Lf.run?.[k] : null;
      const st = Lf.phase === 'done' || i < Lf.stepI ? 'done' : j ? j.state : 'wait';
      const r = cw.robots[op.robot ?? cw.lineOf[op.line]?.robot];
      const el = st === 'done' ? op.time : st === 'dwell' ? j.el : st === 'run' ? Math.min(op.time, r?.op?.el ?? 0) : 0;
      return { ...opText(cw, op), time: op.time, state: st, stateLabel: OP_STATE[st] ?? st, elapsed: r1(el) };
    }),
  })) : [];
  // 표준 시간 기준 진행: 단계 시간 = 그 단계 작업 중 가장 긴 것. 리프트 위 경과(work)는 부품 대기를 포함해 표준보다 길 수 있다.
  const std = steps.reduce((s, st) => s + Math.max(...st.ops.map((o) => Math.min(o.elapsed, o.time))), 0);
  const waiting = Lf.phase === 'work' && steps[Lf.stepI]?.ops.some((o) => o.state === 'wait') ? steps[Lf.stepI].ops.filter((o) => o.state === 'wait').map((o) => o.label) : [];
  doc.process = {
    route: P.route ?? null,
    visit: Lf.kit ? { pass: Lf.pass, of: cw.P.passes.length, route: visits[Lf.pass]?.i ?? null } : null,
    label: Lf.kit ? f?.label ?? null : null,
    phase: Lf.phase, phaseLabel: LIFT_PHASE[Lf.phase] ?? Lf.phase,
    kit: Lf.kit ? `#${Lf.kit.id}` : null,
    progress: Lf.kit && total > 0 ? r3(std / total) : 0,
    standard: r1(total), remaining: Lf.kit ? r1(Math.max(0, total - std)) : null,
    onLift: Lf.phase === 'work' ? r1(Lf.el) : null,
    waiting,
    steps,
    stepIndex: Lf.kit && f ? Math.min(Lf.stepI, f.steps.length) : null,
    passDone: cw.P.passes.map((p, i) => ({ label: p.label, done: cw.passDone[i] })),
  };
  S.in('공정')
    .add('PASS', '방문 공정', 'string', doc.process.label ?? '')
    .add('STEP', '단계', 'int', doc.process.stepIndex)
    .add('PROGRESS', '공정 진행률(표준 시간)', 'real', r1(doc.process.progress * 100), '%')
    .add('REMAIN', '남은 표준 시간', 'real', doc.process.remaining, 's')
    .add('WAIT', '시작 대기 작업', 'int', waiting.length);
  const T = cw.ticket, O = cw.out;
  S.in('핸드셰이크 · 투입')
    .add('IN.READY', '투입 가능', 'bool', cw.canAccept(down))
    .add('IN.RESERVED', '투입 예약 AMR', 'string', cw.reserved ?? '')
    .add('IN.REQ', '투입 요청', 'bool', !!T)
    .add('IN.AMR', '투입 AMR', 'string', T?.from?.id ?? '')
    .add('IN.GRIP', '지그 물림', 'bool', !!T?.gripped)
    .add('IN.REL', 'AMR 출발 허가', 'bool', !!T?.released);
  S.in('핸드셰이크 · 반출')
    .add('OUT.READY', '반출 대기', 'bool', cw.outReady())
    .add('OUT.REQ', '반출 요청', 'bool', !!O)
    .add('OUT.AMR', '반출 AMR', 'string', O?.to?.id ?? '')
    .add('OUT.SEAT', 'AMR 안착', 'bool', !!O?.loaded)
    .add('OUT.REL', 'AMR 출발 허가', 'bool', !!O?.released);
  S.in('리프트')
    .add('LIFT.PHASE', '리프트 단계', 'string', Lf.phase)
    .add('LIFT.Z', '리프트 높이(적재면 위)', 'int', int((Lf.y - cw.P.deck) * 1000), 'mm')
    .add('LIFT.CLAMP', '클립 닫힘', 'real', r1(Lf.clamp * 100), '%')
    .add('LIFT.CLAMPED', '클립 물림 완료', 'bool', Lf.clamp > 0.999)
    .add('LIFT.KIT', '든 키트', 'string', Lf.kit ? `#${Lf.kit.id}` : '');
  S.in('로봇');
  for (const r of Object.values(cw.robots)) S.add(`${r.name}.BUSY`, `${r.name} 작업 중`, 'bool', !!r.op).add(`${r.name}.OP`, `${r.name} 작업`, 'string', r.op ? r.label : '');
  doc.robots = Object.values(cw.robots).map((r) => robotArm(r, !!r.op));
  S.in('공급 라인');
  for (const L of cw.lines) {
    S.add(`${L.id}.PART`, `${L.id} 부품`, 'string', L.part)
      .add(`${L.id}.ROLLER`, `${L.id} 롤러 위`, 'int', L.items.length)
      .add(`${L.id}.STOCK`, `${L.id} 팔레트 남은 수`, 'int', Number.isFinite(L.left) ? L.left : null)
      .add(`${L.id}.GANTRY`, `${L.id} 직교이송 동작`, 'bool', !!L.gantry.op);
  }
  S.in('구역 잠금');
  for (const [q, who] of Object.entries(cw.locks)) S.add(`LOCK.${q.toUpperCase()}`, `구역 ${q}`, 'string', who ?? '');
  S.add('LOCK.FAULT', '잠금 위반', 'int', cw.lockFaults).add('LOCK.INTRUDE', '잠금 없는 진입', 'int', cw.intrude);
}

function opText(cw, op) {
  if (op.do === 'feed') {
    const L = cw.lineOf[op.line];
    return { do: 'feed', robot: L?.robot ?? null, line: op.line, label: `${L?.part ?? op.line} 투입(${op.line}→지그)` };
  }
  return { do: op.do, robot: op.robot ?? null, label: op.label ?? (op.do === 'dwell' ? '대기' : '경로 작업') };
}

// SORT: 양팔 입고(하역)·적재 티켓 · 랙 칸 · 분류(바코드·레인)
function sortCell(P, sw, u, S, doc) {
  const rack = P.rack, op = sw?.op ?? null, T = sw?.ticket ?? null;
  const kind = op?.T?.kind ?? T?.kind ?? null;
  doc.process = {
    label: kind === 'unload' ? '원재료 하역(AMR → 랙)' : kind === 'load' ? '분류 키트 적재(랙 → AMR)' : null,
    progress: op ? r3(op.el / op.time) : 0,
    elapsed: op ? r1(op.el) : null, total: op ? r1(op.time) : null,
    rack: rack ? rack.items.map((e, i) => ({ i, kit: e ? `#${e.id}` : null })) : [],
    kits: P.kits.length, loaded: sw?.done ?? 0, unloaded: sw?.inDone ?? 0,
  };
  S.in('공정')
    .add('JOB', '양팔 작업', 'string', kind ?? '')
    .add('PROGRESS', '작업 진행률', 'real', r1(doc.process.progress * 100), '%')
    .add('RACK.USED', '랙 사용 칸', 'int', rack ? rack.items.filter(Boolean).length : null)
    .add('RACK.CAP', '랙 칸 수', 'int', rack?.items.length ?? null)
    .add('UNLOADED', '하역 수', 'int', sw?.inDone ?? 0);
  S.in('핸드셰이크 · 양팔')
    .add('HS.REQ', '티켓', 'bool', !!T)
    .add('HS.KIND', '티켓 종류', 'string', T?.kind ?? '')
    .add('HS.AMR', '상대 AMR', 'string', (T?.kind === 'unload' ? T.from?.id : T?.to?.id) ?? '')
    .add('HS.GRIP', '양팔 파지', 'bool', !!T?.gripped)
    .add('HS.REL', 'AMR 출발 허가', 'bool', !!T?.released);
  if (sw) {
    S.in('로봇')
      .add('BODY.SLIDE', '대차 위치', 'int', int(sw.car.s * 1000), 'mm')
      .add('BODY.TURN', '몸통 회전', 'real', deg(sw.car.w), 'deg');
    for (const r of sw.robots) S.add(`${r.name}.BUSY`, `${r.name} 작업 중`, 'bool', !!op);
    doc.robots = sw.robots.map((r) => robotArm(r, !!op));
  }
  const F = sw?.feed?.view();
  if (F) {
    S.in('분류')
      .add('FEED.IN', '투입 대기 토트', 'int', F.infeed)
      .add('FEED.BELT', '컨베이어 위', 'int', F.belt)
      .add('FEED.SCAN', '바코드 스캔 누적', 'int', F.scanned)
      .add('FEED.HAND', '레인 → AMR 누적', 'int', F.handed);
    for (const L of F.lanes) S.add(`LANE.${L.id}`, `레인 ${L.id} 위`, 'int', L.items).add(`LANE.${L.id}.WAIT`, `레인 ${L.id} AMR 대기`, 'bool', L.waiting);
  }
}

const ARM_JOINTS = 5;

function partWork(state, part) {
  return state.plant?.work?.[part.cell] ?? null;
}

function partRobot(cw, name) {
  if (!cw?.robots) return null;
  const list = Array.isArray(cw.robots) ? cw.robots : Object.values(cw.robots);
  return list.find((r) => r.name === name) ?? null;
}

function partDown(state, part) {
  return state.cell(part.cell)?.state === 'DOWN';
}

function partHead(state, part, busy, extra) {
  const down = partDown(state, part);
  const st = down ? 'DOWN' : busy ? 'BUSY' : 'IDLE';
  const S = new Signals().in('상태')
    .add('STATE', '장비 상태', 'string', st)
    .add('BUSY', '작업 중', 'bool', busy)
    .add('FAULT', '셀 고장', 'bool', down)
    .add('CELL', '소속 셀', 'string', part.cell);
  return { S, down, state: st, ...extra };
}

// 셀 GLB 안 장비 하나(로봇·직교이송·리프트·몸통). 신호 id 목록은 시각이 바뀌어도 같다.
function partStatus(state, part) {
  const cw = partWork(state, part);
  const name = `${part.cell} ${part.name}`;
  if (part.kind === 'arm') return armPart(state, part, cw, name);
  if (part.kind === 'gantry') return gantryPart(state, part, cw, name);
  if (part.kind === 'lift') return liftPart(state, part, cw, name);
  if (part.kind === 'body') return bodyPart(state, part, cw, name);
  return null;
}

function armPart(state, part, cw, name) {
  const r = partRobot(cw, part.name);
  const busy = !!(r?.op || (Array.isArray(cw?.robots) && cw?.op));
  const { S, down, state: st } = partHead(state, part, busy);
  S.in('작업').add('OP', '작업', 'string', busy ? (r?.label ?? '') : '');
  const tcp = r?.tcp;
  S.in('자세')
    .add('TCP.X', 'TCP X', 'int', tcp ? int(tcp[0] * 1000) : null, 'mm')
    .add('TCP.Y', 'TCP Y', 'int', tcp ? int(tcp[1] * 1000) : null, 'mm')
    .add('TCP.Z', 'TCP Z', 'int', tcp ? int(tcp[2] * 1000) : null, 'mm')
    .add('RAIL', '레일', 'int', r?.pose?.s != null ? int(r.pose.s * 1000) : null, 'mm');
  S.in('관절');
  for (let i = 0; i < ARM_JOINTS; i++) S.add(`J${i + 1}`, `관절 ${i + 1}`, 'real', r?.pose?.q?.[i] != null ? deg(r.pose.q[i]) : null, 'deg');
  return {
    kind: 'arm', name, cell: part.cell, state: st, fault: down ? { why: state.plant?.units[part.cell]?.down?.why ?? '셀 고장' } : null,
    process: { label: busy ? (r?.label ?? null) : null, cell: part.cell },
    robots: r ? [robotArm(r, busy)] : [],
    signals: S.list,
  };
}

function gantryPart(state, part, cw, name) {
  const L = cw?.lines?.find((x) => x.id === part.name) ?? null;
  const busy = !!L?.gantry?.op;
  const { S, down, state: st } = partHead(state, part, busy);
  S.in('작업').add('OP', '작업', 'string', L?.gantry?.op ? '이송' : '').add('PART', '부품', 'string', L?.part ?? '');
  S.in('자세')
    .add('POS.Z', '가로 위치', 'int', L ? int(L.gantry.z * 1000) : null, 'mm')
    .add('POS.Y', '패드 높이', 'int', L ? int(L.gantry.y * 1000) : null, 'mm');
  return {
    kind: 'gantry', name, cell: part.cell, state: st, fault: down ? { why: state.plant?.units[part.cell]?.down?.why ?? '셀 고장' } : null,
    process: { label: L?.part ? `${L.part} 직교이송` : '직교이송', line: part.name, cell: part.cell },
    robots: [],
    signals: S.list,
  };
}

function liftPart(state, part, cw, name) {
  const Lf = cw?.lift;
  const busy = !!(Lf && Lf.phase !== 'empty');
  const { S, down, state: st } = partHead(state, part, busy);
  S.in('리프트')
    .add('PHASE', '단계', 'string', Lf?.phase ?? '')
    .add('Z', '높이(적재면 위)', 'int', Lf && cw?.P ? int((Lf.y - cw.P.deck) * 1000) : null, 'mm')
    .add('CLAMP', '클립 닫힘', 'real', Lf ? r1(Lf.clamp * 100) : null, '%')
    .add('KIT', '든 키트', 'string', Lf?.kit ? `#${Lf.kit.id}` : '');
  return {
    kind: 'lift', name, cell: part.cell, state: st, fault: down ? { why: state.plant?.units[part.cell]?.down?.why ?? '셀 고장' } : null,
    process: { label: LIFT_PHASE[Lf?.phase] ?? Lf?.phase ?? null, phase: Lf?.phase ?? null, cell: part.cell },
    robots: [],
    signals: S.list,
  };
}

function bodyPart(state, part, cw, name) {
  const busy = !!cw?.op;
  const { S, down, state: st } = partHead(state, part, busy);
  S.in('자세')
    .add('SLIDE', '대차 위치', 'int', cw?.car ? int(cw.car.s * 1000) : null, 'mm')
    .add('TURN', '몸통 회전', 'real', cw?.car ? deg(cw.car.w) : null, 'deg');
  return {
    kind: 'body', name, cell: part.cell, state: st, fault: down ? { why: state.plant?.units[part.cell]?.down?.why ?? '셀 고장' } : null,
    process: { label: busy ? (cw?.robots?.[0]?.label ?? '양팔') : null, cell: part.cell },
    robots: [],
    signals: S.list,
  };
}

function robotArm(r, busy) {
  return {
    name: r.name, busy, op: busy ? r.label : null,
    tcp: mm(r.tcp),
    rail: r.pose?.s != null ? int(r.pose.s * 1000) : null,
    joints: r.pose?.q ? r.pose.q.map(deg) : null,
  };
}

function health(P, id, S) {
  const h = P.health?.cells[id];
  if (!h) return;
  S.in('설비 건강(가정)')
    .add('HEALTH', '건강도', 'real', r1(h.health), '%')
    .add('DRIFT', '드리프트', 'real', r1(h.drift * 100), '%')
    .add('SCANS', '점검 횟수', 'int', h.scans)
    .add('LAST_SCAN', '마지막 점검 시각', 'real', r1(h.lastScan), 's');
  const last = P.drones?.results.find((x) => x.kind === 'inspect' && x.cell === id);
  S.add('VISION', '최근 드론 검사', 'string', last ? `#${last.n} ${last.result}` : '');
}

// ── AMR ──
function amrStatus(state, a) {
  const parts = a.id.startsWith('P-');
  const m = a.mission, T = a.ticket;
  const S = new Signals().in('상태')
    .add('MODE', '운행 모드', 'string', a.mode)
    .add('TASK', '작업', 'string', a.task)
    .add('OFF', '운휴', 'bool', a.off);
  S.in('주행')
    .add('POS.X', '위치 X', 'real', r3(a.x), 'm')
    .add('POS.Z', '위치 Z', 'real', r3(a.z), 'm')
    .add('HEADING', '방위', 'real', hdg(a.heading), 'deg')
    .add('SPEED', '속도', 'real', r3(a.v), 'm/s')
    .add('MOVING', '움직임', 'bool', a.moving)
    .add('REVERSE', '후진', 'bool', a.reverse && a.moving)
    .add('DOCKED', '도크 정차', 'bool', a.docked)
    .add('BLOCKED', '진로 대기 상대', 'string', a.blockedOn?.id ?? '')
    .add('ODO', '누적 주행', 'real', r1(a.dist), 'm');
  S.in('배터리')
    .add('BATT', '배터리', 'real', r1(a.battery), '%')
    .add('CHARGING', '충전 중', 'bool', a.charging)
    .add('LOW', '저전압', 'bool', a.battery < 30);
  S.in('핸드셰이크')
    .add('HS.REQ', '셀 티켓', 'bool', !!T)
    .add('HS.REL', '출발 허가', 'bool', !!T?.released)
    .add('LOAD', '적재물', 'string', a.load ? `#${a.load.id}` : '')
    .add('LOCK', '잡은 셀 잠금', 'string', a.inBranch ?? '')
    .add('WAIT', '진입 대기 셀', 'string', a.waitFor ?? '');
  return {
    kind: 'amr', name: parts ? '부속 부품 AMR' : '도어트림 AMR', fleet: parts ? 'parts' : 'trim', state: a.off ? 'OFF' : a.mode.toUpperCase(),
    process: {
      label: a.task,
      mission: m ? { from: m.from ?? null, tag: m.what?.tag ?? null, dest: typeof m.dest === 'string' ? m.dest : a.load?.dest ?? null } : null,
      load: a.load ? { id: `#${a.load.id}`, dest: a.load.dest ?? null } : null,
      at: a.at ? { ...a.at } : null, bound: a.bound ?? null,
      steps: a.steps.length,
    },
    robots: [],
    signals: S.list,
  };
}

// ── 견마·드론 ──
const ROLE = Object.freeze({ recover: '견마 · 이상 리커버리', inspect: '견마 · 설비 점검', process: '드론 · 공정 검사', stock: '드론 · 재고 실사' });
const STAT = Object.freeze({ inspected: '검사 누적', ng: '재검 판정', relays: '고장 중계', counts: '실사 누적', mismatch: '실사 불일치', flight: '비행 시간' });

function robotStatus(state, r) {
  if (!r) return null;
  const S = new Signals().in('상태')
    .add('MODE', '모드', 'string', r.mode)
    .add('TASK', '작업', 'string', r.task);
  S.in('주행')
    .add('POS.X', '위치 X', 'real', r3(r.x), 'm')
    .add('POS.Z', '위치 Z', 'real', r3(r.z), 'm');
  if (r.y != null) S.add('ALT', '고도', 'real', r3(r.y), 'm');
  if (r.heading != null) S.add('HEADING', '방위', 'real', hdg(r.heading), 'deg');
  if (r.v != null) S.add('SPEED', '속도', 'real', r3(r.v), 'm/s');
  if (r.battery != null) S.in('배터리').add('BATT', '배터리', 'real', r1(r.battery), '%');
  S.in('임무');
  if (r.role === 'recover') S.add('SEEN', '이상 감지 누적', 'int', r.seen).add('FIXED', '해소 누적', 'int', r.fixed);
  if (r.role === 'inspect') S.add('SCAN', '스캔 대상', 'string', r.scanning ?? '').add('SCANS', '스캔 누적', 'int', r.scans);
  if (r.stats) for (const [k, v] of Object.entries(r.stats)) S.add(`STAT.${k.toUpperCase()}`, STAT[k] ?? k, k === 'flight' ? 'real' : 'int', k === 'flight' ? r1(v) : v, k === 'flight' ? 's' : undefined);
  if (r.role === 'process' || r.role === 'stock') S.add('SCAN', '검사 중', 'string', r.scanning ?? '').add('FLYING', '비행 중', 'bool', r.flying);
  return {
    kind: r.role === 'process' || r.role === 'stock' ? 'drone' : 'hound', name: ROLE[r.role] ?? r.role, state: String(r.mode).toUpperCase(),
    process: { label: r.task, job: r.job ? { ...r.job } : null },
    robots: [],
    signals: S.list,
  };
}
