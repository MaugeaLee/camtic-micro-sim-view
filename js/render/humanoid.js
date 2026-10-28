// 창고 휴머노이드 절차 형상: 산업용 이족(흰 셸·관절 구·캡 visor). 시뮬 view(자리 로컬) + 자리 pose 그대로. 그리기만 한다.
// GLB 없음 — 치수·색은 가정. 팔·다리는 시뮬 IK·보폭을 따른다.
import * as THREE from 'three';

const Y_UP = new THREE.Vector3(0, 1, 0);
const Z_FWD = new THREE.Vector3(0, 0, 1);
const DIR = new THREE.Vector3();
const AIM = new THREE.Vector3();

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.22, ...o });

function shade(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

function ball(r, mat, seg = 14) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, seg, 12), mat);
}

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

// 원기둥이 Y, 양끝은 구. 길이만 스케일해도 끝이 안 찌그러진다.
function limb(radius, length, mat) {
  const g = new THREE.Group();
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 14), mat);
  const capA = ball(radius, mat);
  const capB = ball(radius, mat);
  capA.position.y = length / 2;
  capB.position.y = -length / 2;
  g.add(cyl, capA, capB);
  g.userData.cyl = cyl;
  g.userData.capA = capA;
  g.userData.capB = capB;
  g.userData.rest = length;
  shade(g);
  return g;
}

function poseLimb(g, a, b) {
  const rest = g.userData.rest;
  g.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || rest;
  g.userData.cyl.scale.set(1, L / rest, 1);
  g.userData.capA.position.y = L / 2;
  g.userData.capB.position.y = -L / 2;
  DIR.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (DIR.lengthSq() < 1e-10) return;
  g.quaternion.setFromUnitVectors(Y_UP, AIM.copy(DIR).normalize());
}

function gripper(shell, dark) {
  const g = new THREE.Group();
  const palm = box(0.072, 0.042, 0.078, dark);
  palm.position.z = 0.01;
  const knuckle = ball(0.022, dark, 10);
  knuckle.position.z = 0.052;
  const f1 = box(0.016, 0.014, 0.068, shell);
  const f2 = f1.clone();
  f1.position.set(0.024, 0.004, 0.078);
  f2.position.set(-0.024, 0.004, 0.078);
  g.add(palm, knuckle, f1, f2);
  g.userData.fingers = [f1, f2];
  shade(g);
  return g;
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
    const shell = M('#e7edf3', { roughness: 0.38, metalness: 0.18 });
    const dark = M('#2c333b', { roughness: 0.48, metalness: 0.28 });
    const limbMat = M('#c9d2db', { roughness: 0.4, metalness: 0.2 });
    const visor = M('#1ad4e8', { roughness: 0.12, metalness: 0.55, emissive: '#0b5f6c', emissiveIntensity: 0.55 });
    const accent = M('#d9a73a', { roughness: 0.35, metalness: 0.35 });

    this.body = new THREE.Group();
    this.site.add(this.body);

    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.125, 0.08, 5, 16), dark);
    pelvis.position.y = 0.9;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.34, 6, 18), shell);
    torso.position.y = 1.22;
    const chest = box(0.22, 0.16, 0.06, dark);
    chest.position.set(0, 1.26, 0.14);
    const badge = box(0.07, 0.018, 0.012, accent);
    badge.position.set(0, 1.32, 0.172);
    this.lamp = ball(0.018, visor, 10);
    this.lamp.position.set(0, 1.2, 0.172);
    const pack = box(0.2, 0.28, 0.08, dark);
    pack.position.set(0, 1.24, -0.16);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.09, 14), dark);
    neck.position.y = 1.455;
    const skull = ball(0.108, shell, 18);
    skull.position.y = 1.56;
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.118, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.36), dark);
    helm.position.y = 1.575;
    const face = box(0.13, 0.1, 0.04, dark);
    face.position.set(0, 1.545, 0.092);
    const glass = box(0.14, 0.038, 0.028, visor);
    glass.position.set(0, 1.558, 0.118);
    const jaw = box(0.09, 0.035, 0.07, dark);
    jaw.position.set(0, 1.492, 0.06);
    const capL = ball(0.058, shell, 12);
    const capR = ball(0.058, shell, 12);
    capL.position.set(-0.16, 1.355, 0);
    capR.position.set(0.16, 1.355, 0);
    this.body.add(pelvis, torso, chest, badge, this.lamp, pack, neck, skull, helm, face, glass, jaw, capL, capR);
    shade(this.body);

    this.thigh = [limb(0.055, 0.34, limbMat), limb(0.055, 0.34, limbMat)];
    this.shin = [limb(0.045, 0.34, limbMat), limb(0.045, 0.34, limbMat)];
    this.hipJ = [ball(0.058, dark), ball(0.058, dark)];
    this.kneeJ = [ball(0.048, dark), ball(0.048, dark)];
    this.ankleJ = [ball(0.038, dark), ball(0.038, dark)];
    this.foot = [this.makeFoot(shell, dark), this.makeFoot(shell, dark)];
    this.body.add(...this.thigh, ...this.shin, ...this.hipJ, ...this.kneeJ, ...this.ankleJ, ...this.foot);

    this.upper = [limb(0.042, 0.36, limbMat), limb(0.042, 0.36, limbMat)];
    this.fore = [limb(0.036, 0.36, limbMat), limb(0.036, 0.36, limbMat)];
    this.shJ = [ball(0.05, dark), ball(0.05, dark)];
    this.elJ = [ball(0.04, dark), ball(0.04, dark)];
    this.wrJ = [ball(0.032, dark), ball(0.032, dark)];
    this.hand = [gripper(shell, dark), gripper(shell, dark)];
    this.site.add(...this.upper, ...this.fore, ...this.shJ, ...this.elJ, ...this.wrJ, ...this.hand);
  }

  makeFoot(shell, dark) {
    const g = new THREE.Group();
    const sole = box(0.11, 0.045, 0.2, dark);
    sole.position.set(0, 0.022, 0.03);
    const toe = box(0.1, 0.03, 0.07, shell);
    toe.position.set(0, 0.038, 0.11);
    g.add(sole, toe);
    shade(g);
    return g;
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
    const ankles = [[-0.09, 0.055, step * 0.4], [0.09, 0.055, -step * 0.4]];
    for (const i of [0, 1]) {
      poseLimb(this.thigh[i], hips[i], knees[i]);
      poseLimb(this.shin[i], knees[i], ankles[i]);
      this.hipJ[i].position.set(...hips[i]);
      this.kneeJ[i].position.set(...knees[i]);
      this.ankleJ[i].position.set(...ankles[i]);
      this.foot[i].position.set(ankles[i][0], 0, ankles[i][2] + 0.02);
      this.foot[i].rotation.set(0, 0, 0);
    }
    const sides = [view.left, view.right];
    const gap = view.held ? 0.012 : 0.026;
    for (const i of [0, 1]) {
      const a = sides[i];
      if (!a) continue;
      poseLimb(this.upper[i], a.sh, a.el);
      poseLimb(this.fore[i], a.el, a.wr);
      this.shJ[i].position.set(...a.sh);
      this.elJ[i].position.set(...a.el);
      this.wrJ[i].position.set(...a.wr);
      DIR.set(a.wr[0] - a.el[0], a.wr[1] - a.el[1], a.wr[2] - a.el[2]);
      if (DIR.lengthSq() < 1e-10) DIR.set(0, 0, 1);
      else DIR.normalize();
      this.hand[i].position.set(a.wr[0] + DIR.x * 0.045, a.wr[1] + DIR.y * 0.045, a.wr[2] + DIR.z * 0.045);
      this.hand[i].quaternion.setFromUnitVectors(Z_FWD, AIM.copy(DIR));
      const [f1, f2] = this.hand[i].userData.fingers;
      f1.position.x = gap;
      f2.position.x = -gap;
    }
    if (this.lamp?.material) this.lamp.material.emissiveIntensity = view.busy ? 0.9 : 0.35;
  }
}
