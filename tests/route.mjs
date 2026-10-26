// AMR 경로 기하·편집: 우측 통행 차로, 접속, 최단 경로, 점검, 교차 구역, Admin 편집 함수.
import { defaultLayout, normalizeLayout, validateLayout } from '../js/sim/layout.js';
import { LANE, attach, cellGeo, cutAt, graphOf, journey, pathLength, routeIssues } from '../js/sim/route.js';
import { junctions, mapOf, routeGeo } from '../js/sim/acs.js';
import { AMR_HOMES_MAX, addExit, addHome, addNode, cycleEdge, moveHandle, removeHandle } from '../js/sim/amrdata.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

console.log('route');
const L = defaultLayout();
const g = graphOf(L.amr.route);
const geo = cellGeo(L);

check('기본 경로 점검 통과', routeIssues(L).issues.length === 0, routeIssues(L).issues.join(' · '));
check('PRESS·SCREW 막다른 셀(1대), SORT 통과 셀(정차 칸 7: 대기 2 · 레인 4 · 듀얼)', geo.PRESS.dead && geo.PRESS.cap === 1 && geo.SCREW.dead && !geo.SORT.dead && geo.SORT.cap === 7);
check('셀 지점은 셀 자리를 따라간다', near(geo.PRESS.stops[0].x, L.cells.PRESS.x - 1.83) && near(geo.SORT.exit.x, L.cells.SORT.x + 8));

// 양방향 간선은 진행 방향 오른쪽으로 LANE: A1→A2(+x 진행)이면 z+LANE, 반대면 z−LANE
const east = journey(g, { x: 0, z: 9.6 }, { x: 8, z: 9.6 });
const west = journey(g, { x: 8, z: 9.6 }, { x: 0, z: 9.6 });
check('우측 통행: 동쪽은 z+0.7, 서쪽은 z−0.7', east.pts.slice(1, -1).every((p) => near(p.z, 12.2 + LANE)) && west.pts.slice(1, -1).every((p) => near(p.z, 12.2 - LANE)));
check('단방향 A0→G0 은 거꾸로 못 간다', journey(g, { x: -22.6, z: 1 }, { x: -22.6, z: 11 }) === null && journey(g, { x: -22.6, z: 11 }, { x: -22.6, z: 1 }) !== null);
const at = attach(g, geo.SORT.entry);
check('SORT 입구는 단방향 G0 간선에 붙는다', at.edge.oneway && near(at.point.z, geo.SORT.entry.z, 1e-6));
check('cutAt 길이 보존', (() => { const p = east.pts; const [a, b] = cutAt(p, 3); return near(pathLength([p[0], ...a]) + pathLength([a.at(-1), ...b]), pathLength(p), 1e-9); })());

// 점검: 루트가 셀을 지나가면 경고, 셀이 루트에서 끊기면 막힌 셀
const through = structuredClone(L);
Object.assign(through.amr.route.nodes.find((n) => n.id === 'G2'), { x: 18, z: -2 });
const r1 = routeIssues(normalizeLayout(through));
check('셀을 지나는 간선 경고', r1.issues.some((s) => s.includes('지남')) && r1.badEdges.size > 0, r1.issues.join(' · '));
const cut = structuredClone(L);
cut.amr.route.edges = cut.amr.route.edges.filter((e) => !(e.a === 'A1' && e.b === 'A2'));
const r2 = routeIssues(normalizeLayout(cut));
check('끊긴 루트 → 도달 불가 셀', r2.badCells.size > 0, r2.issues.join(' · '));

// 교차 구역: 셀 입구·출구 접속점. 가까운 접속점(SORT 출구·PRESS 입구)은 하나로 합친다
const zs = junctions(g, geo);
const shared = zs.find((z) => z.cells.includes('PRESS') && z.cells.includes('SORT'));
check('교차 구역 · SORT 출구와 PRESS 입구는 한 구역 · 동쪽 반출 도크 포함', zs.length >= 5 && !!shared && zs.filter((z) => z.cells.includes('OUT')).length === 1
  && zs.some((z) => z.cells.includes('PRESS:OUT') || z.cells.includes('SCREW:OUT')), zs.map((z) => `${z.cells.join('+')}@${z.x.toFixed(1)},${z.z.toFixed(1)} r${z.r.toFixed(2)}`).join(' '));
check('충전 자리는 교차 구역 밖', L.amr.homes.every((h) => zs.every((z) => Math.hypot(h.x - z.x, h.z - z.z) > z.r + 0.62)));
const map = mapOf(routeGeo(L));
check('그리기용 지도: 간선 12 · 충전 자리 10 · 셀 3 + 완료품 적재 구역 + 동쪽 반출 2 + SORT 뒤쪽 입고 · 충전 자리는 루트를 등진다', map.edges.length === 12 && map.homes.length === 10 && map.cells.length === 7 && !map.cells.find((c) => c.id === 'OUT').bad
  && map.cells.some((c) => c.id === 'PRESS:OUT') && map.cells.some((c) => c.id === 'SCREW:OUT') && map.cells.some((c) => c.id === 'SORT:RAW')
  && map.homes.every((h) => near(h.heading, Math.PI, 1e-6) || near(h.heading, -Math.PI, 1e-6)));

// Admin 편집 함수
const toLocal = (cell, x, z) => ({ x: x - L.cells[cell].x, z: z - L.cells[cell].z });
const m1 = moveHandle(L.amr, { kind: 'stop', cell: 'PRESS', i: 0 }, L.cells.PRESS.x - 2, L.cells.PRESS.z + 0.1, toLocal);
check('셀 지점 이동은 셀 로컬로 저장', near(m1.cells.PRESS.stops[0].x, -2) && near(m1.cells.PRESS.stops[0].z, 0.1) && L.amr.cells.PRESS.stops[0].x === -1.83);
const n1 = addNode(L.amr, 0, 6, 'A1');
check('노드 추가 + 선택 노드와 연결', n1.amr.route.nodes.some((n) => n.id === n1.id) && n1.amr.route.edges.some((e) => e.a === 'A1' && e.b === n1.id));
const c1 = cycleEdge(L.amr, 'A1', 'G1'), c2 = cycleEdge(c1.amr, 'A1', 'G1'), c3 = cycleEdge(c2.amr, 'A1', 'G1');
check('간선 바꾸기: 양방향 → 단방향 → 없음 → 양방향', c1.state === 'oneway' && c2.state === 'none' && c3.state === 'two-way');
check('도크·입구·마지막 충전 자리는 못 지움', removeHandle(L.amr, { kind: 'stop', cell: 'PRESS', i: 0 }) === null
  && removeHandle(L.amr, { kind: 'entry', cell: 'PRESS' }) === null
  && removeHandle({ ...L.amr, homes: [L.amr.homes[0]] }, { kind: 'home', i: 0 }) === null);
check(`충전 자리 상한 ${AMR_HOMES_MAX}`, addHome(L.amr, 0, 6) === null && addHome({ ...L.amr, homes: L.amr.homes.slice(1) }, 0, 6).homes.length === AMR_HOMES_MAX);
const x1 = addExit(L.amr, 'PRESS');
check('출구 추가 → 통과 셀', !!x1.cells.PRESS.exit && cellGeo({ ...L, amr: x1 }).PRESS.dead === false);
const rmNode = removeHandle(L.amr, { kind: 'node', id: 'A2' });
check('노드 지우면 붙은 간선도 지움 → 구조 검증은 통과, 점검에서 SCREW 도달 불가', validateLayout({ ...L, amr: rmNode }).length === 0
  && routeIssues(normalizeLayout({ ...L, amr: rmNode })).badCells.has('SCREW'));

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
