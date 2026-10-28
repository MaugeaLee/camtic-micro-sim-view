// 창고 휴머노이드 절차 형상: 몸통·두 팔·두 다리. 시뮬 view(자리 로컬) + 자리 pose 그대로. 그리기만 한다.
// GLB 없음 — 치수·색은 가정(OUT 협동로봇과 같은 노랑·강재 톤).
import * as THREE from 'three';

const Z_FWD = new THREE.Vector3(0, 0, 1);
const DIR = new THREE.Vector3();
const AIM = new THREE.Vector3();

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.18, ...o });
const box = (w, h, d, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = true; m.receiveShadow = true; return m; };

function seg(mesh, a, b, len) {
  mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || len;
  mesh.scale.set(1, 1, L / len);
  DIR.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (DIR.lengthSq() < 1e-10) return;
  mesh.quaternion.setFromUnitVectors(Z_FWD, AIM.copy(DIR).normalize());
}

export class HumanoidView {
  constructor(scene, { id = 'HUM' } = {}) {
    this.id = id;
    this.root = new THREE.Group();
    this.root.name = `humanoid-${id}`;
    this.root.visible = false;
    scene.add(this.root);
    this.site = new THREE.Group();
    this.root.add(this.site);
    this.build();
  }

  build() {
    const steel = M('#b7c0c8'), dark = M('#3a4149'), limb = M('#8a96a6'), visor = M('#3fd0e6', { roughness: 0.25, metalness: 0.4 });
    this.body = new THREE.Group();
    this.site.add(this.body);
    const pelvis = box(0.3, 0.14, 0.18, dark);
    pelvis.position.y = 0.92;
    const torso = box(0.32, 0.44, 0.2, steel);
    torso.position.y = 1.22;
    const head = box(0.18, 0.2, 0.18, dark);
    head.position.y = 1.54;
    const glass = box(0.16, 0.06, 0.04, visor);
    glass.position.set(0, 1.56, 0.09);
    this.body.add(pelvis, torso, head, glass);
    this.thigh = [box(0.1, 0.1, 0.38, limb), box(0.1, 0.1, 0.38, limb)];
    this.shin = [box(0.08, 0.08, 0.38, limb), box(0.08, 0.08, 0.38, limb)];
    this.foot = [box(0.12, 0.06, 0.22, dark), box(0.12, 0.06, 0.22, dark)];
    this.body.add(...this.thigh, ...this.shin, ...this.foot);
    this.upper = [box(0.08, 0.08, 0.42, limb), box(0.08, 0.08, 0.42, limb)];
    this.fore = [box(0.07, 0.07, 0.42, limb), box(0.07, 0.07, 0.42, limb)];
    this.hand = [box(0.1, 0.08, 0.12, dark), box(0.1, 0.08, 0.12, dark)];
    this.site.add(...this.upper, ...this.fore, ...this.hand);
  }

  update(view, pose) {
    if (!view || !pose) { this.root.visible = false; return; }
    this.root.visible = true;
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = (pose.rotY * Math.PI) / 180;
    this.body.position.set(view.x, 0, view.z);
    this.body.rotation.y = view.w;
    const H = view.height ?? 1.65;
    const hipY = H * 0.55, kneeY = H * 0.28;
    const step = Math.sin((view.phase ?? 0) * 6.2) * (view.busy ? 0.22 : 0.04);
    const hips = [[-0.09, hipY, 0], [0.09, hipY, 0]];
    const knees = [[-0.09, kneeY, step], [0.09, kneeY, -step]];
    const ankles = [[-0.09, 0.06, step * 0.4], [0.09, 0.06, -step * 0.4]];
    for (const i of [0, 1]) {
      seg(this.thigh[i], hips[i], knees[i], 0.38);
      seg(this.shin[i], knees[i], ankles[i], 0.38);
      this.foot[i].position.set(ankles[i][0], 0.03, ankles[i][2] + 0.04);
      this.foot[i].rotation.set(0, 0, 0);
    }
    const sides = [view.left, view.right];
    for (const i of [0, 1]) {
      const a = sides[i];
      if (!a) continue;
      seg(this.upper[i], a.sh, a.el, view.L1 ?? 0.42);
      seg(this.fore[i], a.el, a.wr, view.L2 ?? 0.42);
      this.hand[i].position.set(a.wr[0], a.wr[1], a.wr[2]);
    }
  }
}
