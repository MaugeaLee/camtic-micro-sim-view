// 조립 루트: 부트 · rAF 루프 · 모듈 배선. 모듈끼리는 서로 import 하지 않고 여기서만 잇는다.
import * as THREE from 'three';
import { NO_SERVER } from './core/env.js';
import { runtime, assetUrl, apiPath } from './core/runtime.js';
import { CELLS } from './sim/cells.js';
import { canPlace, defaultLayout, extent, layoutStamp, normalizeLayout, poseOf, validateLayout } from './sim/layout.js';
import { ViewerState } from './sim/state.js';
import { AMR_MAX, DEFAULT_SCENARIO, SCENARIOS } from './sim/scenario.js';
import { parkSlot } from './sim/fleet.js';
import { DataHub } from './data/hub.js';
import { createStage } from './render/stage.js';
import { CellView } from './render/view.js';
import { FleetView } from './render/fleet.js';
import { CameraRig } from './render/camera.js';
import { Picker } from './render/pick.js';
import { FIELD } from './render/field-def.js';
import { buildField } from './render/field.js';
import { PlaceTool } from './render/place.js';
import { RENDER, loadAssets, cloneAsset } from './assets/loader.js';
import { scanMovers } from './assets/scan.js';
import { UI } from './ui/ui.js';

const params = new URLSearchParams(location.search);
const AUTOLOAD = params.get('assets') !== '0';
const LAYOUT_POLL = 2000;
// ?scenario=supply|faults|none · ?amr=1..AMR_MAX (기본: 시나리오 값, 견적 A08 2대) · ?play=1 자동 재생
const scenarioParam = params.get('scenario');
let scenarioKey = scenarioParam === 'none' ? null : SCENARIOS[scenarioParam] ? scenarioParam : DEFAULT_SCENARIO;
const amrParam = Number(params.get('amr'));
const AMR_COUNT = Number.isInteger(amrParam) && amrParam >= 1 && amrParam <= AMR_MAX ? amrParam : null;

const stage = createStage(document.getElementById('viewport'));
const field = buildField(stage.scene, FIELD);
stage.fitShadow(FIELD.size.w, FIELD.size.d);
const view = new CellView(stage.scene);
const fleetView = new FleetView(stage.scene);
const rig = new CameraRig(stage);
const hub = new DataHub();
const ui = new UI({
  onPlay: () => state.setRunning(!state.running),
  onSpeed: (x) => state.setSpeed(x),
  onSelect: (id) => {
    state.select(state.selected === id ? null : id);
    if (place) place.selected = state.selected;
  },
  onFollow: (id) => state.follow(state.followed === id ? null : id),
  onScenario: (key) => { scenarioKey = key; start(); },
  onPlace: (id) => { if (place) { place.pick(id); state.select(id); place.selected = id; } },
  onDownload: downloadLayout,
  onImport: importLayoutFile,
  onAdmin: () => setAdmin(!admin),
});
ui.setScenarios([{ key: '', label: '시나리오 없음' }, ...Object.entries(SCENARIOS).map(([key, s]) => ({ key, label: s.label }))], scenarioKey);

const picker = new Picker(stage, [
  { meshes: () => fleetView.pickables(), key: 'amrId' },
  { meshes: () => view.pickables(), key: 'cellId' },
], (hit) => {
  if (hit?.amrId) state.follow(state.followed === hit.amrId ? null : hit.amrId);
  else if (hit?.cellId) state.select(state.selected === hit.cellId ? null : hit.cellId);
  else { state.select(null); state.follow(null); }
});

let state = null;
let layout = defaultLayout();
let place = null;
let pollTimer = null;
let admin = params.get('build') === '1';

function start() {
  const running = state?.running ?? params.get('play') === '1';
  const speed = state?.speed ?? 1;
  state = new ViewerState({ cells: CELLS, scenario: scenarioKey, layout, amr: AMR_COUNT });
  view.setup(state, { extent });
  view.applyLayout(layout);
  fleetView.setup(state, { parks: state.amrs.map((_, i) => parkSlot(i)) });
  rig.follow(null);
  hub.reset();
  for (const c of state.cells) if (RENDER.loaded.has(c.asset)) mount(c);
  const rt = runtime();
  state.log('info', '뷰어 시작', { obs: `셀 ${state.cells.length}개 · 서버 ${NO_SERVER ? '없음' : (rt ? `${rt.host}:${rt.port}` : '설정 없음')}` });
  if (state.plant) {
    const bad = Object.values(state.plant.docks).filter((d) => !d.ok).map((d) => d.id);
    state.log('info', `시나리오: ${SCENARIOS[scenarioKey].label}`, { obs: `공급 AMR ${state.amrs.length}대 · 사이클·고장 시각은 가정값${bad.length ? ` · 도크 도달 불가 ${bad.join(',')}` : ''}` });
  }
  state.setSpeed(speed);
  if (running) state.setRunning(true);
  ui.reset(state);
  ui.setAdmin(admin, state.cells);
  if (admin) state.log('info', 'Admin 모드', { obs: '좌클릭으로 집고 놓는다. 내려받기·올리기는 왼쪽 아래' });
}

function mount(cell) {
  const obj = cloneAsset(cell.asset);
  if (!obj) return;
  view.attach(cell.id, obj);
  view.applyLayout(layout);
  state.markLoaded(cell.id);
  if (state.plant) hideAssetAmrs(cell, obj);
}

// 셀 GLB 안 바퀴 달린 AMR 그룹(형상 판정 amr)은 메인 뷰에서 숨긴다 — 공급 AMR 플릿이 대신 움직인다. 도킹 지그(고정)는 그대로 둔다.
function hideAssetAmrs(cell, obj) {
  const amrs = scanMovers(obj).filter((m) => m.kind === 'amr');
  for (const m of amrs) m.obj.visible = false;
  if (amrs.length) state.log('info', `${cell.id} GLB AMR ${amrs.length}개 숨김`, { obs: '자세 인스턴스로 보고 공급 AMR 플릿으로 대체' });
}

function focusSelection(ev) {
  if (ev.type === 'select' && ev.id) { rig.follow(null); rig.focus(view.focusOf(ev.id)); }
  if (ev.type === 'follow') {
    if (!ev.id) { rig.follow(null); return; }
    rig.focus(fleetView.focusOf(ev.id, state));
    rig.follow(() => fleetView.focusOf(ev.id, state)?.center ?? null);
  }
}

async function loadCellAssets() {
  await loadAssets(state.cells.map((c) => c.asset), { base: assetUrl() });
  for (const c of state.cells) if (RENDER.loaded.has(c.asset)) mount(c);
  for (const [key, err] of RENDER.errors) state.log('warn', `에셋 로드 실패: ${key}`, { obs: err });
  ui.update(state);
}

function applyLayout(doc) {
  layout = normalizeLayout(doc);
  view.applyLayout(layout);
  state?.setLayout(layout);
  if (place) place.setLayout(layout);
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
  const url = apiPath('layout');
  if (NO_SERVER || !url) { state.log('info', '레이아웃 적용(서버 없음)'); return; }
  const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(normalizeLayout(raw)) });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    state.log('warn', `레이아웃 올리기 실패 (${r.status})`, { obs: body.error ?? '' });
    return;
  }
  applyLayout(await r.json());
  state.log('info', '레이아웃 올림', { obs: '서버 파일이 바뀌었다. 보기 화면은 곧 따라온다' });
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

function enablePlace() {
  if (place) return;
  const floor = field.root.getObjectByName('floor');
  place = new PlaceTool(stage, view, floor, {
    onChange: (doc) => { layout = doc; state?.setLayout(doc); },
    canPlace, poseOf, extent,
  });
  place.setLayout(layout);
}

function setAdmin(on) {
  if (admin === on) {
    ui.setAdmin(admin, state?.cells ?? CELLS);
    return;
  }
  admin = on;
  picker.enabled = !admin;
  ui.setAdmin(admin, state?.cells ?? CELLS);
  if (admin) {
    stopPoll();
    enablePlace();
    state?.log('info', 'Admin 모드', { obs: '좌클릭으로 집고 놓는다' });
  } else {
    place?.dispose();
    place = null;
    view.applyLayout(layout);
    startPoll();
    state?.log('info', '보기 모드');
  }
  if (state) ui.update(state);
}

const clock = new THREE.Clock();
let uiAcc = 0;

function frame() {
  requestAnimationFrame(frame); // 한 프레임에서 예외가 나도 루프는 계속
  const rdt = Math.min(clock.getDelta(), 0.1);
  state.advance(rdt);
  hub.tick(state);
  const events = state.drainEvents();
  view.update(rdt, state, events);
  fleetView.update(rdt, state, events);
  for (const ev of events) focusSelection(ev);
  rig.update(rdt);
  stage.render();
  if ((uiAcc += rdt) >= 0.25) { uiAcc = 0; ui.update(state); }
}

layout = await fetchLayout();
start();
picker.enabled = !admin;
if (admin) enablePlace();
if (AUTOLOAD) await loadCellAssets();
// 점검용: ?warp=초 시뮬을 그만큼 미리 진행 · ?focus=셀 id 또는 AMR id
const warp = Number(params.get('warp'));
if (warp > 0) for (let t = 0; t < warp; t += 0.1) state.step(0.1);
const focusId = params.get('focus');
if (focusId) {
  if (state.cell(focusId)) state.select(focusId);
  else if (state.amrs.some((a) => a.id === focusId)) state.follow(focusId);
}
if (warp > 0 || focusId) {
  const events = state.drainEvents();
  view.update(0, state, events);
  fleetView.update(0, state, events);
  for (const ev of events) focusSelection(ev);
  rig.update(2);
  ui.update(state);
}
const statusUrl = apiPath('status');
if (!NO_SERVER && statusUrl) {
  fetch(statusUrl).then((r) => r.json()).then((s) => ui.setStatus(`서버 ${s.name} · 에셋 ${s.assets.length}개`)).catch(() => ui.setStatus('서버 응답 없음'));
} else {
  ui.setStatus(NO_SERVER ? '정적 모드' : '설정 없음');
}
startPoll();
frame();

// 개발용 핸들. 콘솔에서 __viewer.loadAssets() 등.
window.__viewer = {
  get state() { return state; }, get layout() { return layout; }, get admin() { return admin; },
  stage, field, view, fleetView, rig, hub, ui, get place() { return place; }, RENDER, start, loadAssets: loadCellAssets, applyLayout, setAdmin,
};
