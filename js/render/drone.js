// 드론 그리기. 참조 레포 쿼드콥터 GLB(`drone.glb`)를 대수만큼 복제하고, 시뮬 위치·heading 에 로터 회전·기울기·짐벌만 얹는다.
// 노드 이름(Rotor_i · Gimbal · Strobe)은 원 모델과 같다. 모델이 없으면 드론은 그리지 않고 이착륙장만 그린다.
import * as THREE from 'three';

const SKID = 0.23;   // 원점 → 스키드 바닥
const COLOR = { inspect: 0x3fd0e6, count: 0xf2b84e, fault: 0xe24b4b };

export class DroneView {
  constructor(scene, pads = []) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'drones';
    scene.add(this.root);
    this.src = null;
    this.units = new Map();
    this.t = 0;
    this.padGroup = new THREE.Group();
    this.padGroup.name = 'drone-pads';
    for (const p of pads) {
      const pad = new THREE.Mesh(
        new THREE.CircleGeometry(0.7, 32),
        new THREE.MeshBasicMaterial({ color: 0x2c3a4a, transparent: true, opacity: 0.9 }),
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(p.x, 0.012, p.z);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 0.68, 32),
        new THREE.MeshBasicMaterial({ color: 0xe8edf2, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, 0.016, p.z);
      this.padGroup.add(pad, ring);
    }
    scene.add(this.padGroup);
  }

  useModel(src) { this.src = src; for (const id of [...this.units.keys()]) this.drop(id); }

  make(id) {
    const g = new THREE.Group();
    g.name = id;
    const model = this.src.clone(true);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.userData.amrId = id;
    });
    g.add(model);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: COLOR.inspect, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    cone.visible = false;
    this.root.add(g, cone);
    const u = {
      g, cone,
      rotors: [0, 1, 2, 3].map((i) => model.getObjectByName(`Rotor_${i}`)).filter(Boolean),
      gimbal: model.getObjectByName('Gimbal'),
      strobe: model.getObjectByName('Strobe'),
      spin: 0,
    };
    this.units.set(id, u);
    return u;
  }

  drop(id) {
    const u = this.units.get(id);
    if (!u) return;
    this.root.remove(u.g, u.cone);
    this.units.delete(id);
  }

  focusOf(id, views) {
    const v = views?.find((d) => d.id === id);
    return v ? { center: new THREE.Vector3(v.x, v.y + SKID, v.z), size: 4 } : null;
  }

  pickables() {
    const out = [];
    this.root.traverse((o) => { if (o.isMesh && o.visible && o.userData.amrId) out.push(o); });
    return out;
  }

  // views: DroneFleet.view().drones 또는 null
  update(views, dt = 1 / 60) {
    this.t += dt;
    const list = this.src ? views ?? [] : [];
    const live = new Set(list.map((v) => v.id));
    for (const id of [...this.units.keys()]) if (!live.has(id)) this.drop(id);
    for (const v of list) {
      const u = this.units.get(v.id) ?? this.make(v.id);
      u.g.position.set(v.x, v.y + SKID, v.z);
      // 진행 방향으로 살짝 숙인다(속도 비례, 최대 ~10°)
      const tilt = Math.min(0.18, (v.v ?? 0) * 0.07);
      u.g.rotation.set(0, 0, 0);
      u.g.rotation.y = v.heading;
      u.g.rotateX(tilt);
      const rpm = v.flying ? 38 : 0;
      u.spin += rpm * dt;
      u.rotors.forEach((r, i) => { r.rotation.y = (i % 2 ? -1 : 1) * u.spin; });
      if (u.gimbal) u.gimbal.rotation.x = v.scanning ? 0.9 : 0.25;
      if (u.strobe) u.strobe.visible = !v.flying || Math.sin(this.t * 9) > 0.6;
      const kind = v.job?.kind;
      const on = !!v.scanning || (kind === 'fault' && v.flying && v.mode === 'work');
      u.cone.visible = on;
      if (on) {
        const h = Math.max(0.5, v.y);
        u.cone.scale.set(h * 0.32, h, h * 0.32);
        u.cone.position.set(v.x, h / 2, v.z);
        u.cone.material.color.setHex(COLOR[kind] ?? COLOR.inspect);
        u.cone.material.opacity = 0.12 + 0.08 * Math.abs(Math.sin(this.t * 4));
      }
    }
  }
}
