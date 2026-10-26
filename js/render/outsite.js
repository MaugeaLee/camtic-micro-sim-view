// 완료품 적재 구역(OUT) 절차 형상: PRESS 크기 셀 프레임 · 울타리 · 뒷벽 책장 · 레일 위 협동로봇.
// 형상·치수는 가정이다(GLB 없음). 팔은 시뮬 joints(outwork.view) 그대로. 그리기만 한다.
import * as THREE from 'three';

// layout FOOTPRINT.OUT · PRESS 와 같은 가정 발자국. sim 을 import 하지 않는다.
const PAD = Object.freeze({ w: 10.1, d: 10.82 });
const Z_FWD = new THREE.Vector3(0, 0, 1);
const DIR = new THREE.Vector3();
const AIM = new THREE.Vector3();

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...o });
const box = (w, h, d, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = true; m.receiveShadow = true; return m; };

export class OutSiteView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'out-site';
    this.root.visible = false;
    scene.add(this.root);
    this.key = null;
    this.arm = null;
  }

  build(view, kit) {
    const key = JSON.stringify([view.shelf, view.slots.map((s) => s.p), view.cobot, kit]);
    if (key === this.key) return;
    this.key = key;
    this.root.clear();
    const steel = M('#9aa3ad'), dark = M('#2c3138'), wood = M('#6b5340'), yellow = M('#d9a73a');
    const pad = M('#3a4a3f', { roughness: 0.9, metalness: 0 }), accent = M('#c4a574'), white = M('#d8dde3', { roughness: 0.45, metalness: 0.15 });
    const { w, d } = PAD;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), pad);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.004;
    floor.receiveShadow = true;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.001, d)), new THREE.LineBasicMaterial({ color: '#e8c547' }));
    edge.position.y = 0.006;
    this.root.add(floor, edge);
    this.buildFrame(w, d, steel, white, yellow);
    this.buildFence(w, d, steel, yellow);
    this.buildDock(dark, yellow);
    this.buildShelf(view.shelf, view.slots, kit, wood, dark, steel, accent);
    this.buildArm(view.cobot, steel, yellow, dark);
  }

  // PRESS 셀처럼 보이는 골조. 책장 높이(~3 m)를 덮는 가정 프레임.
  buildFrame(w, d, steel, white, yellow) {
    const H = 3.35, t = 0.12, inset = 0.08;
    const xs = [-w / 2 + inset, w / 2 - inset], zs = [-d / 2 + inset, d / 2 - inset];
    for (const x of xs) for (const z of zs) {
      const p = box(t, H, t, white);
      p.position.set(x, H / 2, z);
      this.root.add(p);
    }
    for (const [x0, x1, z0, z1] of [
      [xs[0], xs[1], zs[0], zs[0]],
      [xs[0], xs[1], zs[1], zs[1]],
      [xs[0], xs[0], zs[0], zs[1]],
      [xs[1], xs[1], zs[0], zs[1]],
    ]) {
      const bw = Math.max(t, Math.abs(x1 - x0)), bd = Math.max(t, Math.abs(z1 - z0));
      const beam = box(bw, t, bd, white);
      beam.position.set((x0 + x1) / 2, H - t / 2, (z0 + z1) / 2);
      this.root.add(beam);
    }
    const plate = box(1.6, 0.28, 0.04, yellow);
    plate.position.set(0, H - 0.42, d / 2 - inset);
    this.root.add(plate);
    const bar = box(w - 0.4, 0.05, 0.05, steel);
    bar.position.set(0, H - 0.18, 0);
    this.root.add(bar);
  }

  buildFence(w, d, steel, yellow) {
    const fh = 1.15, post = 0.08;
    for (const x of [-w / 2 + 0.15, w / 2 - 0.15]) for (const z of [-d / 2 + 0.15, d / 2 - 0.15]) {
      const p = box(post, fh, post, steel);
      p.position.set(x, fh / 2, z);
      this.root.add(p);
    }
    // +z(입구)는 열어 둔다
    for (const [x0, x1, z0, z1] of [
      [-w / 2 + 0.2, w / 2 - 0.2, -d / 2 + 0.15, -d / 2 + 0.15],
      [-w / 2 + 0.15, -w / 2 + 0.15, -d / 2 + 0.2, d / 2 - 0.2],
      [w / 2 - 0.15, w / 2 - 0.15, -d / 2 + 0.2, d / 2 - 0.2],
    ]) {
      const rw = Math.max(0.04, Math.abs(x1 - x0) || 0.04), rd = Math.max(0.04, Math.abs(z1 - z0) || 0.04);
      const r = box(rw, 0.04, rd, yellow);
      r.position.set((x0 + x1) / 2, fh - 0.04, (z0 + z1) / 2);
      this.root.add(r);
    }
  }

  buildDock(dark, yellow) {
    const plate = box(1.7, 0.02, 2.2, dark);
    plate.position.set(0, 0.012, 0.15);
    const mark = box(0.55, 0.015, 0.9, yellow);
    mark.position.set(0, 0.022, 0.15);
    this.root.add(plate, mark);
  }

  buildShelf(S, slots, kit, wood, dark, steel, accent) {
    const W = PAD.w - 1.35, D = S.depth, z = S.z, decks = S.decks;
    const top = decks.at(-1) + kit[0] + 0.12;
    const back = box(W + 0.16, top, 0.06, wood);
    back.position.set(0, top / 2, z - D / 2 - 0.03);
    this.root.add(back);
    for (const x of [-(W / 2), W / 2]) {
      const side = box(0.07, top, D + 0.1, wood);
      side.position.set(x, top / 2, z);
      this.root.add(side);
    }
    for (const y of [0.06, ...decks, top - 0.03]) {
      const deck = box(W, 0.045, D, dark);
      deck.position.set(0, y, z);
      this.root.add(deck);
    }
    const xs = [...new Set(slots.map((s) => s.p[0]))].sort((a, b) => a - b);
    const pitch = xs.length > 1 ? xs[1] - xs[0] : 0.38;
    const n = Math.max(2, Math.round(W / pitch));
    for (let i = 1; i < n; i++) {
      const x = -W / 2 + i * (W / n);
      const div = box(0.02, top - 0.12, D - 0.08, accent);
      div.position.set(x, (top - 0.12) / 2 + 0.06, z);
      this.root.add(div);
    }
    for (const s of slots) {
      const mark = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(kit[1] + 0.02, 0.002, kit[2])), new THREE.LineBasicMaterial({ color: '#9fb3c8' }));
      mark.position.set(s.p[0], s.p[1] + 0.022, s.p[2]);
      this.root.add(mark);
    }
    for (const x of [-W / 2, W / 2]) {
      const foot = box(0.14, 0.08, D + 0.12, steel);
      foot.position.set(x, 0.04, z);
      this.root.add(foot);
    }
  }

  buildArm(C, steel, yellow, dark) {
    const rail = box(C.rail.hi - C.rail.lo + 0.5, 0.08, 0.22, dark);
    rail.position.set((C.rail.lo + C.rail.hi) / 2, 0.05, C.base.z);
    this.root.add(rail);
    const car = new THREE.Group();
    const shoe = box(0.42, 0.1, 0.36, steel);
    shoe.position.y = 0.1;
    const post = box(0.16, C.base.y, 0.16, steel);
    post.position.y = C.base.y / 2;
    const hub = box(0.22, 0.16, 0.22, yellow);
    hub.position.y = C.base.y;
    car.add(shoe, post, hub);
    car.position.set(0, 0, C.base.z);
    const upper = box(0.11, 0.11, C.L1, yellow);
    const fore = box(0.1, 0.1, C.L2, yellow);
    const grip = new THREE.Group();
    const wrist = box(0.12, 0.12, 0.12, steel);
    const pad = box(0.22, 0.05, 0.16, dark);
    pad.position.z = 0.1;
    const j1 = box(0.03, 0.1, 0.08, steel); j1.position.set(-0.09, 0, 0.14);
    const j2 = box(0.03, 0.1, 0.08, steel); j2.position.set(0.09, 0, 0.14);
    grip.add(wrist, pad, j1, j2);
    this.root.add(car, upper, fore, grip);
    this.arm = { car, upper, fore, grip, L1: C.L1, L2: C.L2 };
  }

  place(pose) {
    if (!pose) { this.root.visible = false; return; }
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = (pose.rotY * Math.PI) / 180;
  }

  update(view, kit, pose) {
    if (!view || !pose) { this.root.visible = false; return; }
    this.build(view, kit);
    this.place(pose);
    this.root.visible = true;
    const { car, upper, fore, grip, L1, L2 } = this.arm;
    const [sh, el, wr] = view.joints;
    car.position.x = view.rail;
    this.seg(upper, sh, el, L1);
    this.seg(fore, el, wr, L2);
    grip.position.set(view.tcp[0], view.tcp[1], view.tcp[2]);
    this.aim(grip, wr, view.tcp);
  }

  seg(mesh, a, b, len) {
    mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || len;
    mesh.scale.set(1, 1, L / len);
    this.aim(mesh, a, b);
  }

  aim(mesh, a, b) {
    DIR.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (DIR.lengthSq() < 1e-10) return;
    mesh.quaternion.setFromUnitVectors(Z_FWD, AIM.copy(DIR).normalize());
  }
}
