// AMR 정의 데이터(레이아웃 JSON 의 amr 항목): 메인 루트 그래프 · 충전 자리 · 셀별 진입/정차/출구. DOM·three 없음.
// 루트·충전 자리는 필드 좌표, 셀 지점은 셀 로컬 좌표(GLB 셀 프레임: 바닥 y=0, xz 중심 0)라 셀을 옮기면 같이 간다.
// 기본 셀 지점은 셀 GLB 안 AMR 그룹·AMR_route 위치에서 뽑았다(tests/glb.mjs 가 대조). 루트·충전 자리는 가정이다.

export const AMR_HOMES_MAX = 10;
const R = (v) => Math.round(v * 100) / 100;

// 셀 로컬. stops 는 진입 순서이고 마지막이 도크다. exit 가 없으면 막다른 셀 — 도크에서 후진으로 나온다.
// PRESS·SCREW = 리프트 통과 칸: 서쪽에서 들어와 AMR_MAIN_JIG 자리(작업대 리프트 밑)에 서고, 지그를 들어 올리면(또는 내려 받으면)
// 동쪽으로 직진해 빠진다. 정차 칸 x 는 GLB AMR_MAIN_JIG 차체(MobileBase) 가운데(tests/glb.mjs 가 대조).
const BAY = Object.freeze({ entry: { x: -4.6, z: 0 }, stops: [{ x: -1.83, z: 0 }], exit: null });
export const LIFT_X = 0.32;
const LIFT_BAY = Object.freeze({ entry: { x: -4.6, z: 0 }, stops: [{ x: LIFT_X, z: 0 }], exit: { x: 4.6, z: 0 } });
export const LIFT_CELLS = Object.freeze(['PRESS', 'SCREW']);
// 도어트림 원재료 입고: SORT 랙 남쪽(양팔 앞의 반대편). 북쪽 AMR_dual_pickup 은 분류 키트 적재만.
// 원재료 창고(STORE, 부품 창고 동쪽) → SORT:RAW 는 지개차 AMR 이 나른다(부품 AMR 은 토트만). 두 도크는 지개차 루트에 있다.
export const RAW_IN = 'SORT:RAW';
export const STORE = 'STORE';
export const DEFAULT_AMR = Object.freeze({
  route: {
    nodes: [
      { id: 'A0', x: -22.6, z: 12.2 }, { id: 'A1', x: -2.9, z: 12.2 }, { id: 'A2', x: 11, z: 12.2 }, { id: 'A3', x: 25.8, z: 12.2 },
      { id: 'A4', x: -30, z: 12.2 },
      { id: 'G0', x: -22.6, z: -0.6 }, { id: 'G1', x: -2.9, z: -2 }, { id: 'G2', x: 11, z: -2 }, { id: 'G3', x: 25.8, z: -2 },
      { id: 'G4', x: -30, z: 3 },
    ],
    edges: [
      { a: 'A0', b: 'A1' }, { a: 'A1', b: 'A2' }, { a: 'A2', b: 'A3' }, { a: 'A0', b: 'A4' },
      { a: 'A0', b: 'G0', oneway: true }, { a: 'A1', b: 'G1' }, { a: 'A2', b: 'G2' }, { a: 'A3', b: 'G3' }, { a: 'A4', b: 'G4' },
    ],
  },
  // 충전 자리 6: 북쪽 통로 한 줄(흩어진 두 덩어리 없음). 도어트림 루트는 남쪽 창고 통로에 없어서 여기 둔다.
  homes: [
    { x: 7.6, z: 9.6 }, { x: 6.2, z: 9.6 }, { x: 4.8, z: 9.6 }, { x: 3.4, z: 9.6 }, { x: 2.0, z: 9.6 }, { x: 0.6, z: 9.6 },
  ],
  cells: {
    PRESS: LIFT_BAY,
    SCREW: LIFT_BAY,
    // AMR_waiting_2 · AMR_waiting_3 · 분류 레인 A–D 내림 자리 · AMR_dual_pickup. 서쪽으로 들어와 동쪽으로 빠진다(한 줄 통과형).
    // 레인 자리는 두 플릿이 같이 쓰는 칸이다 — 도어트림 AMR 은 지나가고, 부속 부품 AMR 은 그 레인에서 선다.
    SORT: {
      entry: { x: -7.0, z: 1.65 },
      stops: [{ x: -5.94, z: 1.65 }, { x: -4.34, z: 1.65 }, { x: -1.84, z: 1.65 }, { x: -0.14, z: 1.65 }, { x: 1.56, z: 1.65 }, { x: 3.26, z: 1.65 }, { x: 6.36, z: 1.65 }],
      exit: { x: 8.0, z: 1.65 },
    },
    // 완료품 적재 구역(가정, 절차 형상, PRESS 절반 발자국). 북쪽 통로 A4–G4 지선에서 들어와 협동로봇 앞 도크에 서고 후진 출차.
    // 지선이 출차 길이라 대기는 북쪽 통로 쪽(acs.js SPUR_HOLD).
    OUT: { entry: { x: 0, z: 2.2 }, stops: [{ x: 0, z: 0.3 }], exit: null },
  },
});

// 부속 부품 AMR(도어트림 AMR 과 따로): 자기 루트 그래프·충전 자리·도크. 지점 id 는 부품 창고 PARTS 와 「셀:라인」 적재 팔레트 도크.
// 셀 남쪽 라인(L01·L02)은 남쪽 통로에서, 북쪽 라인(L03·L04)은 북쪽 통로에서 셀 쪽으로 들어가 서고 후진으로 나온다(막다른 칸).
// 남·북 통로는 SCREW 더 동쪽 통로(x 29)로 잇는다 — 도어트림 반출 지선 A3–G3(x 25.8)와 차로가 겹치지 않게.
// 도어트림 루트와 만나는 곳은 북쪽 통로 × x 11 지선, 북쪽 통로 × A3–G3, SORT 서·동 접속(교차로, 두 플릿이 같이 잡는 구역).
// 북쪽 통로 z 5.4: 교차로 구역과 OUT 입구 접속 구역(z 9)이 차선 위에서 겹치지 않는 거리(3.6 m). 겹치면 마주 오는 두 차가 하나씩 잡고 서로 기다린다.
// 셀 로컬 x 는 공정 정의 라인 x(PRESS L02·L04 0.32, SCREW 2.52)와 같아야 한다(tests 가 대조). 모두 가정이다.
const LINE_X = { PRESS: { L01: -1.88, L02: 0.32, L03: -1.88, L04: 0.32 }, SCREW: { L01: -1.88, L02: 2.52, L03: -1.88, L04: 2.52 } };
const lineDock = (x, north) => (north
  ? { entry: { x, z: 6.9 }, stops: [{ x, z: 6.0 }], exit: null }
  : { entry: { x, z: -7.4 }, stops: [{ x, z: -6.25 }], exit: null });
// SORT 쪽: 남쪽 통로를 서쪽 끝(x −22.6)까지 늘리고 거기서 북쪽 지선(양방향)으로 SORT 투입 자리(SORT:IN, 막다른 칸)와
// SORT 레인 입구에 붙는다. SORT 레인 출구(동쪽)로 나온 차는 SORT·PRESS 사이 남행 일방 지선(x −2.9)으로 남쪽 통로에 돌아온다.
// 두 지선 끝은 도어트림 지선 끝(서 x −22.6 z −0.6 · 동 x −2.9 z −2)과 겹치는 구역이라 두 ACS 가 같은 구역을 잡는다(acs.js shareCross).
// SORT 레인(cells.SORT)은 도어트림 루트의 것을 그대로 쓴다(layout.js partsLayout) — 두 플릿이 같은 칸·같은 잠금을 쓴다.
export const DEFAULT_PARTS_AMR = Object.freeze({
  route: {
    nodes: [
      { id: 'Q0', x: 0.6, z: -10.6 }, { id: 'Q1', x: 29, z: -10.6 }, { id: 'Q2', x: 29, z: 5.4 }, { id: 'Q3', x: 0.6, z: 5.4 },
      { id: 'W0', x: -22.6, z: -10.6 }, { id: 'W1', x: -22.6, z: -2.6 }, { id: 'W2', x: -2.9, z: -10.6 }, { id: 'W3', x: -2.9, z: -3.6 },
    ],
    edges: [
      { a: 'Q0', b: 'Q1' }, { a: 'Q1', b: 'Q2' }, { a: 'Q2', b: 'Q3' },
      { a: 'W2', b: 'Q0' }, { a: 'W0', b: 'W2' }, { a: 'W0', b: 'W1' }, { a: 'W3', b: 'W2', oneway: true },
    ],
  },
  // 충전 자리 6: 창고 줄(부품 PARTS · 원재료 STORE) 좌우, 남쪽 통로 옆. 서 2 · 동 4. 창고 도크(x 10 · 14.5) 앞은 비운다.
  // 서쪽을 x 3.0 으로 늘리면 PRESS 남쪽 도크와 맞물려 교착이 나서, 늘린 3칸은 STORE 동쪽에 둔다.
  homes: [
    { x: 4.4, z: -13.4 }, { x: 5.8, z: -13.4 },
    { x: 22.4, z: -13.4 }, { x: 23.8, z: -13.4 }, { x: 25.2, z: -13.4 }, { x: 26.6, z: -13.4 },
  ],
  cells: {
    PARTS: { entry: { x: 0, z: 2.1 }, stops: [{ x: 0, z: 1.3 }], exit: null },
    // SORT 투입 자리(AMR_infeed): 서쪽에서 들어와 서고 후진으로 나온다. 투입 이송기가 적재면 토트를 컨베이어로 옮긴다.
    'SORT:IN': { entry: { x: -7.6, z: -1.81 }, stops: [{ x: -5.94, z: -1.81 }], exit: null },
    ...Object.fromEntries(Object.entries(LINE_X).flatMap(([c, L]) => Object.entries(L).map(([l, x]) => [`${c}:${l}`, lineDock(x, l === 'L03' || l === 'L04')]))),
  },
});
export const PARTS_IDS = Object.freeze(Object.keys(DEFAULT_PARTS_AMR.cells));

// 지개차 AMR(원재료): 부품과 같은 남쪽 창고 통로. STORE → SORT:RAW 만.
// 적재면 = 포크 윗면(가정, render/jack.js 와 같음).
export const JACK = Object.freeze({ deck: 0.42, count: 2 });
export const JACK_IDS = Object.freeze(['STORE', 'SORT:RAW']);
export const DEFAULT_JACK_AMR = Object.freeze({
  route: DEFAULT_PARTS_AMR.route,
  // STORE 동쪽 · 부품 동쪽 충전 덩어리 서쪽. 피치 1.4 m.
  homes: [
    { x: 20.0, z: -13.4 }, { x: 21.4, z: -13.4 },
  ],
  cells: {
    STORE: { entry: { x: -1.5, z: 2.1 }, stops: [{ x: -1.5, z: 1.3 }], exit: null },
    'SORT:RAW': { entry: { x: 6.36, z: -7.4 }, stops: [{ x: 6.36, z: -4.4 }], exit: null },
  },
});

const clone = (v) => JSON.parse(JSON.stringify(v));
const pt = (p) => ({ x: R(p.x), z: R(p.z) });
const num = (v) => Number.isFinite(v);
const isPt = (p) => p && num(p.x) && num(p.z);

export function defaultAmr() { return clone(DEFAULT_AMR); }
export function defaultPartsAmr() { return clone(DEFAULT_PARTS_AMR); }
export function defaultJackAmr() { return clone(DEFAULT_JACK_AMR); }

export function normalizeAmr(raw, cellIds, d = DEFAULT_AMR) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const nodes = (src.route?.nodes ?? d.route.nodes).map((n) => ({ id: String(n.id), ...pt(n) }));
  const edges = (src.route?.edges ?? d.route.edges).map((e) => ({
    a: String(e.a), b: String(e.b),
    ...(e.oneway ? { oneway: true } : {}),
    ...(e.center ? { center: true } : {}),
  }));
  const homes = (src.homes ?? d.homes).map(pt);
  const cells = {};
  for (const id of cellIds) {
    let c = src.cells?.[id] ?? d.cells[id] ?? BAY;
    if (d === DEFAULT_AMR && LIFT_CELLS.includes(id) && oldBay(c)) c = d.cells[id];
    cells[id] = { entry: pt(c.entry), stops: c.stops.map(pt), exit: c.exit ? pt(c.exit) : null };
  }
  if (cells.SORT && d === DEFAULT_AMR) cells.SORT = withLanes(cells.SORT);
  return { route: { nodes, edges }, homes, cells };
}

// 예전 PRESS·SCREW 막다른 투입 칸(서쪽 도크 x −1.83, 출구 없음) → 리프트 통과 칸으로 바꿔 읽는다. 사용자가 고친 칸은 그대로.
function oldBay(c) {
  const s = c?.stops;
  return !c?.exit && Array.isArray(s) && s.length === 1 && Math.hypot(s[0].x - BAY.stops[0].x, s[0].z - BAY.stops[0].z) < 1e-6;
}

// SORT 분류 레인 A–D 내림 자리(셀 로컬 x, GLB Lane_*_transfer_type3 — tests/glb.mjs 가 대조).
export const SORT_LANE_X = Object.freeze([-1.84, -0.14, 1.56, 3.26]);

// 예전 레이아웃(레인 칸 없는 SORT 3칸)에 레인 칸을 끼운다: 통과형일 때만, 도크와 같은 줄(z)에, 입구→출구 순서로.
function withLanes(c) {
  if (!c.exit) return c;
  const dock = c.stops[c.stops.length - 1];
  const miss = SORT_LANE_X.filter((x) => !c.stops.some((s) => Math.hypot(s.x - x, s.z - dock.z) < 0.3));
  if (!miss.length) return c;
  const dir = { x: c.exit.x - c.entry.x, z: c.exit.z - c.entry.z };
  const along = (p) => (p.x - c.entry.x) * dir.x + (p.z - c.entry.z) * dir.z;
  const before = [...c.stops.slice(0, -1), ...miss.map((x) => pt({ x, z: dock.z }))].filter((s) => along(s) < along(dock));
  return { ...c, stops: [...before.sort((a, b) => along(a) - along(b)), dock] };
}

// 구조 오류만 거부한다. 루트가 셀을 지나는지·도달 가능한지는 route.js routeIssues 가 경고로 낸다.
export function validateAmr(raw, cellIds, field) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return ['amr가 객체 아님'];
  const hw = field.w / 2, hd = field.d / 2;
  const inField = (p) => Math.abs(p.x) <= hw && Math.abs(p.z) <= hd;
  const nodes = raw.route?.nodes, edges = raw.route?.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return ['amr.route.nodes·edges 배열 아님'];
  const ids = new Set();
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string' || !n.id) { errors.push('루트 노드 id 없음'); continue; }
    if (ids.has(n.id)) errors.push(`루트 노드 id 중복 ${n.id}`);
    ids.add(n.id);
    if (!isPt(n) || !inField(n)) errors.push(`루트 노드 ${n.id}가 바닥 밖`);
  }
  const seen = new Set();
  for (const e of edges) {
    if (!ids.has(e?.a) || !ids.has(e?.b) || e.a === e.b) { errors.push(`루트 간선 ${e?.a}–${e?.b} 잘못됨`); continue; }
    const k = [e.a, e.b].sort().join('|');
    if (seen.has(k)) errors.push(`루트 간선 중복 ${e.a}–${e.b}`);
    seen.add(k);
  }
  const homes = raw.homes;
  if (!Array.isArray(homes) || homes.length < 1 || homes.length > AMR_HOMES_MAX) errors.push(`충전 자리는 1~${AMR_HOMES_MAX}개`);
  else if (homes.some((h) => !isPt(h) || !inField(h))) errors.push('충전 자리가 바닥 밖');
  for (const id of cellIds) {
    const c = raw.cells?.[id];
    if (!c) { errors.push(`${id} AMR 지점 없음`); continue; }
    if (!isPt(c.entry)) errors.push(`${id} entry 없음`);
    if (!Array.isArray(c.stops) || !c.stops.length || c.stops.some((p) => !isPt(p))) errors.push(`${id} stops는 1개 이상`);
    if (c.exit != null && !isPt(c.exit)) errors.push(`${id} exit 잘못됨`);
  }
  return errors;
}

// ── Admin 편집 (문서를 새로 만들어 돌려준다) ──
// 핸들 ref: { kind: 'node', id } | { kind: 'home', i } | { kind: 'entry'|'exit', cell } | { kind: 'stop', cell, i }

export function nextNodeId(amr) {
  let i = amr.route.nodes.length;
  const ids = new Set(amr.route.nodes.map((n) => n.id));
  while (ids.has(`N${i}`)) i++;
  return `N${i}`;
}

// 필드 좌표 x,z 로 옮긴다. 셀 지점은 toLocal(cell, x, z) 로 셀 로컬로 바꾼다.
export function moveHandle(amr, ref, x, z, toLocal) {
  const a = clone(amr);
  if (ref.kind === 'node') Object.assign(a.route.nodes.find((n) => n.id === ref.id) ?? {}, pt({ x, z }));
  else if (ref.kind === 'home') a.homes[ref.i] = pt({ x, z });
  else {
    const l = pt(toLocal(ref.cell, x, z));
    const c = a.cells[ref.cell];
    if (ref.kind === 'entry') c.entry = l;
    else if (ref.kind === 'exit') c.exit = l;
    else if (ref.kind === 'stop') c.stops[ref.i] = l;
  }
  return a;
}

export function addNode(amr, x, z, linkTo = null) {
  const a = clone(amr);
  const id = nextNodeId(a);
  a.route.nodes.push({ id, ...pt({ x, z }) });
  if (linkTo && a.route.nodes.some((n) => n.id === linkTo)) a.route.edges.push({ a: linkTo, b: id });
  return { amr: a, id };
}

export function addHome(amr, x, z) {
  if (amr.homes.length >= AMR_HOMES_MAX) return null;
  const a = clone(amr);
  a.homes.push(pt({ x, z }));
  return a;
}

// 지울 수 없는 것(entry, 도크, 마지막 충전 자리)은 null.
export function removeHandle(amr, ref) {
  const a = clone(amr);
  if (ref.kind === 'node') {
    a.route.nodes = a.route.nodes.filter((n) => n.id !== ref.id);
    a.route.edges = a.route.edges.filter((e) => e.a !== ref.id && e.b !== ref.id);
    return a;
  }
  if (ref.kind === 'home') {
    if (a.homes.length <= 1) return null;
    a.homes.splice(ref.i, 1);
    return a;
  }
  if (ref.kind === 'exit') { a.cells[ref.cell].exit = null; return a; }
  if (ref.kind === 'stop') {
    const c = a.cells[ref.cell];
    if (ref.i === c.stops.length - 1) return null;
    c.stops.splice(ref.i, 1);
    return a;
  }
  return null;
}

// 두 노드 사이 간선: 없음 → 양방향 → 단방향(a→b) → 없음 순으로 바꾼다.
export function cycleEdge(amr, a, b) {
  const out = clone(amr);
  const i = out.route.edges.findIndex((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  if (i < 0) { out.route.edges.push({ a, b }); return { amr: out, state: 'two-way' }; }
  const e = out.route.edges[i];
  if (!e.oneway) { out.route.edges[i] = { a, b, oneway: true }; return { amr: out, state: 'oneway' }; }
  out.route.edges.splice(i, 1);
  return { amr: out, state: 'none' };
}

// 셀 출구를 도크 앞 진행 방향으로 1.6 m 에 만든다 (막다른 셀 → 통과 셀).
export function addExit(amr, cell) {
  const a = clone(amr);
  const c = a.cells[cell];
  if (c.exit) return a;
  const d = c.stops[c.stops.length - 1], p = c.stops[c.stops.length - 2] ?? c.entry;
  const l = Math.hypot(d.x - p.x, d.z - p.z) || 1;
  c.exit = pt({ x: d.x + ((d.x - p.x) / l) * 1.6, z: d.z + ((d.z - p.z) / l) * 1.6 });
  return a;
}
