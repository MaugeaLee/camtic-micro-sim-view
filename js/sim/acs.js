// ACS (AMR Control System): 사전 배치 플릿 · 운반 미션 배정 · 경로 · 셀 진입 잠금 · 셀 안 정차 칸 · 충전 복귀. DOM·three 없음.
// AMR은 충전 자리(레이아웃 amr.homes)에 미리 서 있고 새로 생기지 않는다. 미션은 생산 쪽(scenario.js Plant)이 request 로 넣는다.
// 교통 규칙: 메인 루트 양방향 간선은 우측 통행 차로(감지·양보는 fleet.js). 셀 접속선+셀 안은 잠금 구간 —
// 막다른 셀은 1대, 통과 셀은 정차 칸 수만큼, 들어온 순서(FIFO)로만 들어간다. 대기는 접속점 HOLD m 앞 차로에서 한다.
import { AMR, Amr, sense } from './fleet.js';
import { attach, cellGeo, cutAt, graphOf, headingOf, journey, pathLength, routeIssues } from './route.js';

export const HOLD = 2.0;          // 셀 접속점 앞 진입 대기 거리(최소). 교차 구역 밖으로 더 물러날 수 있다
export const SPUR_HOLD = 12;      // OUT: 세로 지선이 출차 길이라 통로 쪽에서 기다린다
export const ZONE_R = 1.8;        // 교차 구역 반경: 양 차로(±0.7) + 차체 + 여유
const PRE = 1.0;                  // 도크·충전 자리 앞 저속 진입 구간
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// 충전 자리 방향: 루트 쪽을 등진다(앞으로 들어와 후진으로 나간다).
export function homeHeading(graph, h) {
  const at = attach(graph, h);
  return at && dist(at.point, h) > 1e-3 ? headingOf({ x: h.x - at.point.x, z: h.z - at.point.z }) : 0;
}

// 그리기용 지도: 루트 간선·노드, 셀 지점과 접속선, 충전 자리, 교차 구역, 점검 결과.
// geo = { graph, cells, check, homes, zones } — Acs 자신이거나 routeGeo(layout) (편집 미리보기).
export function mapOf(geo) {
  const { graph, check: { badCells, badEdges, issues } } = geo;
  const link = (p) => { const at = p && attach(graph, p); return at ? [p, at.point] : null; };
  return {
    rev: geo.geoRev ?? 0,
    nodes: [...graph.nodes.values()].map(({ id, x, z }) => ({ id, x, z })),
    edges: graph.edges.map((e) => ({ a: e.a, b: e.b, pa: e.pa, pb: e.pb, oneway: !!e.oneway, center: !!e.center, bad: badEdges.has(e.i) })),
    cells: Object.values(geo.cells).map((c) => ({ ...c, bad: badCells.has(c.id), links: [link(c.entry), link(c.exit)].filter(Boolean) })),
    homes: geo.homes.map((h) => ({ x: h.x, z: h.z, heading: h.heading, link: link(h) })),
    zones: geo.zones.map(({ x, z, r }) => ({ x, z, r })),
    issues,
  };
}

// 시뮬 없이 레이아웃만으로 지도 기하를 만든다(시나리오 없음·Admin 편집 미리보기).
export function routeGeo(layout) {
  const graph = graphOf(layout.amr.route), cells = cellGeo(layout);
  return {
    graph, cells, check: routeIssues(layout),
    homes: layout.amr.homes.map((h) => ({ ...h, heading: homeHeading(graph, h) })),
    zones: junctions(graph, cells),
  };
}

// 셀 입구·출구 접속점마다 교차 구역. 겹치는 구역은 하나로 합친다(합친 원이 둘을 덮게).
export function junctions(graph, cells) {
  let zs = [];
  for (const c of Object.values(cells)) {
    for (const p of [c.entry, ...(c.exit ? [c.exit] : [])]) {
      const at = attach(graph, p);
      if (at) zs.push({ x: at.point.x, z: at.point.z, r: ZONE_R, holder: null, cells: [c.id] });
    }
  }
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < zs.length; i++) {
      for (let j = i + 1; j < zs.length; j++) {
        const A = zs[i], B = zs[j], d = dist(A, B);
        if (d >= A.r + B.r - 0.4) continue;
        if (d + B.r <= A.r) { A.cells.push(...B.cells); zs.splice(j, 1); merged = true; break outer; }
        if (d + A.r <= B.r) { B.cells.push(...A.cells); zs.splice(i, 1); merged = true; break outer; }
        const r = (d + A.r + B.r) / 2, k = (r - A.r) / (d || 1);
        zs[i] = { x: A.x + (B.x - A.x) * k, z: A.z + (B.z - A.z) * k, r, holder: null, cells: [...A.cells, ...B.cells] };
        zs.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return zs;
}

// 교차로 구역 반지름: 구역 밖에서 서는 차의 앞코가 다른 플릿 차선(차선 간격 + 차폭 절반)에 닿지 않게.
// 1.8 이면 차선 0.7 m 옆으로 기다리는 차 앞코와 지나가는 차 옆면 사이가 0.02 m 뿐이다.
export const CROSS_R = 2.3;

// 두 루트 그래프(다른 플릿)의 간선이 만나는 점마다 교차로 구역. 두 ACS 가 같은 구역 객체를 같이 잡는다(한 대씩).
function closestOnSeg(p, a, b) {
  const ab = { x: b.x - a.x, z: b.z - a.z }, L2 = ab.x * ab.x + ab.z * ab.z;
  const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.z - a.z) * ab.z) / L2)) : 0;
  return { x: a.x + ab.x * t, z: a.z + ab.z * t };
}

function segNear(a, b, c, d) {
  let best = { d: Infinity, x: 0, z: 0 };
  const hit = (p, q) => {
    const g = Math.hypot(p.x - q.x, p.z - q.z);
    if (g < best.d) best = { d: g, x: q.x, z: q.z };
  };
  hit(a, closestOnSeg(a, c, d));
  hit(b, closestOnSeg(b, c, d));
  hit(closestOnSeg(c, a, b), c);
  hit(closestOnSeg(d, a, b), d);
  return best;
}

export function crossings(gA, gB) {
  const out = [];
  for (const e of gA.edges) for (const f of gB.edges) {
    const r = { x: e.pb.x - e.pa.x, z: e.pb.z - e.pa.z }, s = { x: f.pb.x - f.pa.x, z: f.pb.z - f.pa.z };
    const d = r.x * s.z - r.z * s.x;
    const lr = Math.hypot(r.x, r.z) || 1, ls = Math.hypot(s.x, s.z) || 1;
    if (Math.abs(d) >= 1e-9) {
      const qx = f.pa.x - e.pa.x, qz = f.pa.z - e.pa.z;
      const t = (qx * s.z - qz * s.x) / d, u = (qx * r.z - qz * r.x) / d;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        out.push({ x: e.pa.x + r.x * t, z: e.pa.z + r.z * t, r: CROSS_R, holder: null, cells: [], cross: true });
        continue;
      }
    }
    // 거의 수직인데 구간이 1 m 안팎으로만 스치면(입고 지선이 부품 남행 옆에서 꺾임) 부품 쪽 最近点에 작은 구역.
    if (Math.abs(d) / (lr * ls) < 0.5) continue;
    const near = segNear(e.pa, e.pb, f.pa, f.pb);
    if (near.d > 0.2 && near.d < 1.3) out.push({ x: near.x, z: near.z, r: 1.2, holder: null, cells: [], cross: true });
  }
  return out;
}

// 두 원을 덮는 원(Z 를 넓힌다)
function cover(Z, O) {
  const d = dist(Z, O);
  if (d + Z.r <= O.r) { Z.x = O.x; Z.z = O.z; Z.r = O.r; }
  else if (d + O.r > Z.r) {
    const r = (d + Z.r + O.r) / 2, k = (r - Z.r) / (d || 1);
    Z.x += (O.x - Z.x) * k; Z.z += (O.z - Z.z) * k; Z.r = r;
  }
  Z.cells.push(...O.cells);
}

// 두 ACS 가 같이 쓰는 것: 교차로 구역, 서로 겹치는 셀 접속 구역(같은 셀 입구에 두 플릿이 붙는 자리), 같은 id 셀의 잠금·정차 칸.
// 교차로가 어느 쪽 셀 접속 구역과 겹치면 하나로 합친다(겹친 두 구역을 서로 반대 방향 차가 하나씩 잡으면 교착 —
// junctions 가 합치는 것과 같은 이유). 두 플릿은 서로의 차도 감지한다(peers).
export function shareCross(A, B) {
  const X = crossings(A.graph, B.graph);
  for (let i = A.own.length - 1; i >= 0; i--) {
    const O = A.own[i];
    if (!B.own.some((Q) => dist(O, Q) < O.r + Q.r - 0.4)) continue;
    A.own.splice(i, 1);
    X.push({ x: O.x, z: O.z, r: O.r, holder: null, cells: [...O.cells], cross: true });
  }
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < X.length && !merged; i++) for (let j = i + 1; j < X.length; j++) {
      if (dist(X[i], X[j]) >= X[i].r + X[j].r - 0.4) continue;
      cover(X[i], X[j]);
      X.splice(j, 1);
      merged = true;
      break;
    }
    for (const Z of X) for (const F of [A, B]) {
      const i = F.own.findIndex((O) => dist(Z, O) < Z.r + O.r - 0.4);
      if (i < 0) continue;
      const [O] = F.own.splice(i, 1);
      cover(Z, O);
      merged = true;
    }
  }
  A.setCross(X);
  B.setCross(X);
  for (const id of Object.keys(A.locks)) if (B.locks[id]) B.locks[id] = A.locks[id];
  A.peers = [B]; B.peers = [A];
  return X;
}

export class Acs {
  // prefix: AMR id 머리(플릿 구분). 교차로 구역은 setCross 로 다른 ACS 와 같이 쓴다.
  constructor(count, layout, { prefix = 'AMR' } = {}) {
    this.scale = 1;
    this.note = null;
    this.queue = [];
    this.missionSeq = 0;
    this.cross = [];
    this.setGeo(layout);
    if (count > this.homes.length) throw new Error(`AMR ${count}대 > 충전 자리 ${this.homes.length}`);
    this.amrs = Array.from({ length: count }, (_, i) => new Amr(`${prefix}-${String(i + 1).padStart(2, '0')}`, i, this.homes[i]));
  }

  setCross(zs) {
    this.cross = zs;
    this.zones = [...this.own, ...zs];
    this.geoRev++;
  }

  setGeo(layout) {
    this.layout = layout;
    this.graph = graphOf(layout.amr.route);
    this.cells = cellGeo(layout);
    this.check = routeIssues(layout);
    // 충전 자리: 루트 쪽을 등지고 선다(앞으로 들어와 후진으로 나간다).
    this.homes = layout.amr.homes.map((h) => ({ ...h, heading: this.parkHeading(h) }));
    this.locks = {};
    for (const c of Object.values(this.cells)) this.locks[c.id] = { cap: c.cap, line: [], inside: new Set(), stops: c.stops.map(() => null) };
    this.own = junctions(this.graph, this.cells);
    this.zones = [...this.own, ...(this.cross ?? [])];
    this.geoRev = (this.geoRev ?? 0) + 1;
  }

  // 그리기용 지도. geoRev 가 바뀔 때만 다시 그리면 된다.
  map() { return mapOf(this); }

  // ── 교차 구역: 셀 입구·출구가 메인 루트에 붙는 자리. 몸체가 원 안에 들어가려면 그 구역을 잡아야 한다(한 대씩). ──
  zonesOk(a, x, z) {
    for (const Z of this.zones) {
      if (Z.holder === a || Math.hypot(x - Z.x, z - Z.z) >= Z.r) continue;
      if (Z.holder) { a.zoneWait = Z; return false; }
      Z.holder = a;
    }
    a.zoneWait = null;
    return true;
  }

  // 다른 차가 잡은 구역 경계까지 남은 거리(진행 방향 직선). 이미 안에 있으면 0.
  zoneGap(a, dir, seg) {
    let g = Infinity, waitZ = null;
    for (const Z of this.zones) {
      if (!Z.holder || Z.holder === a) continue;
      const rx = Z.x - a.x, rz = Z.z - a.z, m = rx * dir.x + rz * dir.z, d2 = rx * rx + rz * rz;
      if (d2 < Z.r * Z.r) { g = 0; waitZ = Z; continue; }
      const p2 = d2 - m * m;
      if (m <= 0 || p2 >= Z.r * Z.r) continue;
      const t = m - Math.sqrt(Z.r * Z.r - p2);
      if (t <= seg + 0.5) {
        const gap = t - 0.05;
        if (gap < g) { g = gap; waitZ = Z; }
      }
    }
    a.zoneWait = g < 0.3 ? waitZ ?? true : null;
    return g;
  }

  holding(a) { return this.zones.some((Z) => Z.holder === a); }

  zonesFree(a) {
    for (const Z of this.zones) if (Z.holder === a && Math.hypot(a.x - Z.x, a.z - Z.z) > Z.r + 0.05) Z.holder = null;
  }

  parkHeading(h) { return homeHeading(this.graph, h); }

  // 레이아웃이 바뀌면(Admin 편집·서버 파일 변경) 플릿을 다시 배치한다: 미션을 거두고(싣던 키트는 버퍼로) 모두 제 충전 자리에 세운다.
  // 옛 경로 위에서 새 경로로 몰고 가면 셀 안을 가로지르거나 갈 길이 없을 수 있어서, 재시운전처럼 처음 자리에서 다시 시작한다.
  // 충전 자리가 대수보다 적으면 남는 차는 운휴(off) — 배차·주행·감지에서 빠진다.
  setLayout(layout) {
    this.setGeo(layout);
    this.queue = [];
    for (const a of this.amrs) { this.abort(a); this.park(a); }
    const off = this.amrs.filter((a) => a.off).length;
    this.note?.({ id: 'ACS' }, `레이아웃 변경 — AMR ${this.amrs.length - off}대 충전 자리로 재배치${off ? ` · ${off}대 운휴(충전 자리 부족)` : ''}`);
  }

  park(a) {
    const h = this.homes[a.idx];
    a.off = !h;
    a.setTask('대기', []);
    a.mode = 'park';
    a.at = { kind: 'home', i: a.idx };
    a.inBranch = null; a.waitFor = null; a.bound = null; a.zoneWait = null;
    a.blockedOn = null; a.blockT = 0; a.passT = 0; a.holdFor = null; a.v = 0; a.moving = false; a.charging = false;
    a.docked = true;
    if (h) { a.home = a.idx; a.x = h.x; a.z = h.z; a.heading = h.heading; }
  }

  abort(a) {
    if (a.mission) { a.mission.abort?.(a); this.queue = this.queue.filter((m) => m !== a.mission); }
    a.mission = null;
    a.load = null;
    a.ticket = null;
  }

  // ── 미션 ──
  // mission: { from, ready(), load(a) → 짐, dest(짐) → 셀 id, canDrop(id), drop(짐, id), abort(a),
  //            pickup?(a, id) / unload?(a, id) → 티켓 {released} — 셀이 다 받거나 내줬을 때 released (없으면 4초),
  //            what?: { pick, wait, hand, carry(id, 짐) } 작업 문구 }
  // from 이 없으면 지금 자리(충전 자리)에서 싣고 dest 로 간다(도어트림 입고 가정).
  // dest 가 null 이면 받을 곳이 없다 — 싣은 채 충전 자리에서 기다렸다가 다시 묻는다(셀 진입 차로를 막지 않게).
  request(m) { m.id = ++this.missionSeq; this.queue.push(m); return m; }
  get pending() { return this.pendingFrom(null); }
  // 아직 싣지 않은 미션 수(from 을 주면 그 셀 것만)
  pendingFrom(from) {
    const mine = (m) => from == null || m.from === from;
    return this.queue.filter(mine).length + this.amrs.filter((a) => a.mission && !a.load && mine(a.mission)).length;
  }
  ok(id) { return id == null || (!!this.cells[id] && !this.check.badCells.has(id)); }

  step(h) {
    this.assign();
    for (const a of this.amrs) if (!a.off) a.update(h, this);
  }

  // 다른 플릿(peers) 차도 본다 — 같은 SORT 레인·지선 끝을 같이 달린다.
  sense(m, dir) {
    if (!this.peers?.length) return sense(this.amrs, m, dir);
    if (this.seen?.n !== this.peers.length) this.seen = { n: this.peers.length, all: [...this.amrs, ...this.peers.flatMap((p) => p.amrs)] };
    return sense(this.seen.all, m, dir);
  }

  assign() {
    while (this.queue.length) {
      const m = this.queue[0];
      if (m.from != null && !this.ok(m.from)) return;
      const a = this.pickAmr(m.from, m);
      if (!a) return;
      this.queue.shift();
      this.start(a, m);
    }
  }

  pickAmr(from, m) {
    const id = from ?? (typeof m?.dest === 'function' ? m.dest() : m?.dest);
    const target = (id && this.cells[id]?.entry) || this.homes[0];
    const free = this.amrs.filter((a) => !a.off && !a.keep && a.mode === 'park' && a.idle && a.battery >= (a.lowLock ? AMR.battery.ready : AMR.battery.low));
    free.sort((a, b) => dist(a, target) - dist(b, target) || a.idx - b.idx);
    return free[0] ?? null;
  }

  start(a, m) {
    a.mission = m; a.mode = 'job'; a.lowLock = false;
    if (!m.from) {
      // 입고: 충전 자리에서 싣고 dest 로. 셀에 서 있으면 먼저 충전 자리로(같은 도크에서 다시 싣지 않게).
      const steps = [];
      if (a.at?.kind !== 'home') {
        const H = this.homes[a.home];
        const leg = H ? this.travel(a, a.at, { kind: 'home', i: a.home }) : null;
        if (leg) steps.push(...leg, { face: H.heading }, { do: () => { a.at = { kind: 'home', i: a.home }; } });
      }
      a.setTask(m.what?.pick ?? '원재료 적재', [
        ...steps,
        { until: () => m.ready(), label: m.what?.wait ?? '원재료 적재 대기' },
        ...this.handover(a, m.pickup, m.what?.tag ?? '입고', m.what?.hand ?? '적재'),
        { do: () => { a.ticket = null; a.load = m.load(a); this.deliver(a); } },
      ]);
      return;
    }
    const C = this.cells[m.from];
    if (a.at?.kind === 'cell' && a.at.id === C.id) {
      a.setTask(m.what?.pick ?? `${C.id} 픽업으로`, [
        { until: () => m.ready(), label: m.what?.wait ?? `${C.id} 키트 대기` },
        ...this.handover(a, m.pickup, m.what?.tag ?? C.id, m.what?.hand ?? '적재'),
        { do: () => { a.ticket = null; a.load = m.load(a); this.deliver(a); } },
      ]);
      return;
    }
    const leg = this.travel(a, a.at, { kind: 'cell', id: C.id });
    if (!leg) { this.queue.unshift(m); a.mission = null; a.mode = 'park'; return; }
    a.setTask(m.what?.pick ?? `${C.id} 픽업으로`, [
      ...leg,
      ...this.enterStops(a, C, m.stop),
      { until: () => m.ready(), label: m.what?.wait ?? `${C.id} 키트 대기` },
      ...this.handover(a, m.pickup, m.what?.tag ?? C.id, m.what?.hand ?? '적재'),
      { do: () => { a.ticket = null; a.load = m.load(a); this.deliver(a); } },
    ]);
  }

  // 셀과 주고받기: 미션이 pickup/unload 를 주면 셀 쪽 티켓(released 될 때까지 도크에 선다 — 로봇이 집어 들면 출발),
  // 없으면 정해진 4초.
  handover(a, fn, id, what) {
    if (!fn) return [{ wait: 4, label: `${id} ${what} 중` }];
    return [{
      until: () => {
        if (a.ticket?.released) return true;
        if (a.ticket) return false;
        const t = fn(a, id);
        if (t === false) return false;
        a.ticket = t ?? { released: true };
        return !!a.ticket.released;
      },
      label: `${id} ${what} 중`,
    }];
  }

  deliver(a) {
    const m = a.mission;
    const id = m.dest(a.load);
    if (id == null) { this.stage(a); return; }
    const D = this.cells[id];
    const leg = D && this.ok(id) ? this.travel(a, a.at, { kind: 'cell', id }) : null;
    if (!leg) { this.note?.(a, `${id} 도달 불가 — 복귀`); this.abort(a); this.goHome(a, '복귀', a.at); return; }
    a.load.dest = id;
    a.setTask(m.what?.carry?.(id, a.load) ?? `${id}로 키트 #${a.load.id}`, [
      ...leg,
      ...this.enterStops(a, D),
      { until: () => m.canDrop(id), label: `${id} 하역 대기` },
      ...this.handover(a, m.unload, m.what?.dock ?? id, m.what?.drop?.(id) ?? '하역'),
      { do: () => { a.ticket = null; m.drop(a.load, id); a.load = null; a.mission = null; this.after(a); } },
    ]);
  }

  // 받을 곳이 없을 때: 싣은 채 제 충전 자리로 가서(이미 있으면 그대로) 받을 곳이 생기면 다시 나간다.
  stage(a) {
    const m = a.mission, label = `키트 #${a.load.id} 실은 채 대기(받을 셀 없음)`;
    a.load.dest = null;
    const wait = { until: () => m.dest(a.load) != null, label };
    if (a.at.kind === 'home') { a.setTask(label, [wait, { do: () => this.deliver(a) }]); return; }
    const H = this.homes[a.home];
    const leg = this.travel(a, a.at, { kind: 'home', i: a.home });
    if (!leg) { this.note?.(a, '대기 자리로 가는 루트 없음 — 정지'); a.setTask('경로 없음', []); return; }
    a.setTask(label, [...leg, { face: H.heading }, { do: () => { a.at = { kind: 'home', i: a.home }; } }, wait, { do: () => this.deliver(a) }]);
  }

  // 하역 뒤: 배터리가 낮으면 충전, 아니면 대기 미션이 있으면 바로 이어 받고, 없으면 충전 자리로.
  // 같은 접속점에 붙는 칸으로 바로 이어 가면 잠금 두 개를 겹쳐 쥐거나 지선에서 교착이 난다 — 충전 자리로 빠져 다시 받는다.
  // 빈 지그를 실은 차(a.keep: 완료품 적재 구역에서 도어트림만 내림)는 충전 자리로 먼저 간다 — 거기서 지그를 내려놓는다(onHome).
  after(a) {
    if (a.battery < AMR.battery.low) { a.lowLock = true; this.note?.(a, `배터리 ${a.battery.toFixed(0)}% — 충전 복귀`); this.goHome(a, '충전 복귀', a.at); return; }
    if (a.keep) { this.goHome(a, '빈 지그 싣고 복귀', a.at); return; }
    const m = this.queue[0];
    // 입고(SORT:RAW) 직후 북쪽 양팔 도크(SORT) 적재로 이어 가면 충전 왕복을 줄인다. 같은 접속점은 충전 자리로 뺀다.
    // 리프트 셀에서 방금 지그를 올려 준 차는 그 셀 반출(hop)을 그 자리에서 받지 않는다 — 지그 밑에 서 있지 않고 빠진다.
    if (m && !m.raw && this.ok(m.from) && (a.at?.kind === 'cell' && a.at.id === m.from && !m.hop || !this.sameHub(a.at, m.from))) {
      this.queue.shift(); this.start(a, m); return;
    }
    this.goHome(a, '충전 자리 복귀', a.at);
  }

  sameHub(from, toId) {
    if (from?.kind !== 'cell') return false;
    const A = this.cells[from.id], B = this.cells[toId];
    if (!A || !B) return false;
    const a = attach(this.graph, A.entry), b = attach(this.graph, B.entry);
    return !!(a && b && dist(a.point, b.point) < 0.8);
  }

  goHome(a, why, from) {
    a.mode = 'return';
    const H = this.homes[a.home];
    const leg = this.travel(a, from, { kind: 'home', i: a.home });
    if (!leg) {
      a.setTask('경로 없음', []);
      a.mode = 'park';
      this.note?.(a, '충전 자리로 가는 루트 없음 — 정지');
      return;
    }
    a.setTask(why, [...leg, { face: H.heading }, { do: () => { a.mode = 'park'; a.task = '대기'; a.at = { kind: 'home', i: a.home }; this.onHome?.(a); } }]);
  }

  // ── 이동 구간 ──
  // from: {kind:'home',i} | {kind:'cell',id} (도크에 서 있음) | {kind:'free',x,z}. to: {kind:'cell',id} | {kind:'home',i}
  // 반환 단계: 출발(후진 출차·셀 잠금 해제) → 메인 루트 → (셀이면) 진입 대기·잠금 → 접속선 → 입구 / (충전 자리면) 저속 진입.
  travel(a, from, to) {
    const steps = [];
    let start, rev = false, leaveCell = null;
    if (from.kind === 'home') { start = this.homes[from.i]; rev = true; }
    else if (from.kind === 'cell') {
      const C = this.cells[from.id];
      leaveCell = C;
      const last = C.stops.length - 1, dock = from.stop ?? last;
      if (C.dead) {
        steps.push({ go: [C.entry], rev: true }, { do: () => this.freeStop(C.id, dock, a) });
        start = C.entry; rev = true;
      } else {
        // 중간 칸(레인)에서 섰으면 남은 칸을 차례로 잡으며 지나 출구로
        for (let j = dock + 1; j <= last; j++) steps.push(...this.passStop(a, C, j, false));
        steps.push({ go: [C.exit] }, { do: () => this.freeStop(C.id, last, a), pass: true });
        start = C.exit;
      }
    } else start = { x: from.x, z: from.z };
    const B = to.kind === 'cell' ? this.cells[to.id].entry : this.homes[to.i];
    const j = journey(this.graph, start, B);
    if (!j) return null;
    const pts = j.pts;
    if (j.joinOut < j.joinIn) j.joinOut = j.joinIn;
    // 출발: 첫 접속점까지 (후진 출차면 후진). 셀에서 나오면 여기서 잠금을 푼다.
    steps.push({ go: pts.slice(1, j.joinIn + 1), rev });
    if (leaveCell) steps.push({ do: () => this.release(leaveCell.id, a) });
    const mid = pts.slice(j.joinIn, j.joinOut + 1);
    if (to.kind === 'cell') {
      const id = to.id, L = pathLength(mid);
      const at = this.holdAt(mid, L, this.cells[id].dead && id === 'OUT');
      const wait = () => { a.waitFor = id; const ok = this.acquire(id, a); if (ok) a.waitFor = null; return ok; };
      if (at === null) {
        // 접속점끼리 너무 가까워 구역 밖 대기 자리가 없다 → 출발 전에(지금 자리에서) 잠금부터 잡는다.
        steps.unshift({ do: () => { a.bound = id; } }, { until: wait, label: `${id} 진입 대기` });
        steps.push({ go: [...mid.slice(1), ...pts.slice(j.joinOut + 1)] });
        return steps.filter((s) => !s.go || s.go.length);
      }
      const [toHold, rest] = cutAt(mid, at);
      // gate 가 성공하면 go·until 두 단계를 건너뛴다(fleet.js).
      steps.push(
        { do: () => { a.bound = id; } },
        { go: toHold, gate: () => this.acquire(id, a) },
        { until: wait, label: `${id} 진입 대기` },
        { go: [...rest, ...pts.slice(j.joinOut + 1)] },
      );
    } else {
      const tail = [...mid.slice(1), ...pts.slice(j.joinOut + 1)];
      const L = pathLength([mid[0] ?? start, ...tail]);
      const [norm, creep] = cutAt([mid[0] ?? start, ...tail], Math.max(0, L - PRE));
      steps.push({ go: norm }, { go: creep, creep: true });
    }
    return steps.filter((s) => !s.go || s.go.length || s.gate);
  }

  // 진입 대기점: 접속점 HOLD m 앞, 교차 구역 안이면 구역 밖까지 더 물러난다(대기 차가 구역을 막지 않게).
  // 완료품 적재 구역(OUT)은 세로 지선이 출차 길과 같으므로 SPUR_HOLD 만큼 더 물러 북쪽 통로 쪽에서 선다.
  holdAt(mid, L, dead = false) {
    const min = dead ? SPUR_HOLD : HOLD;
    for (let d = min; d < L; d += 0.2) {
      const p = cutAt(mid, L - d)[0].at(-1) ?? mid[0];
      if (!this.zones.some((Z) => dist(p, Z) < Z.r + 0.3)) return L - d;
    }
    return null;
  }

  // 입구에서 정차 칸을 하나씩 예약하며 앞으로. dock 칸(기본 마지막)은 저속 진입 후 정렬 — 통과 셀의 중간 칸에서 설 수 있다(SORT 레인).
  // 지나가는 칸은 비어 있으면 서지 않고 이어 달린다(fleet.js: peek·pass 단계는 미리 보고 건너뜀).
  enterStops(a, C, dock = C.stops.length - 1) {
    const steps = [{ do: () => { a.inBranch = C.id; a.waitFor = null; } }];
    let prev = C.entry;
    for (let i = 0; i <= dock; i++) {
      const s = C.stops[i];
      if (i < dock) { steps.push(...this.passStop(a, C, i, true)); prev = s; continue; }
      steps.push({ until: () => this.takeStop(C.id, i, a), label: `${C.id} ${i === C.stops.length - 1 ? '도크' : `${i + 1}칸`} 비기 기다림` });
      const L = dist(prev, s);
      if (L > PRE + 0.2) {
        const k = (L - PRE) / L;
        steps.push({ go: [{ x: prev.x + (s.x - prev.x) * k, z: prev.z + (s.z - prev.z) * k }] }, { go: [s], creep: true });
      } else steps.push({ go: [s], creep: true });
      steps.push({ face: s.heading });
      if (i > 0) steps.push({ do: () => this.freeStop(C.id, i - 1, a) });
    }
    steps.push({ do: () => { a.at = { kind: 'cell', id: C.id, stop: dock }; } });
    return steps;
  }

  // 지나가는 칸 i: 잡고 → 그 칸으로 → 이전 칸 놓기. enter 면 첫 칸 앞(입구)에서 온다.
  passStop(a, C, i, enter) {
    const s = C.stops[i];
    const out = [
      { until: () => this.takeStop(C.id, i, a), peek: true, label: `${C.id} ${i === C.stops.length - 1 ? '도크' : `${i + 1}칸`} 비기 기다림` },
      { go: [s] },
    ];
    if (i > 0 || !enter) out.push({ do: () => this.freeStop(C.id, i - 1, a), pass: true });
    return out;
  }

  // ── 잠금 ──
  acquire(id, a) {
    const L = this.locks[id];
    if (!L) return false;
    if (L.inside.has(a)) { a.inBranch = id; return true; }
    if (!L.line.includes(a)) L.line.push(a);
    if (L.line[0] !== a || L.inside.size >= L.cap) return false;
    L.line.shift();
    L.inside.add(a);
    a.inBranch = id; a.bound = null; a.waitFor = null;
    return true;
  }

  release(id, a) {
    const L = this.locks[id];
    if (L) { L.inside.delete(a); L.line = L.line.filter((k) => k !== a); L.stops = L.stops.map((h) => (h === a ? null : h)); }
    if (a.inBranch === id) a.inBranch = null;
  }

  takeStop(id, i, a) {
    const L = this.locks[id];
    if (L.stops[i] && L.stops[i] !== a) return false;
    L.stops[i] = a;
    return true;
  }

  freeStop(id, i, a) {
    const L = this.locks[id];
    if (L && L.stops[i] === a) L.stops[i] = null;
  }

  // 그리기·스냅샷용 요약
  summary() {
    return {
      queue: this.queue.length,
      locks: Object.fromEntries(Object.entries(this.locks).map(([id, L]) => [id, { inside: [...L.inside].map((a) => a.id), line: L.line.map((a) => a.id) }])),
      issues: this.check.issues,
    };
  }
}
