// 셀 공정 정의(src/process.default.json) 점검·정규화. DOM·three 없음.
// 정의는 가정값이다: 셀 로컬 작업 지점(m)·공정 순서·시간(s)·부품 치수. 형상(GLB)에서 뽑을 수 있는 값(레일·관절·롤러 위치)은 여기 두지 않는다.

export const OPS = Object.freeze(['feed', 'transfer', 'path', 'dwell', 'unload']);
// 키트 모델 놓는 자세: upright = 에셋 그대로(세움), face-up = 앞면이 위로(지그에 눕힘)
export const LAYS = Object.freeze(['upright', 'face-up']);

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const pt = (p) => p && num(p.x) && num(p.y) && num(p.z);
const size3 = (s) => Array.isArray(s) && s.length === 3 && s.every((v) => num(v) && v > 0);

// 한 단계(병렬 작업 묶음)의 시간 = 가장 긴 작업
export const stepTime = (step) => Math.max(0, ...step.map((op) => op.time));
export const flowTime = (flow) => flow.steps.reduce((s, st) => s + stepTime(st), 0);

// 키트 위 자리 → 작업 구역(스테이션 남쪽 s / 북쪽 n 반). 같은 반에서 두 로봇이 동시에 일하지 않는다.
export const halfOf = (st, at) => `${st}${at[1] < 0 ? 's' : 'n'}`;

// cycle: 시나리오 cycle({PRESS: 36…}). 주면 마지막 스테이션 흐름 합 = takt = cycle 을 본다.
export function validateProcess(doc, { cycle = null } = {}) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['공정 정의가 객체 아님'];
  if (doc.version !== 1) errors.push('version은 1');
  if (!size3(doc.kit?.size)) errors.push('kit.size는 양수 3개');
  if (doc.kit?.model != null && typeof doc.kit.model !== 'string') errors.push('kit.model은 에셋 키(문자열)');
  if (doc.kit?.lay != null && !LAYS.includes(doc.kit.lay)) errors.push(`kit.lay는 ${LAYS.join('·')}`);
  if (!(doc.deck > 0)) errors.push('deck(AMR 적재면 높이)은 양수');
  const cells = doc.cells ?? {};
  const S = cells.SORT;
  if (S) {
    if (!Array.isArray(S.rack) || !S.rack.length || !S.rack.every(pt)) errors.push('SORT rack은 {x,y,z} 배열');
    if (!(S.pickup > 0)) errors.push('SORT pickup은 양수');
    if (S.inbound != null && !(S.inbound.load > 0)) errors.push('SORT inbound.load는 양수');
    const L = S.load;
    if (L) {
      if (!Array.isArray(L.robots) || L.robots.length !== 2 || !L.robots.every((r) => typeof r === 'string')) errors.push('SORT load.robots는 팔 이름 2개');
      if (!(L.time > 0) || !(L.clear > 0) || !(L.reach > 0) || !(L.readyY > 0)) errors.push('SORT load time·clear·reach·readyY는 양수');
      if (!(L.grip > 0 && L.grip <= 1)) errors.push('SORT load.grip은 0~1');
      if (L.body != null && typeof L.body !== 'string') errors.push('SORT load.body는 GLB 그룹 이름');
    }
    if (S.feed != null) errors.push(...validateFeed(S.feed));
  }
  // 완료품 적재 구역: 협동로봇 + 책장 칸
  const O = cells.OUT;
  if (O) {
    if (!Array.isArray(O.slots) || !O.slots.length || !O.slots.every(pt)) errors.push('OUT slots는 {x,y,z} 배열');
    if (!(O.time > 0) || !(O.clear > 0) || !(O.ship > 0)) errors.push('OUT time·clear·ship은 양수');
    if (!O.home || !num(O.home.x) || !num(O.home.z)) errors.push('OUT home은 {x,z}');
    const C = O.cobot, B = C?.base, R = C?.rail;
    if (!C || !B || !num(B.x) || !num(B.y) || !num(B.z) || !(C.L1 > 0) || !(C.L2 > 0)) errors.push('OUT cobot {base{x,y,z}, L1>0, L2>0}');
    if (!R || !num(R.lo) || !num(R.hi) || R.lo >= R.hi) errors.push('OUT cobot.rail {lo<hi}');
    const S = O.shelf;
    if (!S || !num(S.z) || !(S.depth > 0) || !(S.width > 0) || !Array.isArray(S.decks) || !S.decks.length || !S.decks.every((y) => num(y) && y > 0)) {
      errors.push('OUT shelf {z, depth>0, width>0, decks[]}');
    }
  }
  // 부속 부품 공급(부품 AMR): 라인마다 적재 팔레트 start 개(기본 0)로 시작, left ≤ reorder 면 토트 하나(qty 개) 요청. 창고 shelf 는 PARTS 자리 로컬.
  const U = doc.supply;
  if (U != null) {
    if (!Number.isInteger(U.qty) || U.qty < 1) errors.push('supply.qty는 1 이상 정수');
    if (U.start != null && (!Number.isInteger(U.start) || U.start < 0 || U.start > U.qty)) errors.push('supply.start는 0 이상 qty 이하 정수');
    if (!Number.isInteger(U.reorder) || U.reorder < 0 || U.reorder >= U.qty) errors.push('supply.reorder는 0 이상 qty 미만 정수');
    if (!(U.load > 0) || !(U.unload > 0)) errors.push('supply load·unload는 양수');
    if (!size3(U.tote?.size)) errors.push('supply.tote.size는 양수 3개');
    if (!pt(U.shelf)) errors.push('supply.shelf는 {x,y,z}');
    if (!Number.isInteger(U.batch) || U.batch < 1 || U.batch > 4) errors.push('supply.batch는 1~4 정수(AMR 적재면 2×2칸)');
    if (!(U.top > 0)) errors.push('supply.top(부품 AMR 적재면 높이)은 양수');
  }
  const unloads = Object.entries(cells).filter(([, C]) => C?.flow?.some((f) => f.steps?.some((st) => st?.some?.((op) => op?.do === 'unload'))));
  if (unloads.length && !O) errors.push(`${unloads.map(([id]) => id).join('·')} 반출(unload)에는 cells.OUT 필요`);
  // 흐름 없는 셀: 지그 자리 옮김만
  for (const [id, C] of Object.entries(cells)) {
    if (id === 'SORT' || id === 'OUT' || C?.flow || !C?.slots) continue;
    if (!Array.isArray(C.slots) || !C.slots.length || !C.slots.every(pt)) errors.push(`${id} slots는 {x,y,z} 배열`);
    if (!(C.handoff > 0)) errors.push(`${id} handoff는 양수`);
  }
  for (const id of Object.keys(cells)) if (cells[id]?.flow) errors.push(...validateWork(id, workDef(doc, id), cycle?.[id]));
  return errors;
}

// 완료품 적재 구역 정의 + 공통 키트·적재면.
export const outDef = (doc) => (doc?.cells?.OUT ? { ...doc.cells.OUT, kit: doc.kit, deck: doc.deck } : null);
export const supplyDef = (doc) => (doc?.supply ? { ...doc.supply, deck: doc.deck } : null);

// SORT 부속 부품 분류(가정): 투입 이송기 → 컨베이어(바코드 스캔) → 레인 분기 → 레인 롤러 → 내림 이송기. 레인마다 목적 도크(셀:라인).
function validateFeed(F) {
  const errors = [];
  const E = (m) => errors.push(`SORT feed ${m}`);
  const I = F.infeed, C = F.conveyor, L = F.lane;
  if (!I || typeof I.transfer !== 'string' || !num(I.drop?.x) || !(I.time > 0)) E('infeed {transfer, drop{x}, time>0}');
  if (!(F.scan > 0)) E('scan은 양수');
  if (!C || !num(C.y) || !num(C.z) || !(C.speed > 0) || !(C.pitch > 0)) E('conveyor {y, z, speed>0, pitch>0}');
  if (!L || !num(L.from) || !num(L.to) || L.to <= L.from || !(L.speed > 0) || !(L.pitch > 0) || !(L.divert > 0) || !(L.hand > 0)) E('lane {from<to, speed·pitch·divert·hand>0}');
  if (!Array.isArray(F.lanes) || !F.lanes.length) { E('lanes 배열'); return errors; }
  const seen = new Set();
  for (const l of F.lanes) {
    if (typeof l?.id !== 'string' || !num(l.x) || typeof l.divert !== 'string' || typeof l.hand !== 'string') { E('lanes[] {id, x, divert, hand}'); continue; }
    if (!Array.isArray(l.to) || !l.to.length) E(`레인 ${l.id} to(목적 도크) 없음`);
    for (const d of l.to ?? []) { if (seen.has(d)) E(`목적 도크 ${d} 가 레인 둘에`); seen.add(d); }
    // 레인에 한 번에 올 수 있는 토트(목적 라인마다 하나) ≤ 롤러 칸 — 분기에서 막혀 컨베이어가 서지 않게
    if (L && Math.floor((L.to - L.from) / L.pitch) + 1 < (l.to?.length ?? 0)) E(`레인 ${l.id} 롤러 칸 < 목적 라인 수`);
  }
  if (I && C && F.lanes.some((l) => l.x <= I.drop.x)) E('레인 x 는 투입 drop.x 보다 하류(+x)');
  return errors;
}

function validateWork(id, P, cycle) {
  const errors = [];
  const E = (m) => errors.push(`${id} ${m}`);
  if (!(P.takt > 0)) E('takt는 양수');
  if (cycle != null && P.takt !== cycle) E(`takt ${P.takt} ≠ 시나리오 cycle ${cycle}`);
  for (const k of ['clear', 'railGap']) if (!(P[k] > 0)) E(`${k}는 양수`);
  if (!(P.grip > 0 && P.grip <= 1)) E('grip은 0~1');
  if (!size3(P.kit?.size)) return errors;
  const parts = P.parts ?? {};
  const halves = new Set();
  for (const [name, p] of Object.entries(parts)) {
    if (!size3(p.size)) E(`부품 ${name} size`);
    if (!Array.isArray(p.at) || p.at.length < 2 || p.at.length > 3 || !p.at.every(num)) E(`부품 ${name} at은 [dx,dz] 또는 [dx,dz,dy]`);
    else {
      const [hx, , hz] = P.kit.size.map((v) => v / 2);
      if (Math.abs(p.at[0]) + p.size[0] / 2 > hx + 1e-9 || Math.abs(p.at[1]) + p.size[2] / 2 > hz + 1e-9) E(`부품 ${name}이 키트 밖`);
      if ((p.at[2] ?? 0) > 0 || -(p.at[2] ?? 0) > P.kit.size[1]) E(`부품 ${name} dy는 -키트 높이~0`);
    }
  }
  const st = P.stations ?? {};
  for (const [n, s] of Object.entries(st)) if (!pt(s)) E(`스테이션 ${n}은 {x,y,z}`);
  const lines = new Map();
  for (const L of P.lines ?? []) {
    if (lines.has(L.id)) E(`라인 ${L.id} 중복`);
    lines.set(L.id, L);
    if (!parts[L.part]) E(`라인 ${L.id} 부품 ${L.part} 없음`);
    if (!st[L.to]) E(`라인 ${L.id} 스테이션 ${L.to} 없음`);
    for (const k of ['x', 'in', 'out', 'y']) if (!num(L[k])) E(`라인 ${L.id} ${k}는 수`);
    if (!(L.pitch > 0 && L.speed > 0)) E(`라인 ${L.id} pitch·speed는 양수`);
    if (Math.abs(L.out - L.in) < L.pitch) E(`라인 ${L.id} 길이 < pitch`);
    if (typeof L.robot !== 'string') E(`라인 ${L.id} robot`);
    const g = L.gantry;
    if (!g || !num(g.stock) || !num(g.stockY) || !(g.up > 0) || !(g.time > 0)) E(`라인 ${L.id} gantry {stock,stockY,up,time}`);
    else if (Math.sign(L.in - g.stock) !== Math.sign(L.out - L.in)) E(`라인 ${L.id} 적재 지점이 투입 지점 바깥이 아님`);
  }
  const H = P.handoff;
  if (!H || typeof H.robot !== 'string' || !st[H.to] || !(H.time > 0)) E('handoff {robot,to,time}');
  const flows = P.flow ?? [];
  if (!flows.length) E('flow 없음');
  const fed = new Set();
  flows.forEach((f, i) => {
    if (!st[f.station]) E(`flow ${i} 스테이션 ${f.station} 없음`);
    if (f.from && !st[f.from]) E(`flow ${i} from ${f.from} 없음`);
    if (i === 0 && f.station !== H?.to) E('첫 flow 스테이션은 handoff.to');
    if (i > 0 && f.from !== flows[i - 1].station) E(`flow ${i} from 은 앞 스테이션`);
    if (!Array.isArray(f.steps) || !f.steps.length) { E(`flow ${i} steps 없음`); return; }
    f.steps.forEach((step, k) => {
      if (!Array.isArray(step) || !step.length) { E(`flow ${i} 단계 ${k} 비었음`); return; }
      const robots = new Set(), zones = new Set();
      for (const op of step) {
        if (!OPS.includes(op.do)) { E(`flow ${i} 단계 ${k} 모르는 작업 ${op.do}`); continue; }
        if (!(op.time > 0)) E(`flow ${i} 단계 ${k} time은 양수`);
        if (op.do === 'transfer' && (k !== 0 || !f.from)) E(`flow ${i} transfer는 from 있는 흐름의 첫 단계`);
        if (op.do === 'unload') {
          if (i !== flows.length - 1 || k !== f.steps.length - 1 || step.length !== 1) E(`flow ${i} unload는 마지막 흐름 마지막 단계에 혼자`);
          const Y = op.yield;
          if (Y != null && (typeof Y.robot !== 'string' || Y.robot === op.robot || !(Y.s > 0))) E(`flow ${i} unload yield {robot(다른 로봇), s>0}`);
        }
        if (op.do === 'feed') {
          const L = lines.get(op.line);
          if (!L) { E(`flow ${i} 라인 ${op.line} 없음`); continue; }
          if (L.to !== f.station) E(`라인 ${L.id} to ≠ ${f.station}`);
          if (fed.has(L.id)) E(`라인 ${L.id} 두 번 투입`);
          fed.add(L.id);
          if (robots.has(L.robot)) E(`flow ${i} 단계 ${k} 로봇 ${L.robot} 겹침`);
          robots.add(L.robot);
          const z = halfOf(f.station, parts[L.part]?.at ?? [0, 0]);
          if (zones.has(z)) E(`flow ${i} 단계 ${k} 구역 ${z} 겹침`);
          zones.add(z);
        } else if (op.do !== 'dwell') {
          if (typeof op.robot !== 'string') E(`flow ${i} 단계 ${k} ${op.do} robot`);
          if (robots.has(op.robot)) E(`flow ${i} 단계 ${k} 로봇 ${op.robot} 겹침`);
          robots.add(op.robot);
          if (op.do === 'path' && (!Array.isArray(op.path) || op.path.length < 2 || !num(op.y))) E(`flow ${i} path 는 점 2개 이상 + y`);
        }
      }
    });
  });
  for (const L of lines.values()) if (!fed.has(L.id)) E(`라인 ${L.id} 투입 단계 없음`);
  // 사이클: 마지막 스테이션 흐름 합 = takt (병목). 앞 스테이션 흐름 + 하역 ≤ takt (안 그러면 병목이 앞으로 옮겨간다).
  if (flows.length && P.takt > 0) {
    const last = flowTime(flows.at(-1));
    if (Math.abs(last - P.takt) > 1e-9) E(`${flows.at(-1).station} 단계 합 ${last}s ≠ takt ${P.takt}s`);
    if (H && flowTime(flows[0]) + H.time > P.takt) E(`${flows[0].station} 단계 합 + 하역 ${flowTime(flows[0]) + H.time}s > takt`);
  }
  return errors;
}

// 셀 공정(스테이션 흐름 있는 셀) 정의 + 공통 키트·적재면.
export const workDef = (doc, id) => (doc?.cells?.[id]?.flow ? { ...doc.cells[id], kit: doc.kit, deck: doc.deck } : null);

export function normalizeProcess(doc, opts) {
  const errors = validateProcess(doc, opts);
  if (errors.length) throw new Error(errors.join(' · '));
  return JSON.parse(JSON.stringify(doc));
}
