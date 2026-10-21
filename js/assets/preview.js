// /api/asset-viewer 테스트 뷰포트. 메인 시뮬 뷰어와 분리.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStage } from '../render/stage.js';
import { runtime, apiPath } from '../core/runtime.js';
import { SPEEDS } from '../core/env.js';
import { toTree, countNodes, findObject, objectToId, ancestorIds, renderTreeHtml, esc } from './tree.js';
import { recipeFor, jointWave, travelWave, spinWave, gantryWave } from './anim.js';
import { pointOnTrack } from './movers.js';
import { planFor, scanMovers } from './scan.js';

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
let movers = [];
let fleet = [];
const KIND_LABEL = { arm: '팔', amr: 'AMR', rollers: '롤러', track: '레일', gantry: '직교' };
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

function localDir(obj, worldDir) {
  const parent = obj.parent;
  if (!parent) return new THREE.Vector3(...worldDir);
  parent.updateWorldMatrix(true, false);
  return new THREE.Vector3(...worldDir).transformDirection(parent.matrixWorld.clone().invert()).normalize();
}

function worldCenter(obj) {
  obj.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
}

function addPivot(parent, origin, axisWorld, name, from) {
  parent.updateWorldMatrix(true, false);
  const p = new THREE.Group();
  p.name = name;
  p.position.copy(parent.worldToLocal(new THREE.Vector3(...origin)));
  const ax = new THREE.Vector3(...axisWorld).transformDirection(parent.matrixWorld.clone().invert()).normalize();
  p.userData = { axis: ax.toArray(), from };
  parent.add(p);
  return { pivot: p, axis: ax };
}

// 추정한 관절마다 빈 피벗(J1…)을 관절 원점에 두고 링크 부품을 그 아래로 옮긴다 — 참조 레포 nativeChain 과 같은 구조
function rigGroup(group) {
  if (group.userData.rig) return group.userData.rig;
  const plan = planFor(group);
  if (!plan || plan.kind !== 'arm') return null;
  group.updateWorldMatrix(true, true);
  const pivots = [], axes = [];
  plan.arm.joints.forEach((j, i) => {
    const parent = j.parent >= 0 ? pivots[j.parent] : group;
    const { pivot, axis } = addPivot(parent, j.origin, j.axis, `J${i + 1}`, j.name);
    pivot.userData.lower = -Math.PI;
    pivot.userData.upper = Math.PI;
    pivots.push(pivot);
    axes.push(axis);
  });
  plan.objects.forEach((o, k) => { if (plan.arm.link[k] >= 0) pivots[plan.arm.link[k]].attach(o); });
  const rig = { root: group, pivots, axes };
  group.userData.rig = rig;
  return rig;
}

function rigSpinners(group, items, objects, prefix) {
  if (group.userData.spinRig) return group.userData.spinRig;
  group.updateWorldMatrix(true, true);
  const pivots = [], axes = [];
  items.forEach((w, i) => {
    const obj = objects[w.i];
    if (!obj) return;
    const { pivot, axis } = addPivot(obj.parent, w.center, w.axis, `${prefix}${i + 1}`, w.name);
    pivot.attach(obj);
    pivots.push(pivot);
    axes.push(axis);
  });
  const rig = { root: group, pivots, axes };
  group.userData.spinRig = rig;
  return rig;
}

function poseRig(rig, qs) {
  if (!rig) return;
  rig.pivots.forEach((p, i) => p.quaternion.setFromAxisAngle(rig.axes[i], qs[i] ?? 0));
}

function rigGantry(group, plan, objects) {
  if (group.userData.gantryRig) return group.userData.gantryRig;
  group.updateWorldMatrix(true, true);
  const { pivot: lift, axis: horiz } = addPivot(group, plan.origin, plan.horiz, 'GX', 'cross');
  const { pivot: tool, axis: up } = addPivot(lift, plan.toolOrigin, plan.up, 'GZ', 'lift');
  const toolSet = new Set(plan.tool.map((x) => x.i));
  const liftSet = new Set(plan.lift.map((x) => x.i));
  objects.forEach((o, i) => {
    if (toolSet.has(i)) tool.attach(o);
    else if (liftSet.has(i)) lift.attach(o);
  });
  const rig = {
    lift,
    tool,
    horiz,
    up,
    homeLift: lift.position.clone(),
    homeTool: tool.position.clone(),
  };
  group.userData.gantryRig = rig;
  return rig;
}

function coupleSlide(entry, tracks) {
  if (entry.kind !== 'arm' || !tracks.length) return;
  const c = worldCenter(entry.obj).toArray();
  let best = null;
  for (const t of tracks) {
    const hit = pointOnTrack(c, t.plan);
    if (!hit.on) continue;
    if (!best || hit.radial < best.radial) best = { track: t, hit };
  }
  if (!best) return;
  entry.slide = {
    home: entry.obj.position.clone(),
    axis: localDir(entry.obj, best.track.plan.axis),
    amp: best.track.plan.amp,
  };
}

function makeDrive(m, i) {
  const phase = i * 0.45;
  const obj = m.obj;
  if (m.kind === 'arm') {
    const rig = rigGroup(obj);
    if (!rig) return null;
    poseRig(rig, []);
    return { kind: 'arm', obj, rig, phase };
  }
  if (m.kind === 'amr') {
    const spins = rigSpinners(obj, m.plan.wheels, m.plan.objects, 'W');
    return { kind: 'amr', obj, spins, phase, home: obj.position.clone(), fwd: localDir(obj, m.plan.forward), radius: m.plan.radius, amp: 0.35 };
  }
  if (m.kind === 'rollers') {
    const spins = rigSpinners(obj, m.plan.rollers, m.plan.objects, 'R');
    return { kind: 'rollers', obj, spins, phase };
  }
  if (m.kind === 'gantry') {
    const g = rigGantry(obj, m.plan, m.plan.objects);
    return { kind: 'gantry', obj, ...g, ampX: m.plan.ampX, ampZ: m.plan.ampZ, phase };
  }
  if (m.kind === 'track') return { kind: 'track', obj, phase, plan: m.plan };
  return null;
}

function resetDrive(d) {
  if (d.home) d.obj.position.copy(d.home);
  if (d.slide) d.obj.position.copy(d.slide.home);
  if (d.homeLift) d.lift.position.copy(d.homeLift);
  if (d.homeTool) d.tool.position.copy(d.homeTool);
  poseRig(d.rig, []);
  poseRig(d.spins, []);
}

function releaseDrive() {
  for (const d of fleet) resetDrive(d);
  fleet = [];
  drive = null;
}

function bindFleet({ play = false, focus = 0 } = {}) {
  const was = { running: play || !!drive?.running, speed: drive?.speed ?? 1 };
  releaseDrive();
  const tracks = movers.filter((m) => m.kind === 'track');
  fleet = movers.map((m, i) => makeDrive(m, i)).filter(Boolean);
  for (const d of fleet) coupleSlide(d, tracks);
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
  focusMover(pick.obj);
  paintClock();
  return true;
}

function focusMover(obj) {
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
  const t = drive.time;
  for (const d of fleet) {
    if (d.kind === 'arm') {
      poseRig(d.rig, jointWave(t, d.rig.pivots.length, { ...drive.recipe, phase: d.phase }));
      if (d.slide) {
        const s = travelWave(t, { amp: d.slide.amp, rate: 0.55, phase: d.phase + 0.8 });
        d.obj.position.copy(d.slide.home).addScaledVector(d.slide.axis, s);
      }
    } else if (d.kind === 'amr') {
      const s = travelWave(t, { amp: d.amp, rate: 0.7, phase: d.phase });
      d.obj.position.copy(d.home).addScaledVector(d.fwd, s);
      const q = d.radius > 1e-6 ? -s / d.radius : 0;
      poseRig(d.spins, d.spins.pivots.map(() => q));
    } else if (d.kind === 'rollers') {
      const q = spinWave(t, { rate: 2.4, phase: d.phase });
      poseRig(d.spins, d.spins.pivots.map(() => q));
    } else if (d.kind === 'gantry') {
      const g = gantryWave(t, { ampX: d.ampX, ampZ: d.ampZ, phase: d.phase });
      d.lift.position.copy(d.homeLift).addScaledVector(d.horiz, g.x);
      d.tool.position.copy(d.homeTool).addScaledVector(d.up, g.z);
    }
  }
}

function pickedIndex() {
  const v = $('driveTarget').value;
  return v === '' ? -1 : Number(v);
}

function setRunning(on) {
  if (!drive && movers.length) bindFleet({ play: on, focus: Math.max(0, pickedIndex()) });
  if (!drive) return;
  drive.running = !!on;
  paintClock();
}

function fillTargets(pref) {
  const pick = $('driveTarget');
  pick.innerHTML = movers.length
    ? movers.map((m, i) => `<option value="${i}">${esc(m.obj.name || m.kind)} · ${KIND_LABEL[m.kind] ?? m.kind}</option>`).join('')
    : '<option value="">대상 없음</option>';
  const hit = movers.findIndex((m) => m.obj.name === pref);
  if (movers.length) pick.value = String(hit >= 0 ? hit : 0);
}

function fillSpeeds() {
  $('speedSeg').innerHTML = SPEEDS.map((x) => `<button type="button" data-speed="${x}">${x}×</button>`).join('');
}

async function show(item, { play, target } = {}) {
  hold.clear();
  root = null;
  releaseDrive();
  movers = [];
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
    movers = scanMovers(root);
    fillTargets(recipeFor(assetKey, { name: target }).name);
    const shouldPlay = play === true || (play !== false && movers.length > 0);
    const ok = bindFleet({ play: shouldPlay, focus: Math.max(0, pickedIndex()) });
    const n = (k) => movers.filter((m) => m.kind === k).length;
    $('note').textContent = ok
      ? `${item.key} · 팔 ${n('arm')} · 직교 ${n('gantry')} · AMR ${n('amr')} · 롤러 ${n('rollers')} · 레일 ${n('track')}${shouldPlay ? ' 재생' : ''}`
      : `${item.key} · ${item.format} · ${item.bytes} B · 대상 ${movers.length}`;
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
  if (!drive && movers.length) bindFleet({ focus: Math.max(0, pickedIndex()) });
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
    focusMover(d.obj);
  } else if (movers.length) {
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
  get movers() { return movers.map((m) => ({ name: m.obj.name, kind: m.kind })); },
  get robots() {
    return movers.filter((m) => m.kind === 'arm').map((m) => ({
      name: m.obj.name,
      joints: m.plan.arm?.joints.map((j) => j.name),
    }));
  },
  setPick,
  get pickOn() { return pickOn; },
  setRunning,
  bindFleet,
};
