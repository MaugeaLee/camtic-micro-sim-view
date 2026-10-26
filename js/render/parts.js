// 키트·부품 엔티티를 그린다. 위치·자세는 시뮬이 준 값(필드 좌표, 밑면 중심 + yaw) 그대로. 그리기만 한다.
// 엔티티에 model(에셋 키)이 있고 setModel 로 받은 씬이 있으면 그 모델을, 없으면 치수 상자를 그린다.
// 모델은 lay(upright 그대로 · face-up 앞면 위로 눕힘)로 돌린 뒤, 밑면 중심을 원점에 두고 시뮬 치수(x·z)에 맞춰 균일 배율한다.
import * as THREE from 'three';

export class PartsView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'parts';
    scene.add(this.root);
    this.items = new Map();
    this.geos = new Map();
    this.mats = new Map();
    this.models = new Map();
    this.fitted = new Map();
  }

  setModel(key, scene) {
    if (!scene) return;
    this.models.set(key, scene);
    for (const k of [...this.fitted.keys()]) if (k.startsWith(`${key}|`)) this.fitted.delete(k);
    for (const [id, m] of this.items) if (m.userData.model === key && !m.userData.fit) { this.root.remove(m); this.items.delete(id); }
  }

  geo(size) {
    const k = size.join(',');
    if (!this.geos.has(k)) this.geos.set(k, new THREE.BoxGeometry(...size));
    return this.geos.get(k);
  }

  mat(color) {
    const k = color ?? '#9aa4b2';
    if (!this.mats.has(k)) this.mats.set(k, new THREE.MeshStandardMaterial({ color: k, roughness: 0.55, metalness: 0.15 }));
    return this.mats.get(k);
  }

  // 모델을 시뮬 치수에 맞춘 원본(복제해서 쓴다). 그룹 원점 = 밑면 중심.
  fit(p) {
    const key = `${p.model}|${p.lay ?? 'upright'}|${p.size.join(',')}`;
    if (this.fitted.has(key)) return this.fitted.get(key);
    const src = this.models.get(p.model);
    if (!src) return null;
    const inner = src.clone(true);
    if (p.lay === 'face-up') inner.rotation.x = -Math.PI / 2;
    const wrap = new THREE.Group();
    wrap.add(inner);
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inner), sz = box.getSize(new THREE.Vector3());
    const k = Math.min(p.size[0] / (sz.x || 1), p.size[2] / (sz.z || 1));
    inner.scale.setScalar(k);
    wrap.updateMatrixWorld(true);
    box.setFromObject(inner);
    const c = box.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, -box.min.y, -c.z);
    inner.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.fitted.set(key, wrap);
    return wrap;
  }

  make(p) {
    const tpl = p.model ? this.fit(p) : null;
    if (tpl) {
      const g = tpl.clone(true);
      g.userData = { model: p.model, fit: true };
      return g;
    }
    const m = new THREE.Mesh(this.geo(p.size), this.mat(p.color));
    m.castShadow = true;
    m.userData = { model: p.model ?? null, fit: false, box: true };
    return m;
  }

  // poses: [{ id, size:[x,y,z], color, model?, lay?, x, y, z, yaw }]
  update(poses) {
    const seen = new Set();
    for (const p of poses ?? []) {
      if (!p.size) continue;
      seen.add(p.id);
      let m = this.items.get(p.id);
      if (!m) {
        m = this.make(p);
        m.name = `part-${p.id}`;
        this.root.add(m);
        this.items.set(p.id, m);
      }
      const tilt = p.tilt ?? 0;
      const lift = Math.sin(tilt) * (m.userData.box ? (p.size[0] - p.size[1]) / 2 : p.size[0] / 2);
      m.position.set(p.x, p.y + (m.userData.box ? p.size[1] / 2 : 0) + lift, p.z);
      m.rotation.order = 'YZX';
      m.rotation.y = p.yaw;
      m.rotation.z = tilt;
    }
    for (const [id, m] of this.items) if (!seen.has(id)) { this.root.remove(m); this.items.delete(id); }
  }

  clear() { this.update([]); }
}
