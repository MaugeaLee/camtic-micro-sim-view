// 조립 루트: 부트 · rAF 루프 · 모듈 배선. 모듈끼리는 서로 import 하지 않고 여기서만 잇는다.
import * as THREE from 'three';
import { NO_SERVER } from './core/env.js';
import { runtime, assetUrl, apiPath } from './core/runtime.js';
import { CELLS } from './sim/cells.js';
import { canPlace, defaultLayout, extent, layoutStamp, normalizeLayout, poseOf, validateLayout } from './sim/layout.js';
import { ViewerState } from './sim/state.js';
import { DataHub } from './data/hub.js';
import { createStage } from './render/stage.js';
import { CellView } from './render/view.js';
import { FIELD } from './render/field-def.js';
import { buildField } from './render/field.js';
import { PlaceTool } from './render/place.js';
import { RENDER, loadAssets, cloneAsset } from './assets/loader.js';
import { UI } from './ui/ui.js';

const params = new URLSearchParams(location.search);
const AUTOLOAD = params.get('assets') !== '0';
const LAYOUT_POLL = 2000;

const stage = createStage(document.getElementById('viewport'));
const field = buildField(stage.scene, FIELD);
stage.fitShadow(FIELD.size.w, FIELD.size.d);
const view = new CellView(stage.scene);
const hub = new DataHub();
const ui = new UI({
  onPlay: () => state.setRunning(!state.running),
  onSpeed: (x) => state.setSpeed(x),
  onSelect: (id) => {
    state.select(state.selected === id ? null : id);
    if (place) place.selected = state.selected;
  },
  onPlace: (id) => { if (place) { place.pick(id); state.select(id); place.selected = id; } },
  onDownload: downloadLayout,
  onImport: importLayoutFile,
  onAdmin: () => setAdmin(!admin),
});

let state = null;
let layout = defaultLayout();
let place = null;
let pollTimer = null;
let admin = params.get('build') === '1';

function start() {
  state = new ViewerState({ cells: CELLS });
  view.setup(state);
  view.applyLayout(layout);
  hub.reset();
  for (const c of state.cells) if (RENDER.loaded.has(c.asset)) mount(c);
  const rt = runtime();
  state.log('info', '뷰어 시작', { obs: `셀 ${state.cells.length}개 · 서버 ${NO_SERVER ? '없음' : (rt ? `${rt.host}:${rt.port}` : '설정 없음')}` });
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
    onChange: (doc) => { layout = doc; },
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
  view.update(rdt, state, state.drainEvents());
  stage.render();
  if ((uiAcc += rdt) >= 0.25) { uiAcc = 0; ui.update(state); }
}

layout = await fetchLayout();
start();
if (admin) enablePlace();
if (AUTOLOAD) await loadCellAssets();
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
  stage, field, view, hub, ui, get place() { return place; }, RENDER, start, loadAssets: loadCellAssets, applyLayout, setAdmin,
};
