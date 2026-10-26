// 짓기: 바닥 레이캐스트 · 격자 스냅 · 드래그. 궤도 회전은 우클릭.
// 셀·자리(OUT·PARTS)와 이동 레일(지선)은 따로 다룬다. 레일은 몸통 이동 · 끝점 늘림/줄임 · R 회전.
// 자리 판정 함수는 main이 넘긴다 — render가 sim을 import 하지 않는다.
import * as THREE from 'three';

export class PlaceTool {
  constructor(stage, view, floor, {
    onChange, onPreview, canPlace, poseOf, extent, placeItem,
    translateSpur, moveSpurEnd, rotateSpur, sites, spur,
  } = {}) {
    this.stage = stage;
    this.view = view;
    this.floor = floor;
    this.onChange = onChange;
    this.onPreview = onPreview;
    this.canPlace = canPlace;
    this.poseOf = poseOf;
    this.extent = extent;
    this.placeItem = placeItem;
    this.translateSpur = translateSpur;
    this.moveSpurEnd = moveSpurEnd;
    this.rotateSpur = rotateSpur;
    this.sites = sites ?? [];
    this.spur = spur ?? {};
    this.doc = null;
    this.hold = null;
    this.selected = null;
    this.drag = false;
    this.grab = null;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();

    const mat = new THREE.MeshBasicMaterial({ color: 0x3ccf8e, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 1), mat);
    this.ghost.name = 'ghost';
    this.ghost.visible = false;
    this.ghost.receiveShadow = false;
    this.ghost.castShadow = false;
    stage.scene.add(this.ghost);

    this.railMat = new THREE.MeshBasicMaterial({ color: 0xd9a73a, transparent: true, opacity: 0.55, depthWrite: false });
    this.endMat = new THREE.MeshBasicMaterial({ color: 0xf0c45a, transparent: true, opacity: 0.9, depthWrite: false });
    this.rails = new THREE.Group();
    this.rails.name = 'place-rails';
    stage.scene.add(this.rails);

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

  setLayout(doc) { this.doc = doc; this.buildRails(doc); }

  pick(id) { this.hold = id; this.selected = id; this.drag = false; }

  dispose() {
    const el = this.stage.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    this.stage.scene.remove(this.ghost);
    this.stage.scene.remove(this.rails);
    this.ghost.geometry.dispose();
    this.ghost.material.dispose();
    this.railMat.dispose();
    this.endMat.dispose();
    this.rails.clear();
    this.stage.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.stage.controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    this.stage.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  }

  poseOfId(id) { return this.doc?.cells?.[id] ?? this.doc?.sites?.[id] ?? null; }

  draft(id, pose) {
    return this.placeItem ? this.placeItem(this.doc, id, pose) : { ...this.doc, cells: { ...this.doc.cells, [id]: pose } };
  }

  show(doc) {
    this.buildRails(doc);
    if (this.onPreview) this.onPreview(doc);
    else this.view.applyLayout(doc);
  }

  railSite(id) {
    const s = String(id ?? '');
    if (s.startsWith('RAILEND:')) return s.split(':')[1];
    if (s.startsWith('RAIL:')) return s.slice(5);
    return null;
  }

  buildRails(doc) {
    this.rails.clear();
    if (!doc?.amr?.route?.nodes) return;
    for (const [site, ids] of Object.entries(this.spur)) {
      const pts = ids.map((id) => doc.amr.route.nodes.find((n) => n.id === id)).filter(Boolean);
      if (pts.length < 2) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = Math.max(0.4, Math.hypot(b.x - a.x, b.z - a.z));
        const yaw = Math.atan2(b.x - a.x, b.z - a.z);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, len), this.railMat);
        bar.position.set((a.x + b.x) / 2, 0.07, (a.z + b.z) / 2);
        bar.rotation.y = yaw;
        bar.userData.rail = { site, end: null };
        this.rails.add(bar);
        for (const [end, p] of [[0, a], [1, b]]) {
          const cap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.62), this.endMat);
          cap.position.set(p.x, 0.1, p.z);
          cap.userData.rail = { site, end };
          this.rails.add(cap);
        }
      }
    }
  }

  pointerDown(e) {
    if (e.button !== 0) return;
    const rail = this.hitRail(e);
    if (rail) {
      const at = this.hitFloor(e);
      this.hold = rail.end == null ? `RAIL:${rail.site}` : `RAILEND:${rail.site}:${rail.end}`;
      this.selected = `RAIL:${rail.site}`;
      this.grab = at ? { x: at.x, z: at.z } : null;
      this.drag = true;
      e.preventDefault();
      return;
    }
    const id = this.hitItem(e);
    if (id) { this.hold = id; this.selected = id; this.drag = true; e.preventDefault(); return; }
    if (this.hold?.startsWith('RAIL:') || this.selected?.startsWith('RAIL:')) {
      const site = this.railSite(this.hold ?? this.selected);
      const at = this.hitFloor(e);
      this.hold = `RAIL:${site}`;
      this.selected = this.hold;
      this.grab = at ? { x: at.x, z: at.z } : null;
      this.drag = true;
      e.preventDefault();
    }
  }

  pointerMove(e) {
    if (!this.hold || !this.doc) { this.ghost.visible = false; return; }
    if (this.hold.startsWith('RAILEND:')) {
      const [, site, end] = this.hold.split(':');
      const at = this.poseAt(e, 0);
      if (!at || !this.moveSpurEnd) { this.ghost.visible = false; return; }
      this.ghost.visible = false;
      this.show(this.moveSpurEnd(this.doc, site, Number(end), at.x, at.z));
      return;
    }
    if (this.hold.startsWith('RAIL:')) {
      const site = this.hold.slice(5);
      const at = this.hitFloor(e);
      if (!at || !this.grab || !this.translateSpur) { this.ghost.visible = false; return; }
      const snap = this.doc.snap || 1;
      const dx = Math.round((at.x - this.grab.x) / snap) * snap;
      const dz = Math.round((at.z - this.grab.z) / snap) * snap;
      this.ghost.visible = false;
      this.show(this.translateSpur(this.doc, site, dx, dz));
      return;
    }
    const cur = this.poseOfId(this.hold);
    if (!cur) { this.ghost.visible = false; return; }
    const pose = this.poseAt(e, cur.rotY);
    if (!pose) { this.ghost.visible = false; return; }
    const ok = this.canPlace(this.doc, this.hold, pose).length === 0;
    this.showGhost(this.hold, pose, ok);
    this.show(ok ? this.draft(this.hold, pose) : this.doc);
  }

  pointerUp(e) {
    if (e.button !== 0 || !this.hold || !this.doc) return;
    if (this.hold.startsWith('RAILEND:')) {
      const [, site, end] = this.hold.split(':');
      const at = this.poseAt(e, 0);
      this.hold = null;
      this.grab = null;
      this.drag = false;
      this.ghost.visible = false;
      if (!at) { this.show(this.doc); return; }
      const next = this.moveSpurEnd(this.doc, site, Number(end), at.x, at.z);
      this.doc = next;
      this.show(next);
      this.onChange?.(next);
      return;
    }
    if (this.hold.startsWith('RAIL:')) {
      const site = this.hold.slice(5);
      const at = this.hitFloor(e);
      const snap = this.doc.snap || 1;
      const dx = at && this.grab ? Math.round((at.x - this.grab.x) / snap) * snap : 0;
      const dz = at && this.grab ? Math.round((at.z - this.grab.z) / snap) * snap : 0;
      this.hold = null;
      this.grab = null;
      this.drag = false;
      this.ghost.visible = false;
      if (!dx && !dz) { this.show(this.doc); return; }
      const next = this.translateSpur(this.doc, site, dx, dz);
      this.doc = next;
      this.show(next);
      this.onChange?.(next);
      return;
    }
    const cur = this.poseOfId(this.hold);
    const pose = cur ? this.poseAt(e, cur.rotY) : null;
    const id = this.hold;
    this.hold = null;
    this.drag = false;
    this.ghost.visible = false;
    if (!pose || !cur || this.canPlace(this.doc, id, pose).length) {
      this.show(this.doc);
      return;
    }
    this.doc = this.draft(id, pose);
    this.show(this.doc);
    this.onChange?.(this.doc);
  }

  key(e) {
    if (e.key !== 'r' && e.key !== 'R') return;
    const id = this.hold ?? this.selected;
    if (!id || !this.doc) return;
    const site = this.railSite(id);
    if (site) {
      if (!this.rotateSpur) return;
      const next = this.rotateSpur(this.doc, site, 90);
      this.doc = next;
      this.show(next);
      this.onChange?.(next);
      return;
    }
    const cur = this.poseOfId(id);
    if (!cur) return;
    const pose = this.poseOf(cur.x, cur.z, cur.rotY + 90, this.doc.snap);
    if (this.canPlace(this.doc, id, pose).length) return;
    this.doc = this.draft(id, pose);
    this.show(this.doc);
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

  hitRail(e) {
    this.fromEvent(e);
    const meshes = this.rails.children.filter((o) => o.isMesh);
    const hit = this.ray.intersectObjects(meshes, false)[0];
    return hit?.object?.userData?.rail ?? null;
  }

  hitItem(e) {
    this.fromEvent(e);
    const meshes = [];
    this.view.root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const root of this.sites) root?.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const hit = this.ray.intersectObjects(meshes, false)[0];
    let o = hit?.object;
    while (o) {
      if (o.userData.cellId) return o.userData.cellId;
      if (o.userData.siteId) return o.userData.siteId;
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
