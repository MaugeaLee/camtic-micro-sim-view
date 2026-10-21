// 짓기: 바닥 레이캐스트 · 격자 스냅 · 드래그. 궤도 회전은 우클릭.
// 자리 판정(canPlace · poseOf · extent)은 main이 넘긴다 — render가 sim을 import 하지 않는다.
import * as THREE from 'three';

export class PlaceTool {
  constructor(stage, view, floor, { onChange, canPlace, poseOf, extent } = {}) {
    this.stage = stage;
    this.view = view;
    this.floor = floor;
    this.onChange = onChange;
    this.canPlace = canPlace;
    this.poseOf = poseOf;
    this.extent = extent;
    this.doc = null;
    this.hold = null;
    this.selected = null;
    this.drag = false;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();

    const mat = new THREE.MeshBasicMaterial({ color: 0x3ccf8e, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 1), mat);
    this.ghost.name = 'ghost';
    this.ghost.visible = false;
    this.ghost.receiveShadow = false;
    this.ghost.castShadow = false;
    stage.scene.add(this.ghost);

    const el = stage.renderer.domElement;
    this.onDown = (e) => this.pointerDown(e);
    this.onMove = (e) => this.pointerMove(e);
    this.onUp = (e) => this.pointerUp(e);
    this.onKey = (e) => this.key(e);
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey);

    stage.controls.mouseButtons.LEFT = -1;
    stage.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    stage.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  }

  setLayout(doc) { this.doc = doc; }

  pick(id) { this.hold = id; this.drag = false; }

  dispose() {
    const el = this.stage.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    this.stage.scene.remove(this.ghost);
    this.ghost.geometry.dispose();
    this.ghost.material.dispose();
    this.stage.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.stage.controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    this.stage.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  }

  pointerDown(e) {
    if (e.button !== 0) return;
    const cell = this.hitCell(e);
    if (cell) { this.hold = cell; this.drag = true; e.preventDefault(); }
  }

  pointerMove(e) {
    if (!this.hold || !this.doc) { this.ghost.visible = false; return; }
    const pose = this.poseAt(e, this.doc.cells[this.hold].rotY);
    if (!pose) { this.ghost.visible = false; return; }
    const ok = this.canPlace(this.doc, this.hold, pose).length === 0;
    this.showGhost(this.hold, pose, ok);
    if (ok) this.view.applyLayout({ ...this.doc, cells: { ...this.doc.cells, [this.hold]: pose } });
    else this.view.applyLayout(this.doc);
  }

  pointerUp(e) {
    if (e.button !== 0 || !this.hold || !this.doc) return;
    const pose = this.poseAt(e, this.doc.cells[this.hold].rotY);
    const id = this.hold;
    this.hold = null;
    this.drag = false;
    this.ghost.visible = false;
    if (!pose || this.canPlace(this.doc, id, pose).length) {
      this.view.applyLayout(this.doc);
      return;
    }
    this.doc = { ...this.doc, cells: { ...this.doc.cells, [id]: pose } };
    this.view.applyLayout(this.doc);
    this.onChange?.(this.doc);
  }

  key(e) {
    if (e.key !== 'r' && e.key !== 'R') return;
    const id = this.hold ?? this.selected;
    if (!id || !this.doc) return;
    const cur = this.doc.cells[id];
    const pose = this.poseOf(cur.x, cur.z, cur.rotY + 90, this.doc.snap);
    if (this.canPlace(this.doc, id, pose).length) return;
    this.doc = { ...this.doc, cells: { ...this.doc.cells, [id]: pose } };
    this.view.applyLayout(this.doc);
    this.onChange?.(this.doc);
  }

  poseAt(e, rotY) {
    const p = this.hitFloor(e);
    if (!p) return null;
    return this.poseOf(p.x, p.z, rotY, this.doc.snap);
  }

  showGhost(id, pose, ok) {
    const e = this.extent(id, pose.rotY);
    this.ghost.scale.set(e.w, 1, e.d);
    this.ghost.position.set(pose.x, 0.04, pose.z);
    this.ghost.material.color.setHex(ok ? 0x3ccf8e : 0xff5d5d);
    this.ghost.visible = true;
  }

  hitFloor(e) {
    this.fromEvent(e);
    const hit = this.ray.intersectObject(this.floor, false)[0];
    return hit?.point ?? null;
  }

  hitCell(e) {
    this.fromEvent(e);
    const meshes = [];
    this.view.root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const hit = this.ray.intersectObjects(meshes, false)[0];
    let o = hit?.object;
    while (o) {
      if (o.userData.cellId) return o.userData.cellId;
      o = o.parent;
    }
    return null;
  }

  fromEvent(e) {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.stage.camera);
  }
}
