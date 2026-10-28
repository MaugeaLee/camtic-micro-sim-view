// 운영자 주입: 설비 고장 · 자재 공급 차질 · 현장 이벤트 · AMR 플릿 속도/정지. DOM·three 없음.
// micro-assembly 하단 패널(설비 고장 주입·자재 공급 차질·현장 이벤트·AMR·AGV)을 이 시뮬 규모로 줄인 것이다. 사유·시간·배율은 가정값.
// 기록 한 건 = { no, kind, type, target, at, end, why, mode?, value? }. at·end 는 시뮬 시각(end null = 해제 전까지).
// 시각으로만 켜고 끄므로 공장 상태 복원(같은 스텝 재생)에서도 같은 시각에 같은 일이 난다 — 목록을 dump 에 같이 둔다.

export const FLEETS = Object.freeze(['trim', 'parts']);
export const FLEET_LABEL = Object.freeze({ trim: '메인 AMR(도어트림)', parts: '서브 AMR(부품)' });
export const FLEET_SPEEDS = Object.freeze([0.5, 0.75, 1, 1.25]);
export const DURATIONS = Object.freeze({ fault: [30, 60, 120, 300], supply: [120, 300, 900, 1800], event: [30, 60, 120, 300] });
export const SLOW = 3;            // 공급 지연: 재보충·적재 시간 배율
export const FLOOR_SCALE = 0.5;   // 바닥 이상: AMR 감속 배율
const MAX_DUR = 4 * 3600;
const CAP = 200;

// 고장 사유(가정). 대상 종류별.
export const FAULT_WHY = Object.freeze({
  cell: ['설비 이상 정지(가정)', '비전 검사 오류(가정)', '안전 펜스 개방(가정)', '공압 저하(가정)'],
  arm: ['로봇 충돌 감지(가정)', '그리퍼 파지 실패(가정)', '관절 과부하(가정)'],
  gantry: ['직교이송 원점 이탈(가정)', '벨트 장력 이상(가정)'],
  lift: ['리프트 클립 미체결(가정)', '승강 센서 이상(가정)'],
  body: ['대차 주행 이상(가정)', '몸통 회전 이상(가정)'],
  amr: ['구동 모터 이상(가정)', '라이다 오염(가정)', '배터리 셀 경고(가정)', '바퀴 슬립(가정)'],
});

export const SUPPLY = Object.freeze({
  raw: { label: '원재료 입고', note: '원재료 창고 선반 재보충' },
  parts: { label: '부품 창고 출고', note: '부품 창고 토트 출고' },
});
export const SUPPLY_MODE = Object.freeze({ stop: '중단', slow: `지연 ×${SLOW}` });

export const EVENTS = Object.freeze({
  worker: { label: '작업자 진입', cell: true, why: '작업자 셀 진입 — 안전 정지(가정)' },
  aisle: { label: '통로 통제', cell: false, why: 'AMR 통로 통제 — 플릿 정지(가정)' },
  floor: { label: '바닥 이상', cell: false, why: `바닥 이물·미끄럼 — AMR ${FLOOR_SCALE * 100}% 감속(가정)` },
});

const cellOf = (target) => String(target).split(':')[0];
const fleetOf = (id) => (String(id).startsWith('P-AMR') ? 'parts' : 'trim');
const EPS = 1e-6;
// 시뮬 스텝이 보는 구간: 기록한 시각 다음 스텝부터 끝 시각 스텝까지. 실시간 주입과 복원 재생이 같은 스텝에서 켜고 끄게 한다.
const on = (x, t) => x.at < t - EPS && (x.end == null || t < x.end + EPS);
// 운영자가 보는 지금 설정: 기록했고 아직 안 끝남(일시정지 중 막 넣어 아직 스텝을 안 탄 것 포함).
const set = (x, t) => x.at <= t + EPS && (x.end == null || t < x.end - EPS);

export class Incidents {
  constructor() {
    this.list = [];
    this.seq = 0;
    this.live = new Set();   // 지금 켜져 있다고 기록한 것(시작·끝 로그용)
  }

  // spec: { kind, type?, target?, dur?, why?, mode?, value? }. 대상 존재 점검은 호출 쪽(ViewerState.inject)이 한다.
  add(spec, t) {
    const errs = specErrors(spec);
    if (errs.length) throw new Error(errs.join(' · '));
    const dur = spec.dur == null ? null : Number(spec.dur);
    const x = {
      no: ++this.seq, kind: spec.kind, type: spec.type ?? null, target: spec.target ?? null,
      at: Number(t.toFixed(3)), end: dur == null ? null : Number((t + dur).toFixed(3)),
      why: spec.why ?? defaultWhy(spec),
    };
    if (spec.mode != null) x.mode = spec.mode;
    if (spec.value != null) x.value = spec.value;
    // 플릿 설정(속도·정지)은 같은 플릿의 앞 설정을 지금 시각에 끝낸다.
    if (x.kind === 'fleet') for (const y of this.list) if (y.kind === 'fleet' && y.type === x.type && y.target === x.target && set(y, t)) y.end = x.at;
    this.list.push(x);
    if (this.list.length > CAP) this.list = this.list.filter((y) => set(y, t) || y.at > t).slice(-CAP);
    return x;
  }

  // 지금 시각에 끝냄(복구·해제). 이미 끝났으면 false.
  clear(no, t) {
    const x = this.list.find((y) => y.no === no);
    if (!x || !set(x, t)) return false;
    x.end = Number(Math.max(x.at, t).toFixed(3));
    return true;
  }

  // 지금 설정된 것(화면 목록·해제 버튼)
  active(t) { return this.list.filter((x) => set(x, t)); }

  // 셀 정지 사유: 셀·셀 장비 고장, 작업자 진입. 가장 먼저 시작한 것.
  cellStop(id, t) {
    return this.list.find((x) => on(x, t) && ((x.kind === 'fault' && cellOf(x.target) === id) || (x.kind === 'event' && x.type === 'worker' && x.target === id))) ?? null;
  }

  // AMR 정지 사유: 그 차 고장 · 통로 통제 · 플릿 정지.
  amrStop(id, t) {
    const F = fleetOf(id);
    return this.list.find((x) => on(x, t) && (
      (x.kind === 'fault' && x.target === id)
      || (x.kind === 'event' && x.type === 'aisle')
      || (x.kind === 'fleet' && x.type === 'halt' && x.target === F))) ?? null;
  }

  // 운영자 설정(화면): 속도 배율 · 정지 여부
  fleetSpeed(F, t, test = set) {
    const s = this.list.findLast((x) => test(x, t) && x.kind === 'fleet' && x.type === 'speed' && x.target === F);
    return s?.value ?? 1;
  }

  fleetHalted(F, t) { return this.list.some((x) => set(x, t) && x.kind === 'fleet' && x.type === 'halt' && x.target === F); }

  // 시뮬이 쓰는 플릿 속도 배율 = 운영자 설정 × 바닥 이상 감속
  fleetScale(F, t) {
    const floor = this.list.some((x) => on(x, t) && x.kind === 'event' && x.type === 'floor');
    return this.fleetSpeed(F, t, on) * (floor ? FLOOR_SCALE : 1);
  }

  // 공급 차질: { mode: 'stop'|'slow' } 또는 null. 중단이 지연보다 앞선다.
  supply(target, t) {
    const xs = this.list.filter((x) => on(x, t) && x.kind === 'supply' && x.target === target);
    return xs.find((x) => x.mode === 'stop') ?? xs[0] ?? null;
  }

  // 켜짐·꺼짐이 바뀐 것: [{ x, on }]. 매 스텝 부른다(플릿 설정은 로그 없이 넘긴다 — 호출 쪽이 남김).
  changes(t) {
    const out = [];
    for (const x of this.list) {
      const now = on(x, t), was = this.live.has(x.no);
      if (now && !was) { this.live.add(x.no); out.push({ x, on: true }); }
      else if (!now && was) { this.live.delete(x.no); out.push({ x, on: false }); }
    }
    return out;
  }

  dump() { return this.list.map((x) => ({ ...x })); }

  // 저장본을 그대로 다시 둔다(시각 0 부터 재생하기 전에). 잘못된 줄은 버린다.
  load(list) {
    this.list = [];
    this.live.clear();
    for (const x of Array.isArray(list) ? list : []) {
      if (!x || !Number.isFinite(x.at) || !(x.end == null || Number.isFinite(x.end)) || specErrors({ ...x, dur: null }).length) continue;
      this.list.push({ ...x });
    }
    this.seq = this.list.reduce((m, x) => Math.max(m, x.no ?? 0), 0);
    return this.list.length;
  }

  view(t) {
    return this.active(t).map((x) => ({ ...x, left: x.end == null ? null : Math.max(0, Number((x.end - t).toFixed(1))) }));
  }
}

export function specErrors(s) {
  const e = [];
  if (!s || typeof s !== 'object') return ['주입 내용이 객체 아님'];
  if (s.dur != null && !(Number(s.dur) > 0 && Number(s.dur) <= MAX_DUR)) e.push(`시간은 0 초과 ${MAX_DUR} s 이하`);
  switch (s.kind) {
    case 'fault': if (!s.target) e.push('고장 대상 없음'); break;
    case 'supply':
      if (!SUPPLY[s.target]) e.push(`공급 대상은 ${Object.keys(SUPPLY).join('·')}`);
      if (!SUPPLY_MODE[s.mode]) e.push(`공급 차질 방식은 ${Object.keys(SUPPLY_MODE).join('·')}`);
      break;
    case 'event':
      if (!EVENTS[s.type]) e.push(`현장 이벤트는 ${Object.keys(EVENTS).join('·')}`);
      else if (EVENTS[s.type].cell && !s.target) e.push('작업자 진입은 셀 지정');
      break;
    case 'fleet':
      if (!FLEETS.includes(s.target)) e.push(`플릿은 ${FLEETS.join('·')}`);
      if (s.type === 'speed' && !FLEET_SPEEDS.includes(s.value)) e.push(`플릿 속도는 ${FLEET_SPEEDS.join('·')}`);
      if (s.type !== 'speed' && s.type !== 'halt') e.push('플릿 설정은 speed·halt');
      break;
    default: e.push('kind 는 fault·supply·event·fleet');
  }
  return e;
}

function defaultWhy(s) {
  if (s.kind === 'event') return EVENTS[s.type].why;
  if (s.kind === 'supply') return `${SUPPLY[s.target].label} ${SUPPLY_MODE[s.mode]}(가정)`;
  if (s.kind === 'fleet') return s.type === 'halt' ? `${FLEET_LABEL[s.target]} 운영자 정지` : `${FLEET_LABEL[s.target]} 속도 ×${s.value}`;
  return '설비 이상(가정)';
}

// 로그 제목
export function titleOf(x) {
  if (x.kind === 'fault') return `${x.target} 고장 주입`;
  if (x.kind === 'supply') return `${SUPPLY[x.target].label} ${SUPPLY_MODE[x.mode]}`;
  if (x.kind === 'event') return `현장 이벤트: ${EVENTS[x.type].label}${x.target ? ` ${x.target}` : ''}`;
  return x.type === 'halt' ? `${FLEET_LABEL[x.target]} 정지` : `${FLEET_LABEL[x.target]} 속도 ×${x.value}`;
}
