// 견마 그리기. 참조 레포 사족 GLB(`quadruped.glb`)를 붙이고, 시뮬이 준 위치·heading·gait 로 대각 보행만 한다.
// 관절 빈 객체 이름(Body · Hip_i · Knee_i · Cam)은 원 모델과 같다. 모델이 없으면 그리지 않는다(상자 대체 없음).
import * as THREE from 'three';

const AXIS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function poseJoint(node, q) {
  const axis = node.userData?.axis;
  if (!Array.isArray(axis) || axis.length < 3) {
    node.rotation.x = q;
    return;
  }
  const rest = node.userData.rest_angle ?? 0;
  const lo = (node.userData.lower ?? -Math.PI) - rest;
  const hi = (node.userData.upper ?? Math.PI) - rest;
  node.quaternion.setFromAxisAngle(AXIS.fromArray(axis), THREE.MathUtils.clamp(q, lo, hi));
}

export class HoundView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'hound';
    this.root.visible = false;
    scene.add(this.root);
    this.model = null;
    this.body = null;
    this.bodyRest = 0;
    this.legs = [];
    this.cam = null;
    this.camRest = null;
    this.mark = null;
    this.ready = false;
  }

  // src: loadModel('quadruped') 씬. 캐시를 건드리지 않게 복제한다.
  useModel(src) {
    if (this.model) this.root.remove(this.model);
    const model = src.clone(true);
    model.name = 'hound-model';
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.userData.amrId = 'HOUND-01';
    });
    this.model = model;
    this.root.add(model);
    this.body = model.getObjectByName('Body');
    this.bodyRest = this.body?.position.y ?? 0;
    this.legs = [0, 1, 2, 3].map((i) => ({
      hip: model.getObjectByName(`Hip_${i}`),
      knee: model.getObjectByName(`Knee_${i}`),
    }));
    this.cam = model.getObjectByName('Cam');
    this.camRest = this.cam ? this.cam.quaternion.clone() : null;
    this.ready = this.legs.every((L) => L.hip && L.knee);
    if (!this.mark) {
      const pad = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.75, 24),
        new THREE.MeshBasicMaterial({ color: 0xe24b4b, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.y = 0.02;
      pad.visible = false;
      this.root.add(pad);
      this.mark = pad;
    }
  }

  focusOf(id, view) {
    if (id !== 'HOUND-01' || !view) return null;
    return { center: new THREE.Vector3(view.x, 0.4, view.z), size: 3.2 };
  }

  pickables() {
    const out = [];
    this.root.traverse((o) => { if (o.isMesh && o.visible) out.push(o); });
    return out;
  }

  // view: Hound.view() 또는 null
  update(view) {
    if (!view || !this.ready) { this.root.visible = false; return; }
    this.root.visible = true;
    this.root.position.set(view.x, 0, view.z);
    this.root.rotation.y = view.heading;
    const walk = view.mode === 'patrol' || view.mode === 'goto' || view.mode === 'return';
    const t = view.gait;
    this.legs.forEach(({ hip, knee }, i) => {
      const ph = t * 10 + (i === 0 || i === 3 ? 0 : Math.PI);
      poseJoint(hip, walk ? Math.sin(ph) * 0.25 : 0);
      poseJoint(knee, walk ? Math.max(0, -Math.sin(ph)) * 0.4 : 0);
    });
    if (this.body) this.body.position.y = this.bodyRest + (walk ? Math.abs(Math.sin(t * 10)) * 0.025 : 0);
    if (this.cam) {
      const sweep = (view.mode === 'goto' || view.mode === 'nudge') ? Math.sin(t * 2.5) * 0.4 : 0;
      if (this.camRest) this.cam.quaternion.setFromAxisAngle(UP, sweep).multiply(this.camRest);
      else this.cam.rotation.y = sweep;
    }
    if (this.mark) this.mark.visible = view.mode === 'nudge' || view.mode === 'goto';
  }
}
