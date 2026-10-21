// /api/asset-viewer 테스트 뷰포트. 메인 시뮬 뷰어와 분리.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStage } from '../render/stage.js';
import { runtime, apiPath } from '../core/runtime.js';
import { SPEEDS } from '../core/env.js';
import { toTree, countNodes, findObject, objectToId, ancestorIds, renderTreeHtml, esc } from './tree.js';
import { recipeFor, jointWave } from './anim.js';
import { inferRig } from './rig.js';

const $ = (id) => document.getElementById(id);
const loader = new GLTFLoader();
const stage = createStage($('viewport'));
const hold = new THREE.Group();
hold.name = 'preview';
stage.scene.add(hold);

let root = null;
let helper = null;
let hoverHelper = null;
let selected = null;
let pickOn = false;
let assetKey = '';
let drive = null;
let robots = [];
let fleet = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  tickDrive(dt);
  if (helper) helper.update();
  if (hoverHelper) hoverHelper.update();
  paintClock();
  stage.render();
}
frame();

function fit(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 0.5);
  stage.controls.target.copy(center);
  stage.camera.position.set(center.x + span, center.y + span * 0.7, center.z + span * 1.2);
  stage.camera.near = Math.max(span / 200, 0.01);
  stage.camera.far = Math.max(span * 40, 50);
  stage.camera.updateProjectionMatrix();
  stage.controls.update();
}

function paintTree(obj) {
  const tree = toTree(obj);
  $('tree').innerHTML = renderTreeHtml(tree);
  $('treeCount').textContent = `${countNodes(tree)}개`;
  mark(null);
}

function dropHelper(box) {
  if (!box) return null;
  stage.scene.remove(box);
  box.geometry?.dispose?.();
  box.material?.dispose?.();
  return null;
}

function mark(id) {
  selected = id;
  helper = dropHelper(helper);
  for (const el of $('tree').querySelectorAll('.on')) el.classList.remove('on');
  if (!id || !root) return;
  const el = $('tree').querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (el) el.classList.add('on');
  const obj = findObject(root, id);
  if (!obj) return;
  helper = new THREE.BoxHelper(obj, 0x4fb3ff);
  stage.scene.add(helper);
}

function hover(obj) {
  hoverHelper = dropHelper(hoverHelper);
  if (!obj || (selected && objectToId(root, obj) === selected)) return;
  hoverHelper = new THREE.BoxHelper(obj, 0xf5b74e);
  stage.scene.add(hoverHelper);
}

function revealInTree(id) {
  if (!id) return;
  for (const a of ancestorIds(id)) {
    const el = $('tree').querySelector(`[data-id="${CSS.escape(a)}"]`);
    const details = el?.closest('details');
    if (details) details.open = true;
    if (details) details.hidden = false;
    if (el) el.hidden = false;
  }
  const el = $('tree').querySelector(`[data-id="${CSS.escape(id)}"]`);
  el?.scrollIntoView({ block: 'center', inline: 'nearest' });
}

function applySearch(q) {
  const query = q.trim().toLowerCase();
  const tree = $('tree');
  if (!query) {
    tree.querySelectorAll('details, .leaf').forEach((el) => { el.hidden = false; });
    return;
  }
  const nameOf = (el) => (el.querySelector('.nm')?.textContent ?? '').toLowerCase();
  tree.querySelectorAll('.leaf').forEach((el) => { el.hidden = !nameOf(el).includes(query); });
  [...tree.querySelectorAll('details')].reverse().forEach((d) => {
    const self = nameOf(d.querySelector(':scope > summary') ?? d).includes(query);
    const child = [...d.children].some((c) => (c.matches('details, .leaf') && !c.hidden));
    d.hidden = !self && !child;
    if (self || child) d.open = true;
  });
}

function setPick(on) {
  pickOn = !!on;
  $('btnPick').classList.toggle('on', pickOn);
  $('viewport').classList.toggle('pick', pickOn);
  stage.controls.enabled = !pickOn;
  if (!pickOn) hover(null);
}

function pointerNdc(e) {
  const r = stage.renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

function hitAt(e) {
  if (!pickOn || !root) return null;
  pointerNdc(e);
  raycaster.setFromCamera(pointer, stage.camera);
  return raycaster.intersectObject(root, true)[0]?.object ?? null;
}

function fillTree() {
  $('tree').innerHTML = '';
  $('treeCount').textContent = '';
  $('treeSearch').value = '';
  hover(null);
  mark(null);
}

function fmtClock(t) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`;
}

function paintClock() {
  $('clock').textContent = fmtClock(drive?.time ?? 0);
  $('btnPlay').textContent = drive?.running ? '일시정지' : '재생';
  $('btnPlay').classList.toggle('on', !!drive?.running);
  for (const b of $('speedSeg').children) {
    b.classList.toggle('on', Number(b.dataset.speed) === (drive?.speed ?? 1));
  }
}

const MIN_PARTS = 4;
const POINT_CAP = 4000;

function partPoints(obj) {
  const meshes = [];
  obj.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o); });
  const total = meshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
  const step = Math.max(1, Math.ceil(total / POINT_CAP));
  const out = [], v = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  }
  return out;
}

function planFor(group) {
  if (group.userData.rigPlan !== undefined) return group.userData.rigPlan;
  const objects = group.children.filter((c) => c.isMesh || c.children.length);
  let plan = null;
  if (objects.length >= MIN_PARTS) {
    const r = inferRig(objects.map((o) => ({ name: o.name, points: partPoints(o) })));
    if (r.robot) plan = { ...r, objects };
  }
  group.userData.rigPlan = plan;
  return plan;
}

function scanRobots(scene) {
  scene.updateWorldMatrix(true, true);
  const out = [];
  scene.traverse((o) => { if (o !== scene && !o.isMesh && planFor(o)) out.push(o); });
  return out;
}

// 추정한 관절마다 빈 피벗(J1…)을 관절 원점에 두고 링크 부품을 그 아래로 옮긴다 — 참조 레포 nativeChain 과 같은 구조
function rigGroup(group) {
  if (group.userData.rig) return group.userData.rig;
  const plan = planFor(group);
  if (!plan) return null;
  group.updateWorldMatrix(true, true);
  const inv = group.matrixWorld.clone().invert();
  const pivots = [], axes = [];
  plan.joints.forEach((j, i) => {
    const parent = j.parent >= 0 ? pivots[j.parent] : group;
    parent.updateWorldMatrix(true, false);
    const p = new THREE.Group();
    p.name = `J${i + 1}`;
    p.position.copy(parent.worldToLocal(new THREE.Vector3(...j.origin)));
    const ax = new THREE.Vector3(...j.axis).transformDirection(inv);
    p.userData = { axis: ax.toArray(), lower: -Math.PI, upper: Math.PI, from: j.name };
    parent.add(p);
    pivots.push(p);
    axes.push(ax);
  });
  plan.objects.forEach((o, k) => { if (plan.link[k] >= 0) pivots[plan.link[k]].attach(o); });
  const rig = { root: group, pivots, axes };
  group.userData.rig = rig;
  return rig;
}

function poseRig(rig, qs) {
  rig.pivots.forEach((p, i) => p.quaternion.setFromAxisAngle(rig.axes[i], qs[i] ?? 0));
}

function releaseDrive() {
  for (const d of fleet) poseRig(d.rig, []);
  fleet = [];
  drive = null;
}

function bindFleet({ play = false, focus = 0 } = {}) {
  const was = { running: play || !!drive?.running, speed: drive?.speed ?? 1 };
  releaseDrive();
  fleet = robots.map((obj, i) => {
    const rig = rigGroup(obj);
    if (!rig) return null;
    poseRig(rig, []);
    return { obj, rig, phase: i * 0.45 };
  }).filter(Boolean);
  if (!fleet.length) {
    paintClock();
    return false;
  }
  paintTree(root);
  const pick = fleet[focus] ?? fleet[0];
  drive = {
    name: pick.obj.name,
    obj: pick.obj,
    rig: pick.rig,
    recipe: recipeFor(assetKey),
    time: 0,
    running: was.running,
    speed: was.speed,
  };
  focusRobot(pick.obj);
  paintClock();
  return true;
}

function focusRobot(obj) {
  if (!obj || !root) return;
  const id = objectToId(root, obj);
  if (id) {
    $('treeSearch').value = obj.name || '';
    applySearch($('treeSearch').value);
    revealInTree(id);
    mark(id);
  }
  fit(obj);
}

function tickDrive(dt) {
  if (!drive?.running) return;
  drive.time += dt * drive.speed;
  for (const d of fleet) {
    poseRig(d.rig, jointWave(drive.time, d.rig.pivots.length, { ...drive.recipe, phase: d.phase }));
  }
}

function pickedIndex() {
  const v = $('driveTarget').value;
  return v === '' ? -1 : Number(v);
}

function setRunning(on) {
  if (!drive && robots.length) bindFleet({ play: on, focus: Math.max(0, pickedIndex()) });
  if (!drive) return;
  drive.running = !!on;
  paintClock();
}

function fillTargets(pref) {
  const pick = $('driveTarget');
  pick.innerHTML = robots.length
    ? robots.map((o, i) => `<option value="${i}">${esc(o.name || `robot ${i + 1}`)}</option>`).join('')
    : '<option value="">로봇 없음</option>';
  const hit = robots.findIndex((o) => o.name === pref);
  if (robots.length) pick.value = String(hit >= 0 ? hit : 0);
}

function fillSpeeds() {
  $('speedSeg').innerHTML = SPEEDS.map((x) => `<button type="button" data-speed="${x}">${x}×</button>`).join('');
}

async function show(item, { play, target } = {}) {
  hold.clear();
  root = null;
  releaseDrive();
  robots = [];
  fillTree();
  assetKey = item?.key ?? '';
  if (!item?.url) { $('note').textContent = '에셋 없음'; fillTargets(''); return; }
  $('note').textContent = `로드 ${item.key}…`;
  try {
    const gltf = await loader.loadAsync(item.url);
    root = gltf.scene;
    hold.add(root);
    fit(root);
    paintTree(root);
    robots = scanRobots(root);
    fillTargets(recipeFor(assetKey, { name: target }).name);
    const shouldPlay = play === true || (play !== false && robots.length > 0);
    const ok = bindFleet({ play: shouldPlay, focus: Math.max(0, pickedIndex()) });
    $('note').textContent = ok
      ? `${item.key} · 로봇 ${fleet.length}대${shouldPlay ? ' 재생' : ' 검출'}`
      : `${item.key} · ${item.format} · ${item.bytes} B · 로봇 ${robots.length}대`;
  } catch (e) {
    $('note').textContent = `실패: ${e?.message ?? e}`;
  }
}

$('tree').addEventListener('click', (e) => {
  const el = e.target.closest('[data-id]');
  if (!el) return;
  const id = el.dataset.id;
  mark(id);
  const obj = root && findObject(root, id);
  if (obj) fit(obj);
});

$('treeSearch').addEventListener('input', (e) => applySearch(e.target.value));

$('btnPick').addEventListener('click', () => setPick(!pickOn));
$('btnPlay').addEventListener('click', () => setRunning(!drive?.running));
$('speedSeg').addEventListener('click', (e) => {
  const x = Number(e.target.dataset?.speed);
  if (!x) return;
  if (!drive && robots.length) bindFleet({ focus: Math.max(0, pickedIndex()) });
  if (drive) drive.speed = x;
  paintClock();
});
$('driveTarget').addEventListener('change', () => {
  const i = pickedIndex();
  const d = fleet[i];
  if (d) {
    drive.name = d.obj.name;
    drive.obj = d.obj;
    drive.rig = d.rig;
    focusRobot(d.obj);
  } else if (robots.length) {
    bindFleet({ play: !!drive?.running, focus: Math.max(0, i) });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pickOn) { setPick(false); return; }
  if (e.code !== 'Space') return;
  const tag = (e.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  e.preventDefault();
  setRunning(!drive?.running);
});

const canvas = stage.renderer.domElement;
canvas.addEventListener('pointermove', (e) => {
  if (!pickOn) return;
  hover(hitAt(e));
});
canvas.addEventListener('pointerleave', () => hover(null));
canvas.addEventListener('click', (e) => {
  if (!pickOn) return;
  const obj = hitAt(e);
  if (!obj || !root) return;
  const id = objectToId(root, obj);
  if (!id) return;
  $('treeSearch').value = obj.name || '';
  applySearch($('treeSearch').value);
  revealInTree(id);
  mark(id);
});

fillSpeeds();
paintClock();

async function boot() {
  const catalogUrl = apiPath('assetViewer');
  if (!catalogUrl) { $('note').textContent = '설정 없음'; return; }
  const q = new URLSearchParams(location.search);
  const url = new URL(catalogUrl, location.origin);
  url.searchParams.set('format', 'json');
  if (q.get('key')) url.searchParams.set('key', q.get('key'));
  const data = await (await fetch(url)).json();
  const items = data.items ?? [];
  const pick = $('assetPick');
  pick.innerHTML = items.map((a) => `<option value="${a.key}">${a.key} (${a.format})</option>`).join('');
  const initial = items.find((a) => a.key === q.get('key')) ?? items[0];
  if (initial) pick.value = initial.key;
  pick.onchange = () => {
    const item = items.find((a) => a.key === pick.value);
    const next = new URL(location.href);
    next.searchParams.set('view', '1');
    if (item) next.searchParams.set('key', item.key);
    history.replaceState(null, '', next);
    show(item);
  };
  await show(initial, {
    play: q.has('play') ? q.get('play') !== '0' : undefined,
    target: q.get('target') || undefined,
  });
}

boot().catch((e) => { $('note').textContent = e.message; });

window.__preview = {
  stage,
  runtime: runtime(),
  get root() { return root; },
  get drive() { return drive; },
  get fleet() { return fleet; },
  get robots() { return robots.map((o) => ({ name: o.name, joints: o.userData.rigPlan?.joints.map((j) => j.name) })); },
  setPick,
  get pickOn() { return pickOn; },
  setRunning,
  bindFleet,
};
