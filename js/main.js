// 조립 루트: 부트 · rAF 루프 · 모듈 배선. 모듈끼리는 서로 import 하지 않고 여기서만 잇는다.
import * as THREE from 'three';
import { NO_SERVER } from './core/env.js';
import { runtime, assetUrl, apiPath } from './core/runtime.js';
import { CELLS } from './sim/cells.js';
import { ViewerState } from './sim/state.js';
import { DataHub } from './data/hub.js';
import { createStage } from './render/stage.js';
import { CellView } from './render/view.js';
import { RENDER, loadAssets, cloneAsset } from './assets/loader.js';
import { UI } from './ui/ui.js';

// 에셋 자동 로드는 꺼 둔다. 켜려면 ?assets=1 또는 window.__viewer.loadAssets().
const AUTOLOAD = new URLSearchParams(location.search).get('assets') === '1';

const stage = createStage(document.getElementById('viewport'));
const view = new CellView(stage.scene);
const hub = new DataHub();
const ui = new UI({
  onPlay: () => state.setRunning(!state.running),
  onSpeed: (x) => state.setSpeed(x),
  onSelect: (id) => state.select(state.selected === id ? null : id),
});

let state = null;

function start() {
  state = new ViewerState({ cells: CELLS });
  view.setup(state);
  hub.reset();
  for (const c of state.cells) if (RENDER.loaded.has(c.asset)) mount(c);
  const rt = runtime();
  state.log('info', '뷰어 시작', { obs: `셀 ${state.cells.length}개 · 서버 ${NO_SERVER ? '없음' : (rt ? `${rt.host}:${rt.port}` : '설정 없음')}` });
  ui.reset(state);
}

function mount(cell) {
  const obj = cloneAsset(cell.asset);
  if (!obj) return;
  view.attach(cell.id, obj);
  state.markLoaded(cell.id);
}

async function loadCellAssets() {
  await loadAssets(state.cells.map((c) => c.asset), { base: assetUrl() });
  for (const c of state.cells) if (RENDER.loaded.has(c.asset)) mount(c);
  for (const [key, err] of RENDER.errors) state.log('warn', `에셋 로드 실패: ${key}`, { obs: err });
  ui.update(state);
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

start();
if (AUTOLOAD) await loadCellAssets();
const statusUrl = apiPath('status');
if (!NO_SERVER && statusUrl) {
  fetch(statusUrl).then((r) => r.json()).then((s) => ui.setStatus(`서버 ${s.name} · 에셋 ${s.assets.length}개`)).catch(() => ui.setStatus('서버 응답 없음'));
} else {
  ui.setStatus(NO_SERVER ? '정적 모드' : '설정 없음');
}
frame();

// 개발용 핸들. 콘솔에서 __viewer.loadAssets() 등.
window.__viewer = { get state() { return state; }, stage, view, hub, ui, RENDER, start, loadAssets: loadCellAssets };
