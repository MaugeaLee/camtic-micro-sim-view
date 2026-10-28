// 레이아웃: 스냅·바닥 안·겹침. 기본 자리가 통과하는지.
import { CELLS } from '../js/sim/cells.js';
import { FIELD } from '../js/render/field-def.js';
import {
  DEFAULT_POSES, FIELD_SIZE, FOOTPRINT, LAYOUT_VERSION, SNAP, canPlace, defaultLayout, layoutStamp, moveCell,
  moveItem, moveSpurEnd, normalizeLayout, overlaps, placeItem, poseOf, rotateSpur, snapCoord, snapRot, toLocal, toWorld, translateSpur, validateLayout,
} from '../js/sim/layout.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('layout');
const ids = CELLS.map((c) => c.id).join();
check('셀 3개 자리', Object.keys(DEFAULT_POSES).sort().join() === 'PRESS,SCREW,SORT' && ids === 'PRESS,SCREW,SORT');
check('필드 크기 = field-def', FIELD_SIZE.w === FIELD.size.w && FIELD_SIZE.d === FIELD.size.d);

const base = defaultLayout();
check('기본 레이아웃 통과', validateLayout(base).length === 0, validateLayout(base).join(' · '));
check('버전·스냅', base.version === LAYOUT_VERSION && base.snap === SNAP);
check('스냅 반올림', snapCoord(1.4) === 1 && snapCoord(1.6) === 2);
check('회전 스냅', snapRot(40) === 0 && snapRot(50) === 90 && snapRot(-10) === 0 && snapRot(270) === 270);

check('음수 스냅 거부', validateLayout({ ...base, snap: 0 }).length > 0);
check('셀 빠지면 거부', validateLayout({ ...base, cells: { PRESS: base.cells.PRESS, SCREW: base.cells.SCREW } }).length > 0);
check('바닥 밖 거부', validateLayout({ ...base, cells: { ...base.cells, PRESS: poseOf(-40, 0) } }).length > 0);

const clash = moveCell(base, 'PRESS', poseOf(0, -2));
check('겹치면 거부', clash.ok === false && clash.errors.some((e) => e.includes('겹침')));

check('기본 순서 서→동 SORT · PRESS · SCREW', base.cells.SORT.x < base.cells.PRESS.x && base.cells.PRESS.x < base.cells.SCREW.x);

const ok = moveCell(base, 'PRESS', poseOf(4, 6));
check('빈 칸 이동', ok.ok === true && ok.doc.cells.PRESS.z === 6 && validateLayout(ok.doc).length === 0);

const rot = poseOf(4, -2, 90);
check('90°는 발자국 교환 후에도 기본 자리 안', canPlace({ ...base, cells: { ...base.cells, PRESS: rot } }, 'PRESS', rot).length === 0);
check('모르는 셀 거부', canPlace(base, 'A-3-1', poseOf(0, 0)).length > 0);

const n = normalizeLayout({ version: 1, snap: 1, cells: { PRESS: { x: 3.6, z: -1.8, rotY: 10 }, SCREW: base.cells.SCREW, SORT: base.cells.SORT } });
check('정규화 스냅', n.cells.PRESS.x === 4 && n.cells.PRESS.z === -2 && n.cells.PRESS.rotY === 0);

// v2: AMR 경로·충전 자리·셀 지점
check('v1 문서는 v2로 읽고 기본 AMR 경로를 붙인다', n.version === LAYOUT_VERSION && LAYOUT_VERSION === 2 && JSON.stringify(n.amr) === JSON.stringify(base.amr));
check('기본 충전 자리 6개', base.amr.homes.length === 6);
const badEdge = structuredClone(base);
badEdge.amr.route.edges.push({ a: 'A0', b: 'NOPE' });
check('없는 노드 간선 거부', validateLayout(badEdge).some((e) => e.includes('NOPE')), validateLayout(badEdge).join(' · '));
const noDock = structuredClone(base);
noDock.amr.cells.PRESS.stops = [];
check('정차 칸 없는 셀 거부', validateLayout(noDock).length > 0);
const out = structuredClone(base);
out.amr.homes[0] = { x: 99, z: 0 };
check('바닥 밖 충전 자리 거부', validateLayout(out).length > 0);
const pose = { x: 4, z: -2, rotY: 90 }, p = { x: -1.83, z: 0.4 };
const w = toWorld(pose, p), back = toLocal(pose, w);
check('셀 로컬 ↔ 필드 왕복', Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.z - p.z) < 1e-9);
check('rotY 90°: 로컬 −x → 필드 +z (three rotation.y 와 같은 방향)', Math.abs(toWorld(pose, { x: -1, z: 0 }).z - (-2 + 1)) < 1e-9);
check('스탬프에 AMR 경로 포함', layoutStamp(base) !== layoutStamp({ ...base, amr: { ...base.amr, homes: base.amr.homes.slice(1) } }));

// 완료품 적재 구역(OUT): 셀이 아닌 자리. 예전 파일(sites 없음)도 읽고 기본 자리를 붙인다.
{
  const old = JSON.parse(JSON.stringify(base));
  delete old.sites; delete old.amr.cells.OUT;
  const n = normalizeLayout(old);
  check('sites 없는 예전 파일도 통과 · 기본 OUT 자리·AMR 지점 붙음', validateLayout(old).length === 0 && n.sites.OUT && n.amr.cells.OUT?.stops.length === 1, JSON.stringify(n.sites));
  const bad = { ...base, sites: { OUT: { x: DEFAULT_POSES.PRESS.x, z: DEFAULT_POSES.PRESS.z, rotY: 0 } } };
  check('OUT 이 셀과 겹치면 오류', validateLayout(bad).some((e) => e.includes('OUT·PRESS')), validateLayout(bad).join(' · '));
  check('모르는 자리면 오류', validateLayout({ ...base, sites: { XX: { x: 0, z: 0 } } }).some((e) => e.includes('XX')));
  check('OUT 빈 칸 이동', canPlace(base, 'OUT', poseOf(-30, 4)).length === 0);
  const moved = moveItem(base, 'OUT', poseOf(-28, -2));
  const a4 = moved.doc.amr.route.nodes.find((n) => n.id === 'A4');
  const g4 = moved.doc.amr.route.nodes.find((n) => n.id === 'G4');
  check('OUT 을 옮겨도 A4·G4 지선은 그대로', moved.ok && a4.x === -30 && g4.x === -30 && a4.z === 12.2 && g4.z === 3, JSON.stringify({ a4, g4, err: moved.errors }));
  const rail = translateSpur(base, 'OUT', 2, 0);
  check('이동 레일만 옮기면 OUT 자리는 그대로 · A4·G4 만 +x', rail.sites.OUT.x === -30
    && rail.amr.route.nodes.find((n) => n.id === 'A4').x === -28
    && rail.amr.route.nodes.find((n) => n.id === 'G4').x === -28);
  const rotOut = placeItem(base, 'OUT', poseOf(-30, -2, 90));
  const a4r = rotOut.amr.route.nodes.find((n) => n.id === 'A4');
  check('OUT 회전해도 지선은 그대로', a4r.x === -30 && a4r.z === 12.2, JSON.stringify(a4r));
  const stretch = moveSpurEnd(base, 'OUT', 1, -30, 8);
  const g4s = stretch.amr.route.nodes.find((n) => n.id === 'G4');
  const a4s = stretch.amr.route.nodes.find((n) => n.id === 'A4');
  check('끝점을 옮기면 G4만 이동 · 길이 바뀜', a4s.x === -30 && a4s.z === 12.2 && g4s.x === -30 && g4s.z === 8
    && stretch.sites.OUT.x === -30 && stretch.sites.OUT.z === -2, JSON.stringify({ a4s, g4s }));
  const spun = rotateSpur(base, 'OUT', 90);
  const a4t = spun.amr.route.nodes.find((n) => n.id === 'A4');
  const g4t = spun.amr.route.nodes.find((n) => n.id === 'G4');
  check('레일 90° 회전은 중점 기준 · OUT 그대로', Math.hypot(a4t.x + 25.4, a4t.z - 7.6) < 0.02
    && Math.hypot(g4t.x + 34.6, g4t.z - 7.6) < 0.02
    && spun.sites.OUT.x === -30 && spun.sites.OUT.z === -2 && spun.sites.OUT.rotY === 0, JSON.stringify({ a4t, g4t }));
}

// 부속 부품 AMR 루트(parts): 도어트림 루트(amr)와 따로. 창고 PARTS 자리 · 라인 도크 「셀:라인」(셀 로컬).
{
  check('기본: 부품 창고 자리 · 부품 루트 · 충전 자리 6 · 도크 8 + 창고 + SORT 투입 · 원재료는 지개차', !!base.sites.PARTS && base.parts.homes.length === 6
    && Object.keys(base.parts.cells).length === 10 && !base.parts.cells.STORE && !base.parts.cells['SORT:RAW'] && !!base.parts.cells['PRESS:L01'] && !!base.parts.cells.PARTS
    && base.parts.cells['SORT:IN']?.exit === null && base.parts.cells['SORT:IN'].stops.length === 1
    && Object.keys(base.jack.cells).length === 2 && !!base.jack.cells.STORE && base.jack.cells['SORT:RAW']?.exit === null && base.jack.homes.length === 2);
  check('SORT 도어트림 정지점 7: 대기 2 · 레인 A–D · 듀얼', base.amr.cells.SORT.stops.length === 7);
  check('도어트림 루트에는 부품·창고 도크가 없다 · PRESS·SCREW 는 통과 리프트 셀(따로 반출 도크 없음) · SORT 뒤쪽 입고는 지개차 루트',
    !Object.keys(base.amr.cells).some((id) => id === 'PARTS' || id === 'STORE' || id === 'SORT:IN' || id === 'SORT:RAW' || id.includes(':L'))
    && !base.amr.cells['PRESS:OUT'] && !base.amr.cells['SCREW:OUT'] && !base.amr.route.nodes.some((n) => /^R\d/.test(n.id))
    && ['PRESS', 'SCREW'].every((id) => base.amr.cells[id].stops.length === 1 && !!base.amr.cells[id].exit));
  const old = JSON.parse(JSON.stringify(base));
  delete old.parts; delete old.sites.PARTS;
  const n = normalizeLayout(old);
  check('parts 없는 예전 파일도 통과 · 기본 부품 루트·창고 붙음', validateLayout(old).length === 0 && JSON.stringify(n.parts) === JSON.stringify(base.parts) && !!n.sites.PARTS);
  const noStore = JSON.parse(JSON.stringify(base));
  delete noStore.sites.STORE; delete noStore.jack;
  const ns = normalizeLayout(noStore);
  const S = base.sites.STORE, cellsOk = ['SORT', 'PRESS', 'SCREW'].every((c) => !overlaps('STORE', S, c, base.cells[c]))
    && ['OUT', 'PARTS'].every((c) => !overlaps('STORE', S, c, base.sites[c]));
  const Pw = base.sites.PARTS, touch = Math.abs((S.x - FOOTPRINT.STORE.w / 2) - (Pw.x + FOOTPRINT.PARTS.w / 2)) < 1e-9 && S.z === Pw.z;
  check('원재료 창고 STORE: 부품 창고 동쪽에 붙음(같은 줄 · 틈 0) · 셀·자리와 안 겹침 · 지개차 도크 · 예전 파일에도 붙음', !!S && touch && cellsOk && !!base.jack.cells.STORE
    && validateLayout(noStore).length === 0 && ns.sites.STORE?.x === S.x && !!ns.jack.cells.STORE, JSON.stringify(S));
  const bad = structuredClone(base);
  bad.parts.route.edges.push({ a: 'Q0', b: 'NOPE' });
  check('부품 루트 오류는 「부품 AMR」 머리로', validateLayout(bad).some((e) => e.startsWith('부품 AMR') && e.includes('NOPE')), validateLayout(bad).join(' · '));
  const badJack = structuredClone(base);
  badJack.jack.route.edges.push({ a: 'Q0', b: 'NOPE' });
  check('지개차 루트 오류는 「지개차 AMR」 머리로', validateLayout(badJack).some((e) => e.startsWith('지개차 AMR') && e.includes('NOPE')), validateLayout(badJack).join(' · '));
  const doc = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../src/process.default.json', import.meta.url), 'utf8'));
  const off = [];
  for (const [id, C] of Object.entries(doc.cells)) for (const L of C.lines ?? []) {
    const d = base.parts.cells[`${id}:${L.id}`];
    const north = L.gantry.stock > 0;
    if (!d || Math.abs(d.stops[0].x - L.x) > 1e-9 || Math.sign(d.stops[0].z) !== (north ? 1 : -1)) off.push(`${id}:${L.id}`);
  }
  check('라인 도크 x = 공정 정의 라인 x · 적재 팔레트 쪽(남·북)', off.length === 0, off.join(','));
  const P = base.sites.PARTS, hw = FOOTPRINT.PARTS.w / 2;
  const sub = base.parts.homes, west = sub.filter((h) => h.x < P.x - hw), east = sub.filter((h) => h.x > P.x + hw);
  check('부품 충전 자리는 창고 좌우(서 2 · 동 4 · 도크 앞 아님) · 도어트림은 북쪽 통로 한 줄 6',
    base.amr.homes.length === 6 && base.amr.homes.every((h, i) => h.z === 9.6 && (!i || Math.abs(h.x - base.amr.homes[i - 1].x + 1.4) < 1e-6))
    && west.length === 2 && east.length === 4 && west.concat(east).every((h) => h.z === -13.4)
    && !sub.some((h) => Math.abs(h.x - P.x) < 2),
    JSON.stringify({ trim: base.amr.homes, sub, P }));
}

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
