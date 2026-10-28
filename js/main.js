// 조립 루트: 부트 · rAF 루프 · 모듈 배선. 모듈끼리는 서로 import 하지 않고 여기서만 잇는다.
import * as THREE from 'three';
import { MAX_STEP, NO_SERVER } from './core/env.js';
import { runtime, assetUrl, apiPath, processUrl } from './core/runtime.js';
import { CELLS } from './sim/cells.js';
import { FOOTPRINT, SITES, SITE_SPUR, canPlace, defaultLayout, extent, layoutStamp, normalizeLayout, partsLayout, placeItem, placeOf, poseOf, toLocal, translateSpur, moveSpurEnd, rotateSpur, validateLayout } from './sim/layout.js';
import { ViewerState } from './sim/state.js';
import { findEquip } from './sim/equip.js';
import { AMR_MAX, DEFAULT_SCENARIO, SCENARIOS } from './sim/scenario.js';
import { mapOf, routeGeo } from './sim/acs.js';
import { AMR } from './sim/fleet.js';
import { addExit, addHome, addNode, cycleEdge, moveHandle, removeHandle } from './sim/amrdata.js';
import { dockIssues } from './sim/supply.js';
import { DURATIONS, EVENTS, FAULT_WHY, FLEETS, FLEET_LABEL, FLEET_SPEEDS, SUPPLY, SUPPLY_MODE } from './sim/incidents.js';
import { DataHub } from './data/hub.js';
import { clearLocal, dumpPlant, fingerprint, pickPlant, readLocal, restoreOk, restoreTime, validatePlant, writeLocal } from './data/plant.js';
import { equipmentStatus } from './data/monitor.js';
import { ProcessTrace } from './data/trace.js';
import { createStage } from './render/stage.js';
import { CellView } from './render/view.js';
import { FleetView } from './render/fleet.js';
import { CameraRig } from './render/camera.js';
import { Picker } from './render/pick.js';
import { CCTV, FIELD, MONITOR, validateMonitor } from './render/field-def.js';
import { ControlMonitor } from './render/monitor.js';
import { buildField } from './render/field.js';
import { PlaceTool } from './render/place.js';
import { RouteEditTool } from './render/route-edit.js';
import { RigView } from './render/rigs.js';
import { PartsView } from './render/parts.js';
import { OutSiteView } from './render/outsite.js';
import { PartsSiteView } from './render/partsite.js';
import { StoreSiteView } from './render/storesite.js';
import { HoundView } from './render/hound.js';
import { DroneView } from './render/drone.js';
import { DRONE } from './sim/drone.js';
import { LiftView } from './render/lifts.js';
import { EquipView } from './render/equip.js';
import { TagLayer } from './render/tags.js';
import { amrTag, equipTag, robotTag, siteTag } from './render/label-text.js';
import { mainAmrModel, mainAmrNodes } from './render/mainamr.js';
import { RENDER, assetFrame, assetRig, loadAssets, loadModel, cloneAsset } from './assets/loader.js';
import { scanMovers } from './assets/scan.js';
import { baseName } from './assets/rigdata.js';
import { UI } from './ui/ui.js';

const params = new URLSearchParams(location.search);
const AUTOLOAD = params.get('assets') !== '0';
const LAYOUT_POLL = 2000;
// ?scenario=supply|faults|none · ?amr=1..AMR_MAX (기본: 시나리오 값) · ?play=1 자동 재생 · ?build=1|route Admin(셀 배치|AMR 경로)
// ?process=0 셀 공정 정의 끔(예전 사이클 타이머만) · ?fresh=1 저장된 공장 상태를 읽지 않음
const scenarioParam = params.get('scenario');
let scenarioKey = scenarioParam === 'none' ? null : SCENARIOS[scenarioParam] ? scenarioParam : DEFAULT_SCENARIO;
const amrParam = Number(params.get('amr'));
const AMR_COUNT = Number.isInteger(amrParam) && amrParam >= 1 && amrParam <= AMR_MAX ? amrParam : null;
// ?drones=0..3 드론 대수(기본: 시나리오 값) · ?inspect=0 점검 견마 끔
const droneParam = params.get('drones') == null ? NaN : Number(params.get('drones'));
const DRONES = Number.isInteger(droneParam) && droneParam >= 0 && droneParam <= DRONE.pads.length ? droneParam : undefined;
const INSPECT_ON = params.get('inspect') === '0' ? false : undefined;
const FRESH = params.get('fresh') === '1';
const WARP_AT = Number(params.get('warp'));
const persistSkip = FRESH || WARP_AT > 0;
let amrCount = AMR_COUNT;
let dronesCount = DRONES;
let inspectOn = INSPECT_ON;
let restoring = false;

// 장 B 구독·수신 점검은 서버가 있어야 한다(정적 호스팅에서는 숨김)
if (NO_SERVER) document.getElementById('lnkDash')?.setAttribute('hidden', '');
const stage = createStage(document.getElementById('viewport'));
const field = buildField(stage.scene, FIELD);
stage.fitShadow(FIELD.size.w, FIELD.size.d);
// 관제 모니터(뒷벽 · 내부 CCTV). ?cctv=0 이면 끔(저사양).
const monitor = params.get('cctv') === '0' ? null : new ControlMonitor(stage, FIELD, MONITOR, CCTV);
const view = new CellView(stage.scene);
const fleetView = new FleetView(stage.scene);
// 부속 부품 AMR: 노란 차체 · 청록 통로선(도어트림 AMR 흰 차체 · 노란 통로선과 구분)
const partsFleetView = new FleetView(stage.scene, { fleet: 'parts', body: 0xf2c14e, lane: 0x3fb6c9, skipCells: ['SORT'] });
const rigView = new RigView();
const partsView = new PartsView(stage.scene);
const outView = new OutSiteView(stage.scene);
const depotView = new PartsSiteView(stage.scene, FOOTPRINT.PARTS);
const storeView = new StoreSiteView(stage.scene, FOOTPRINT.STORE);
const houndView = new HoundView(stage.scene);
const inspectView = new HoundView(stage.scene, { id: 'HOUND-02', scan: 0x3fd0e6 });
const droneView = new DroneView(stage.scene, DRONE.pads);
const liftView = new LiftView();
const equipView = new EquipView(stage.scene);
const tags = new TagLayer(stage.scene);
const rig = new CameraRig(stage);
const hub = new DataHub();
const ui = new UI({
  onPlay: () => { state.setRunning(!state.running); savePlant(); },
  onSpeed: (x) => { state.setSpeed(x); savePlant(); },
  onSelect: (id) => {
    if (!tracing()) camKit = false;
    state.select(state.selected === id ? null : id);
    if (place) place.selected = state.selected;
  },
  onFollow: (id) => { if (!tracing()) camKit = false; state.follow(state.followed === id ? null : id); },
  onScenario: (key) => { scenarioKey = key; start(); savePlant(); },
  onReset: () => resetPlant(),
  onPlace: (id) => {
    if (!place) return;
    place.pick(id);
    place.selected = id;
    if (state.cell(id)) state.select(id);
  },
  onDownload: downloadLayout,
  onImport: importLayoutFile,
  onSave: saveLayout,
  onAdmin: () => setAdmin(!admin),
  onBuildMode: (mode) => setBuildMode(mode),
  onDetailClose: () => { state.select(null); state.follow(null); },
  onTrace: () => toggleTrace(),
  onTraceClose: () => closeTrace(),
  onLabels: (on) => { view.setLabels(on); tags.setLabels(on); },
  onInject: (spec) => {
    try { state.inject(spec); savePlant(); }
    catch (e) { state.log('warn', '주입 안 됨', { obs: e.message }); }
    refreshUi();
  },
  onClearIncident: (no) => { if (state.clearIncident(no)) savePlant(); refreshUi(); },
  onFleetSpeed: (fleet, x) => { state.setFleetSpeed(fleet, x); savePlant(); refreshUi(); },
  onFleetHalt: (fleet, on) => { state.setFleetHalt(fleet, on); savePlant(); refreshUi(); },
  onCctv: (act) => cctvAction(act),
});

ui.setCatalog({ durations: DURATIONS, events: EVENTS, faultWhy: FAULT_WHY, fleets: FLEETS, fleetLabel: FLEET_LABEL, fleetSpeeds: FLEET_SPEEDS, supply: SUPPLY, supplyMode: SUPPLY_MODE });
ui.setCctv(!!monitor);

// 하단 CCTV: 뒷벽 관제 모니터 켜기·끄기 · 카메라를 모니터 앞으로.
function cctvAction(act) {
  if (!monitor) { state.log('warn', 'CCTV 꺼짐', { obs: '?cctv=0 으로 관제 모니터를 만들지 않음' }); return; }
  if (act === 'toggle') {
    monitor.setEnabled(!monitor.enabled);
    if (monitor.enabled) monitor.refresh();
    state.log('info', `관제 모니터 ${monitor.enabled ? '켬' : '끔'}`, { obs: `내부 CCTV ${CCTV.length}대 · 가상 카메라` });
  }
  if (act === 'view') {
    if (!monitor.enabled) { monitor.setEnabled(true); monitor.refresh(); }
    if (tracing()) return;
    state.select(null); state.follow(null);
    const p = monitor.root.position;
    rig.follow(null);
    rig.start(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(p.x, p.y - 0.6, p.z + MONITOR.w * 0.95));
  }
  ui.setCctv(monitor.enabled);
}
const trace = new ProcessTrace();
let camKit = false;
let lastFocus = '';
let viewBefore = null;

// 패널·장비 모니터 갱신. 모니터는 선택한 셀 또는 따라가는 AMR·로봇의 상태 문서(JSON)를 그린다.
function refreshUi() {
  ui.update(state);
  ui.setDetail(admin ? null : equipmentStatus(state, state.selected ?? state.followed));
  ui.setTrace(admin || trace.mode === 'off' ? null : trace.view(state));
}

function toggleTrace() {
  if (trace.mode === 'wait' || trace.mode === 'run') { closeTrace(); return; }
  if (!state.plant?.route) {
    state.log('warn', '공정 추적 불가', { obs: '공정 순서(route)가 없습니다. ?process=0 이면 꺼져 있음' });
    return;
  }
  trace.start(state);
  holdTraceCamera(true);
  if (!state.running) state.setRunning(true);
  state.log('info', '공정 추적 대기', { obs: '다음 입고 도어트림을 처음부터 적재 구역까지 · 가정 공정' });
  refreshUi();
}

function tracing() {
  return trace.mode === 'wait' || trace.mode === 'run';
}

// 추적 중에는 궤도·클릭이 카메라를 가져가지 않는다. 해제는 상단 버튼(또는 추적 패널 닫기).
function holdTraceCamera(on) {
  stage.controls.enabled = !on;
}

function closeTrace() {
  const was = trace.mode;
  if (was === 'wait' || was === 'run') {
    trace.stop();
    state?.log('info', '공정 추적 중지');
  } else {
    trace.stop();
  }
  if (camKit) { rig.follow(null); camKit = false; }
  lastFocus = '';
  viewBefore = null;
  holdTraceCamera(false);
  ui.setTrace(null);
}

function syncTrace() {
  const before = trace.mode;
  const doc = trace.tick(state);
  if (before === 'wait' && trace.mode === 'run') {
    const who = trace.no ?? trace.kit;
    state.log('info', who != null ? `공정 추적 시작 키트 #${who}` : '공정 추적 시작', { obs: '입고 AMR 출발 · 가정 공정' });
  }
  if (before === 'run' && trace.mode === 'done') {
    const R = trace.report;
    state.log(R?.ok ? 'info' : 'warn', `공정 추적 ${R?.ok ? '완료' : '중단'} 키트 #${trace.no ?? trace.kit}`,
      { obs: `${(R?.visits ?? []).join(' → ')} · ${R?.elapsed ?? '—'} s · 이전 화면으로` });
    restoreView();
  } else if (trace.mode === 'run') {
    const f = trace.focus(state);
    const key = f ? `${f.kind}:${f.id}` : '';
    if (key && key !== lastFocus) {
      lastFocus = key;
      aimTrace();
    }
  }
  ui.setTrace(admin || doc.mode === 'off' ? null : doc);
}

function rememberView() {
  if (viewBefore) return;
  viewBefore = { target: stage.controls.target.clone(), position: stage.camera.position.clone() };
}

function restoreView() {
  camKit = false;
  lastFocus = '';
  const back = viewBefore;
  viewBefore = null;
  rig.follow(null);
  holdTraceCamera(false);
  if (back) rig.start(back.target, back.position);
  else rig.reset();
}

function focusTarget(f) {
  if (!f) return null;
  if (f.kind === 'amr') return fleetView.focusOf(f.id, state) ?? partsFleetView.focusOf(f.id, state);
  if (f.kind === 'cell') return view.focusOf(f.id);
  const p = placeOf(layout, f.id);
  if (!p) return null;
  const fp = FOOTPRINT[f.id] ?? { w: 5, d: 5 };
  return { center: new THREE.Vector3(p.x, 1.2, p.z), size: Math.max(fp.w, fp.d) };
}

function aimTrace() {
  rememberView();
  const at = () => focusTarget(trace.focus(state));
  const now = at();
  if (!now) return;
  camKit = true;
  rig.focus(now);
  const f = trace.focus(state);
  if (f?.kind === 'amr') rig.follow(() => at()?.center ?? null);
  else rig.follow(null);
}
ui.setScenarios([{ key: '', label: '시나리오 없음' }, ...Object.entries(SCENARIOS).map(([key, s]) => ({ key, label: s.label }))], scenarioKey);

const picker = new Picker(stage, [
  { meshes: () => [...fleetView.pickables(), ...partsFleetView.pickables(), ...houndView.pickables(), ...inspectView.pickables(), ...droneView.pickables()], key: 'amrId' },
  { meshes: () => equipView.pickables(), key: 'partId' },
  { meshes: () => view.pickables(), key: 'cellId' },
], (hit) => {
  if (tracing()) return;
  camKit = false;
  if (hit?.amrId) state.follow(state.followed === hit.amrId ? null : hit.amrId);
  else if (hit?.partId) state.follow(state.followed === hit.partId ? null : hit.partId);
  else if (hit?.cellId) state.select(state.selected === hit.cellId ? null : hit.cellId);
  else { state.select(null); state.follow(null); }
});

let state = null;
let layout = defaultLayout();
let processDoc = null;
let mainModel = null;   // 메인 AMR 차체(셀 GLB AMR_MAIN_JIG 복제) — 리프트 셀 GLB 가 붙으면 만든다
let place = null;
let routeTool = null;
let pollTimer = null;
const buildParam = params.get('build');
let admin = buildParam === '1' || buildParam === 'route' || buildParam === 'parts';
let buildMode = buildParam === 'route' || buildParam === 'parts' ? buildParam : 'cells';

// 경로 편집 함수. 셀 지점은 셀 로컬로 저장하므로 지금 레이아웃의 셀 자리로 바꾼다.
const routeOps = {
  move: (amr, ref, x, z) => moveHandle(amr, ref, x, z, (cell, px, pz) => toLocal(placeOf(layout, cell), { x: px, z: pz })),
  addNode, addHome, remove: removeHandle, cycle: cycleEdge, addExit,
  mapOf: (doc) => mapOf(routeGeo(doc)),
};

// 부품 AMR 루트·도킹 자리 편집. SORT 셀(레인 칸)은 도어트림 루트와 같은 칸이라 그쪽(layout.amr)에 쓴다.
const partsOps = {
  ...routeOps,
  get: (doc) => partsLayout(doc).amr,
  put: (doc, amr) => {
    const { SORT, ...cells } = amr.cells;
    return { ...doc, amr: SORT ? { ...doc.amr, cells: { ...doc.amr.cells, SORT } } : doc.amr, parts: { ...amr, cells } };
  },
  mapOf: (doc) => mapOf(routeGeo(partsLayout(doc))),
};

function start() {
  const running = state?.running ?? params.get('play') === '1';
  const speed = state?.speed ?? 1;
  state = new ViewerState({ cells: CELLS, scenario: scenarioKey, layout, amr: amrCount, process: processDoc, drones: dronesCount, inspect: inspectOn });
  partsView.clear();
  equipView.clear();
  view.setup(state, { extent });
  view.applyLayout(layout);
  aimCctv();
  fleetView.setTop(state.plant?.proc ? state.plant.proc.deck : null);
  fleetView.setModel(state.plant?.proc ? mainModel : null);
  fleetView.setup(state);
  partsFleetView.setTop(processDoc?.supply?.top ?? null);
  partsFleetView.setup(state);
  showStaticMap();
  rig.follow(null);
  camKit = false;
  lastFocus = '';
  viewBefore = null;
  holdTraceCamera(false);
  trace.stop();
  hub.reset();
  for (const c of state.cells) if (RENDER.loaded.has(c.asset)) mount(c);
  const rt = runtime();
  state.log('info', '뷰어 시작', { obs: `셀 ${state.cells.length}개 · 서버 ${NO_SERVER ? '없음' : (rt ? `${rt.host}:${rt.port}` : '설정 없음')}` });
  if (state.plant) {
    const trim = state.fleet('trim').amrs.length, sub = state.fleet('parts').amrs.length;
    state.log('info', `시나리오: ${SCENARIOS[scenarioKey].label}`, { obs: `ACS 관제 도어트림 AMR ${trim}대${sub ? ` · 부속 부품 AMR ${sub}대(따로 루트)` : ''} · 사이클 시간은 가정값` });
    if (processDoc) state.log('info', '셀 공정 정의 적용(가정)', { obs: `키트·부품 엔티티 · ${Object.keys(state.plant.work).join('·') || '없음'} 셀 안 공정` });
  }
  logRouteIssues();
  if (monitor) {
    const errs = validateMonitor(MONITOR, CCTV, FIELD, [...Object.keys(layout.cells), ...Object.keys(layout.sites ?? {})]);
    if (errs.length) state.log('warn', '관제 모니터 정의 점검', { obs: errs.join(' · ') });
    else state.log('info', '관제 모니터', { obs: `뒷벽 화면 · 내부 CCTV ${CCTV.length}대(가상 카메라, 가정) · 녹화·감지 없음` });
  }
  state.setSpeed(speed);
  if (running) state.setRunning(true);
  ui.reset(state);
  ui.setDetail(null);
  ui.setAdmin(admin, state.cells, buildMode);
  if (admin) state.log('info', 'Admin 모드', { obs: buildHint() });
}

// CCTV 는 셀·자리를 겨눈다 — 배치가 바뀌면 따라간다.
function aimCctv() {
  if (!monitor) return;
  monitor.setPlaces((id) => placeOf(layout, id));
}

const hms = (t) => [t / 3600, (t / 60) % 60, t % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':');

// 시나리오가 없으면 ACS 가 없으니 레이아웃에서 지도를 바로 만든다.
function showStaticMap() {
  if (state?.plant) return;
  fleetView.showMap(routeOps.mapOf(layout));
  partsFleetView.showMap(layout.parts ? routeOps.mapOf(partsLayout(layout)) : null);
}

function logRouteIssues() {
  const issues = [...routeGeo(layout).check.issues, ...routeGeo(partsLayout(layout)).check.issues.map((t) => `부품 AMR ${t}`), ...dockIssues(layout, processDoc)];
  if (issues.length) state.log('warn', `AMR 경로 점검 ${issues.length}건`, { obs: issues.slice(0, 4).join(' · ') });
}

function mount(cell) {
  const obj = cloneAsset(cell.asset);
  if (!obj) return;
  view.attach(cell.id, obj, assetFrame(cell.asset));
  view.applyLayout(layout);
  state.markLoaded(cell.id);
  if (state.plant) hideAssetAmrs(cell, obj);
  hideFeedProps(cell, obj);
  bindRig(cell, obj);
  bindLift(cell, obj);
  equipView.bind(cell.id, {
    obj,
    work: state.plant?.work[cell.id],
    rigCell: rigView.cells.get(cell.id),
    liftRoot: liftView.cells.get(cell.id)?.root,
  });
}

// 리프트 셀(PRESS·SCREW): GLB 의 AMR_MAIN_JIG(= 메인 AMR 자세 인스턴스)를 숨기고 리프트 기둥·클립을 붙인다.
// 처음 붙는 리프트 셀의 AMR_MAIN_JIG 로 도어트림 플릿 차체 모델을 만든다(차체 가로 = 시뮬 AMR 치수 · 지그 상판 = 지그 + 여유).
function bindLift(cell, obj) {
  liftView.detach(cell.id);
  const L = state.plant?.work[cell.id]?.view?.().lift;
  if (!L) return;
  const nodes = mainAmrNodes(obj);
  for (const o of nodes) o.visible = false;
  liftView.attach(cell.id, view.groups.get(cell.id), L);
  if (!mainModel) {
    const panel = (state.plant.proc.jig?.size[0] ?? state.plant.proc.kit.size[0]) + 0.15;
    mainModel = mainAmrModel(RENDER.loaded.get(cell.asset), { length: AMR.length, width: AMR.width, panel });
    if (mainModel) { fleetView.setModel(mainModel); fleetView.setup(state); }
  }
  state.log('info', `${cell.id} 작업대 리프트`, { obs: `GLB 메인 AMR(AMR_MAIN_JIG) ${nodes.length}개 숨김 · 플릿 메인 AMR 이 그 자리에 서고 지그째 들어 올림(가정 형상)${mainModel ? '' : ' · 차체 모델 없음(상자)'}` });
}

// 분류 레인이 시뮬로 돌면 GLB 의 레인 위 고정 토트(feed.hide)는 숨긴다 — 토트 엔티티가 대신 움직인다.
function hideFeedProps(cell, obj) {
  const F = state.plant?.supply?.feed;
  if (!F || F.id !== cell.id || !F.F.hide?.length) return;
  const names = new Set(F.F.hide);
  let n = 0;
  obj.traverse((o) => { if (names.has(baseName(o.name))) { o.visible = false; n++; } });
  if (n) state.log('info', `${cell.id} GLB 레인 고정 토트 ${n}개 숨김`, { obs: '분류 시뮬 토트로 대체' });
}

// 셀 공정이 도는 셀만: GLB 기구를 시뮬에 붙이고(IK·TCP) 렌더 피벗을 만든다.
function bindRig(cell, obj) {
  rigView.detach(cell.id);
  if (!state.plant?.work[cell.id]) return;
  const rig = assetRig(cell.asset);
  if (!rig) { state.log('warn', `${cell.id} 기구 데이터 없음`, { obs: '공정은 돌지만 로봇·갠트리는 정지 화면' }); return; }
  const rep = state.attachRig(cell.id, rig);
  const drawn = rigView.attach(cell.id, view.groups.get(cell.id), obj, rig);
  state.log(rep?.missing?.length ? 'warn' : 'info', `${cell.id} 기구 연결`, {
    obs: `로봇 ${rep?.robots.length ?? 0} · 갠트리 ${rep?.gantries.length ?? 0} · 롤러 ${rep?.rollers.length ?? 0}${rep?.missing?.length ? ` · 못 찾음 ${rep.missing.join(',')}` : ''} · 그리기 팔 ${drawn?.arms ?? 0}`,
  });
}

function drawWork(dt = 0) {
  depotView.update(placeOf(layout, 'PARTS'));
  storeView.update(state.plant?.store ? placeOf(layout, 'STORE') : null);
  const plant = state.plant;
  houndView.update(plant?.hound?.view() ?? null);
  inspectView.update(plant?.inspector?.view() ?? null);
  droneView.update(plant?.drones?.view().drones ?? null, dt);
  if (!plant?.proc) { outView.update(null); return; }
  for (const [id, cw] of Object.entries(plant.work)) {
    if (id === 'OUT') continue;
    const v = cw.view();
    rigView.update(id, v);
    if (v.lift) liftView.update(id, v.lift);
    if (v.body) {
      const grabbed = rigView.cells.get(id)?.body?.t?.o;
      if (grabbed) equipView.put(`${id}:${v.body.name}`, id, 'body', [grabbed]);
    }
  }
  outView.update(plant.work.OUT?.view() ?? null, plant.proc.kit.size, placeOf(layout, 'OUT'));
  partsView.update(plant.partPoses());
}

// 셀 밖(AMR·드론·견마·자리) + 셀 장비 머리 위 라벨. 셀 카드는 CellView.
function tagSpecs() {
  const followed = state.followed;
  const plant = state.plant;
  const out = [];
  for (const a of state.amrs) {
    if (a.off) continue;
    const cap = amrTag(a);
    if (!cap) continue;
    const y = String(a.id).startsWith('P-AMR') ? 1.75 : 1.55;
    out.push({ id: a.id, x: a.x, y, z: a.z, ...cap, selected: a.id === followed, scale: 2.2 });
  }
  const robots = [plant?.hound?.view(), plant?.inspector?.view(), ...(plant?.drones?.view().drones ?? [])].filter(Boolean);
  for (const r of robots) {
    const cap = robotTag(r);
    if (!cap) continue;
    const y = Number.isFinite(r.y) ? r.y + 0.9 : 1.2;
    out.push({ id: r.id, x: r.x, y, z: r.z, ...cap, selected: r.id === followed, scale: 2.0 });
  }
  for (const id of SITES) {
    if (id === 'STORE' && !plant?.store) continue;
    if (id === 'OUT' && !plant?.proc) continue;
    const pose = placeOf(layout, id);
    if (!pose) continue;
    const cap = siteTag(id);
    if (!cap) continue;
    out.push({ id, x: pose.x, y: id === 'OUT' ? 4.0 : 2.55, z: pose.z, ...cap, selected: false, scale: 3.2 });
  }
  for (const e of state.equip ?? []) {
    const at = equipView.focusOf(e.id);
    if (!at) continue;
    const cap = equipTag(e, { cellState: state.cell(e.cell)?.state, work: plant?.work?.[e.cell] });
    if (!cap) continue;
    out.push({
      id: e.id, x: at.center.x, y: at.center.y + at.size * 0.42 + 0.28, z: at.center.z,
      ...cap, selected: e.id === followed, scale: 1.7,
    });
  }
  return out;
}

// 셀 GLB 안 바퀴 달린 AMR 그룹(형상 판정 amr)은 메인 뷰에서 숨긴다 — 공급 AMR 플릿이 대신 움직인다. 도킹 지그(고정)는 그대로 둔다.
function hideAssetAmrs(cell, obj) {
  const amrs = scanMovers(obj).filter((m) => m.kind === 'amr');
  for (const m of amrs) m.obj.visible = false;
  if (amrs.length) state.log('info', `${cell.id} GLB AMR ${amrs.length}개 숨김`, { obs: '자세 인스턴스로 보고 공급 AMR 플릿으로 대체' });
}

function focusSelection(ev) {
  if (tracing()) return;
  if (ev.type === 'select' && ev.id) { camKit = false; rig.follow(null); rig.focus(view.focusOf(ev.id)); }
  if (ev.type === 'follow') {
    if (camKit && !ev.id) return;
    if (!ev.id) { rig.follow(null); return; }
    const at = () => fleetView.focusOf(ev.id, state) ?? partsFleetView.focusOf(ev.id, state) ?? houndView.focusOf(ev.id, state.plant?.hound?.view())
      ?? inspectView.focusOf(ev.id, state.plant?.inspector?.view()) ?? droneView.focusOf(ev.id, state.plant?.drones?.view().drones)
      ?? equipView.focusOf(ev.id);
    const now = at();
    if (now) rig.focus(now);
    rig.follow(() => at()?.center ?? null);
  }
}

async function loadCellAssets() {
  await Promise.all([loadAssets(state.cells.map((c) => c.asset), { base: assetUrl() }), loadWorkModel(), loadHoundModel(), loadDroneModel()]);
  for (const c of state.cells) if (RENDER.loaded.has(c.asset)) mount(c);
  for (const [key, err] of RENDER.errors) state.log('warn', `에셋 로드 실패: ${key}`, { obs: err });
  refreshUi();
}

// 견마 사족 모델. 참조 레포 quadruped.glb. 없으면 그리지 않는다(상자 대체 없음).
async function loadHoundModel() {
  const scene = await loadModel('quadruped', { base: assetUrl() });
  if (scene) { houndView.useModel(scene); inspectView.useModel(scene); }
  else state.log('warn', '견마 모델 없음', { obs: 'quadruped.glb 를 못 읽음' });
}

// 드론 모델. 참조 레포 drone.glb. 없으면 이착륙장만 그린다.
async function loadDroneModel() {
  const scene = await loadModel('drone', { base: assetUrl() });
  if (scene) droneView.useModel(scene);
  else state.log('warn', '드론 모델 없음', { obs: 'drone.glb 를 못 읽음' });
}

// 작업물(키트) 모델. 공정 정의 kit.model 이 에셋 키다(예: doortrim). 없으면 상자로 그린다.
async function loadWorkModel() {
  const key = processDoc?.kit?.model;
  if (!key) return;
  const scene = await loadModel(key, { base: assetUrl() });
  if (scene) partsView.setModel(key, scene);
  else state.log('warn', `작업물 모델 없음: ${key}`, { obs: '치수 상자로 대신 그림' });
}

function applyLayout(doc) {
  layout = normalizeLayout(doc);
  view.applyLayout(layout);
  aimCctv();
  state?.setLayout(layout);
  showStaticMap();
  if (place) place.setLayout(layout);
  if (routeTool) routeTool.setLayout(layout);
}

async function fetchProcess() {
  const url = processUrl();
  if (!url) return null;
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function fetchLayout() {
  const url = apiPath('layout');
  if (NO_SERVER || !url) return defaultLayout();
  const r = await fetch(url);
  if (!r.ok) return defaultLayout();
  const raw = await r.json();
  return validateLayout(raw).length ? defaultLayout() : normalizeLayout(raw);
}

function downloadLayout() {
  const url = apiPath('layout');
  if (!admin) {
    if (url) location.assign(`${url}${url.includes('?') ? '&' : '?'}download=1`);
    return;
  }
  const blob = new Blob([`${JSON.stringify(normalizeLayout(layout), null, 2)}\n`], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'layout.json';
  a.click();
  URL.revokeObjectURL(a.href);
  state.log('info', '레이아웃 내려받음');
}

async function importLayoutFile(file) {
  let raw;
  try { raw = JSON.parse(await file.text()); }
  catch { state.log('warn', '레이아웃 JSON 파싱 실패'); return; }
  const errors = validateLayout(raw);
  if (errors.length) { state.log('warn', '레이아웃 검증 실패', { obs: errors.join(' · ') }); return; }
  applyLayout(raw);
  await putLayout(normalizeLayout(raw));
}

// 지금 Admin 에서 고친 레이아웃(셀 자리 + AMR 경로)을 서버 파일로 저장한다.
function saveLayout() {
  const errors = validateLayout(layout);
  if (errors.length) { state.log('warn', '저장 안 함 — 검증 실패', { obs: errors.join(' · ') }); return; }
  return putLayout(normalizeLayout(layout));
}

async function putLayout(doc) {
  const url = apiPath('layout');
  if (NO_SERVER || !url) { state.log('info', '레이아웃 적용(서버 없음) — 내려받기로 보관'); return; }
  const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    state.log('warn', `레이아웃 저장 실패 (${r.status})`, { obs: body.error ?? '' });
    return;
  }
  applyLayout(await r.json());
  state.log('info', '레이아웃 저장', { obs: '서버 파일이 바뀌었다. 보기 화면은 곧 따라온다' });
}

function plantExtra() {
  return {
    amr: amrCount,
    drones: dronesCount ?? null,
    inspect: inspectOn ?? null,
    process: !!processDoc,
    layoutFp: fingerprint(layoutStamp(layout)),
    processFp: processDoc ? fingerprint(processDoc) : null,
  };
}

function plantCtx(scenario) {
  return {
    process: !!processDoc,
    layoutFp: fingerprint(layoutStamp(layout)),
    processFp: processDoc ? fingerprint(processDoc) : null,
    skip: persistSkip ? (FRESH ? '새로 시작(?fresh=1)' : '점검 warp') : null,
    scenario,
  };
}

async function fetchPlant() {
  const local = typeof localStorage !== 'undefined' ? readLocal(localStorage) : null;
  let server = null;
  const url = apiPath('plant');
  if (!NO_SERVER && url) {
    try {
      const r = await fetch(url);
      if (r.ok) server = validatePlant(await r.json()).doc;
    } catch { /* localStorage */ }
  }
  return pickPlant(server, local);
}

let lastPlantDump = '';

async function savePlant({ beacon = false } = {}) {
  if (!state || restoring || persistSkip) return;
  const doc = dumpPlant(state, plantExtra());
  const text = JSON.stringify(doc);
  if (text === lastPlantDump) return;
  lastPlantDump = text;
  writeLocal(typeof localStorage !== 'undefined' ? localStorage : null, doc);
  const url = apiPath('plant');
  if (NO_SERVER || !url) return;
  try {
    await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: text, keepalive: beacon });
  } catch { /* 브라우저는 localStorage 에 있음 */ }
}

async function deletePlantApi() {
  lastPlantDump = '';
  clearLocal(typeof localStorage !== 'undefined' ? localStorage : null);
  const url = apiPath('plant');
  if (NO_SERVER || !url) return;
  try { await fetch(url, { method: 'DELETE' }); }
  catch { /* 다음 저장에서 덮음 */ }
}

async function resetPlant() {
  if (!confirm('공장 상태를 처음부터 다시 시작할까요?\n시뮬 시각·재고·AMR 위치가 초기화됩니다. 레이아웃은 유지됩니다.')) return;
  restoring = true;
  await deletePlantApi();
  start();
  restoring = false;
  await savePlant();
  state.log('info', '공장 초기화', { obs: '시뮬 시각 0 · 레이아웃은 그대로' });
  refreshUi();
}

function applyPlant(doc) {
  if (!doc || doc.t < MAX_STEP / 2 && !doc.running) {
    if (doc) { state.setSpeed(doc.speed); if (params.get('play') === '1') state.setRunning(true); }
    return false;
  }
  restoring = true;
  ui.setStatus('공장 상태 복원 중…');
  restoreTime(state, doc.t, doc.incidents);
  state.setSpeed(doc.speed);
  if (params.get('play') === '1' || doc.running) state.setRunning(true);
  else state.setRunning(false);
  restoring = false;
  const h = Math.floor(state.time / 3600), m = Math.floor((state.time % 3600) / 60), s = Math.floor(state.time % 60);
  const clock = [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
  state.log('info', '공장 상태 복원', { obs: `${clock} · 새로고침·서버 재시작 후에도 유지 · Admin에서 초기화` });
  return true;
}

function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function startPoll() {
  stopPoll();
  const url = apiPath('layout');
  if (admin || NO_SERVER || !url) return;
  let stamp = layoutStamp(layout);
  pollTimer = setInterval(async () => {
    try {
      const next = await fetchLayout();
      const s = layoutStamp(next);
      if (s !== stamp) { stamp = s; applyLayout(next); }
    } catch { /* 다음 주기에 다시 */ }
  }, LAYOUT_POLL);
}

function buildHint() {
  return buildMode === 'route' || buildMode === 'parts'
    ? `${buildMode === 'parts' ? '부품 AMR 도킹 자리(큰 주황) · ' : ''}끌기 = 옮기기 · Shift+바닥 = 노드 추가 · Shift+노드 = 간선 바꾸기 · Ctrl+바닥 = 충전 자리 · Del = 지우기 · X = 셀 출구`
    : '좌클릭으로 셀·완료품·창고를 집고 놓는다 · 노란 레일 몸통 = 옮기기 · 끝점 = 늘리기/줄이기 · R 90°';
}

function enableTool() {
  disableTools();
  const floor = field.root.getObjectByName('floor');
  if (buildMode === 'route' || buildMode === 'parts') {
    const parts = buildMode === 'parts', ops = parts ? partsOps : routeOps, fv = parts ? partsFleetView : fleetView;
    routeTool = new RouteEditTool(stage, floor, {
      ops,
      onPreview: (map) => fv.showMap(map ?? (state?.plant ? null : ops.mapOf(layout))),
      onChange: (doc, why) => commitLayout(doc, why),
      onNote: (text) => state?.log('warn', text),
    });
    routeTool.setLayout(layout);
    return;
  }
  place = new PlaceTool(stage, view, floor, {
    onChange: (doc) => commitLayout(doc, null),
    onPreview: previewPlace,
    canPlace, poseOf, extent, placeItem, translateSpur, moveSpurEnd, rotateSpur,
    sites: [outView.root, depotView.root, storeView.root],
    spur: SITE_SPUR,
  });
  place.setLayout(layout);
}

function previewPlace(doc) {
  view.applyLayout(doc);
  const plant = state?.plant;
  if (plant?.proc) outView.update(plant.work.OUT?.view() ?? null, plant.proc.kit.size, placeOf(doc, 'OUT'));
  else outView.update(null);
  depotView.update(placeOf(doc, 'PARTS'));
  storeView.update(plant?.store ? placeOf(doc, 'STORE') : null);
  if (!plant) {
    fleetView.showMap(routeOps.mapOf(doc));
    partsFleetView.showMap(doc.parts ? routeOps.mapOf(partsLayout(doc)) : null);
  }
}

function disableTools() {
  place?.dispose();
  place = null;
  routeTool?.dispose();
  routeTool = null;
}

// Admin 편집 확정: 구조 검증을 통과하면 시뮬에 바로 반영한다(ACS 는 움직이던 AMR을 충전 자리로 돌린다). 서버 저장은 따로.
function commitLayout(doc, why) {
  const errors = validateLayout(doc);
  if (errors.length) {
    state?.log('warn', '편집 취소 — 검증 실패', { obs: errors.slice(0, 3).join(' · ') });
    routeTool?.setLayout(layout);
    place?.setLayout(layout);
    view.applyLayout(layout);
    return;
  }
  layout = normalizeLayout(doc);
  state?.setLayout(layout);
  aimCctv();
  showStaticMap();
  if (routeTool) routeTool.setLayout(layout);
  if (place) place.setLayout(layout);
  const issues = [...routeGeo(layout).check.issues, ...routeGeo(partsLayout(layout)).check.issues.map((t) => `부품 AMR ${t}`), ...dockIssues(layout, processDoc)];
  if (why || issues.length) state?.log(issues.length ? 'warn' : 'info', why ?? '셀 자리 변경', { obs: issues.length ? `경로 점검 ${issues.length}건: ${issues.slice(0, 3).join(' · ')}` : '경로 점검 통과' });
}

function setBuildMode(mode) {
  if (mode === buildMode) return;
  buildMode = mode;
  ui.setAdmin(admin, state?.cells ?? CELLS, buildMode);
  if (admin) {
    view.applyLayout(layout);
    enableTool();
    state?.log('info', mode === 'route' ? 'AMR 경로 편집' : mode === 'parts' ? '부품 AMR 도킹 자리·루트 편집' : '셀 배치', { obs: buildHint() });
  }
}

function setAdmin(on) {
  if (admin === on) {
    ui.setAdmin(admin, state?.cells ?? CELLS, buildMode);
    return;
  }
  admin = on;
  picker.enabled = !admin;
  ui.setAdmin(admin, state?.cells ?? CELLS, buildMode);
  if (admin) {
    stopPoll();
    enableTool();
    state?.log('info', 'Admin 모드', { obs: buildHint() });
  } else {
    disableTools();
    view.applyLayout(layout);
    startPoll();
    state?.log('info', '보기 모드');
  }
  if (state) refreshUi();
}

const clock = new THREE.Clock();
let uiAcc = 0;
let saveAcc = 0;

function frame() {
  requestAnimationFrame(frame); // 한 프레임에서 예외가 나도 루프는 계속
  const rdt = Math.min(clock.getDelta(), 0.1);
  state.advance(rdt);
  if ((saveAcc += rdt) >= 5) { saveAcc = 0; savePlant(); }
  if (trace.mode === 'wait' || trace.mode === 'run') syncTrace();
  hub.tick(state);
  const events = state.drainEvents();
  view.update(rdt, state, events);
  fleetView.update(rdt, state, events);
  partsFleetView.update(rdt, state, events);
  drawWork(rdt);
  equipView.mark(state.followed);
  tags.sync(tagSpecs());
  for (const ev of events) focusSelection(ev);
  rig.update(rdt);
  monitor?.update(rdt, `CCTV  ${hms(state.time)}`);
  stage.render();
  const picked = events.some((ev) => ev.type === 'select' || ev.type === 'follow');
  if ((uiAcc += rdt) >= 0.25 || picked) { uiAcc = 0; refreshUi(); }
}

layout = await fetchLayout();
processDoc = params.get('process') === '0' ? null : await fetchProcess();
storeView.setDef(processDoc?.cells?.SORT?.inbound?.store ?? null);
const savedPlant = persistSkip ? null : await fetchPlant();
const wantScenario = scenarioParam ? scenarioKey : undefined;
const plantGate = restoreOk(savedPlant, plantCtx(wantScenario));
if (plantGate.ok) {
  scenarioKey = plantGate.doc.scenario;
  if (AMR_COUNT == null) amrCount = plantGate.doc.amr;
  if (DRONES === undefined) dronesCount = plantGate.doc.drones ?? undefined;
  if (INSPECT_ON === undefined) inspectOn = plantGate.doc.inspect ?? undefined;
  ui.setScenarios([{ key: '', label: '시나리오 없음' }, ...Object.entries(SCENARIOS).map(([key, s]) => ({ key, label: s.label }))], scenarioKey);
}
start();
picker.enabled = !admin;
if (admin) enableTool();
if (AUTOLOAD) await loadCellAssets();
if (plantGate.ok && applyPlant(plantGate.doc)) {
  const ev = state.drainEvents();
  view.update(0, state, ev);
  fleetView.update(0, state, ev);
  partsFleetView.update(0, state, ev);
  drawWork();
  refreshUi();
} else if (savedPlant && plantGate.why) state.log('info', '공장 상태 새로 시작', { obs: plantGate.why });
// 점검용: ?trace=1 다음 입고 키트 추적 · ?warp=초 시뮬을 그만큼 미리 진행 · ?focus=셀 id 또는 AMR id
if (params.get('trace') === '1' && state.plant?.route) {
  trace.start(state);
  holdTraceCamera(true);
  if (!state.running) state.setRunning(true);
}
const warp = WARP_AT;
if (warp > 0) {
  for (let t = 0; t < warp; t += 0.1) {
    state.step(0.1);
    if (trace.mode === 'wait' || trace.mode === 'run') trace.tick(state);
  }
}
const focusId = params.get('focus');
if (focusId) {
  if (state.cell(focusId)) state.select(focusId);
  else if (state.amrs.some((a) => a.id === focusId) || state.plant?.robots?.some((r) => r.id === focusId) || findEquip(state, focusId)) state.follow(focusId);
}
// 점검용: ?cam=px,py,pz,tx,ty,tz 카메라 위치·궤도 중심(필드 좌표)
const cam = (params.get('cam') ?? '').split(',').map(Number);
if (cam.length === 6 && cam.every(Number.isFinite)) {
  stage.camera.position.set(cam[0], cam[1], cam[2]);
  stage.controls.target.set(cam[3], cam[4], cam[5]);
  stage.controls.update();
}
if (warp > 0 || focusId) {
  const events = state.drainEvents();
  view.update(0, state, events);
  fleetView.update(0, state, events);
  partsFleetView.update(0, state, events);
  drawWork();
  for (const ev of events) focusSelection(ev);
  if (trace.mode === 'run' && !focusId && cam.length !== 6) aimTrace();
  rig.update(2);
  monitor?.update(0, `CCTV  ${hms(state.time)}`);
  monitor?.refresh();
  refreshUi();
} else if (trace.mode !== 'off') {
  refreshUi();
}
const statusUrl = apiPath('status');
if (!NO_SERVER && statusUrl) {
  fetch(statusUrl).then((r) => r.json()).then((s) => ui.setStatus(`서버 ${s.name} · 에셋 ${s.assets.length}개`)).catch(() => ui.setStatus('서버 응답 없음'));
} else {
  ui.setStatus(NO_SERVER ? '정적 모드' : '설정 없음');
}
startPoll();
addEventListener('pagehide', () => { savePlant({ beacon: true }); });
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePlant({ beacon: true }); });
frame();

// 개발용 핸들. 콘솔에서 __viewer.loadAssets() 등.
window.__viewer = {
  get state() { return state; }, get layout() { return layout; }, get admin() { return admin; },
  stage, field, view, fleetView, partsFleetView, rigView, liftView, equipView, tags, partsView, outView, depotView, storeView, houndView, inspectView, droneView, rig, hub, ui, get place() { return place; }, get routeTool() { return routeTool; }, RENDER, start, loadAssets: loadCellAssets, applyLayout, setAdmin, resetPlant, savePlant,
  status: (id) => equipmentStatus(state, id),
  trace,
};
