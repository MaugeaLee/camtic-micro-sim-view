// /api/asset-viewer 테스트 뷰포트. 메인 시뮬 뷰어와 분리.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStage } from '../render/stage.js';
import { runtime, apiPath } from '../core/runtime.js';
import { toTree, countNodes, findObject, objectToId, ancestorIds, renderTreeHtml } from './tree.js';

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
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  clock.getDelta();
  if (helper) helper.update();
  if (hoverHelper) hoverHelper.update();
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

async function show(item) {
  hold.clear();
  root = null;
  fillTree();
  if (!item?.url) { $('note').textContent = '에셋 없음'; return; }
  $('note').textContent = `로드 ${item.key}…`;
  try {
    const gltf = await loader.loadAsync(item.url);
    root = gltf.scene;
    hold.add(root);
    fit(root);
    paintTree(root);
    $('note').textContent = `${item.key} · ${item.format} · ${item.bytes} B`;
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pickOn) setPick(false); });

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
  await show(initial);
}

boot().catch((e) => { $('note').textContent = e.message; });

window.__preview = { stage, runtime: runtime(), get root() { return root; }, setPick, get pickOn() { return pickOn; } };
