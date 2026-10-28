// 키트·부품 엔티티를 그린다. 위치·자세는 시뮬이 준 값(필드 좌표, 밑면 중심 + yaw) 그대로. 그리기만 한다.
// 엔티티에 model(에셋 키)이 있고 setModel 로 받은 씬이 있으면 그 모델을, 없으면 치수 상자를 그린다.
// 모델은 lay(upright 그대로 · face-up 앞면 위로 눕힘)로 돌린 뒤, 밑면 중심을 원점에 두고 시뮬 치수(x·z)에 맞춘다
// (fit 'stretch' = x·z 따로 늘리고 높이는 작은 쪽 배율 · 기본 = 균일 배율).
// jig 가 있는 키트(지그 위 도어트림 한 덩어리)는 지그 판을 밑에 깔고 그 위에 도어트림을 그린다. 지그가 떨어지면(적재 구역) 다시 만든다.
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
    const key = `${p.model}|${p.lay ?? 'upright'}|${p.fit ?? 'uniform'}|${p.size.join(',')}`;
    if (this.fitted.has(key)) return this.fitted.get(key);
    const src = this.models.get(p.model);
    if (!src) return null;
    const inner = src.clone(true);
    if (p.lay === 'face-up') inner.rotation.x = -Math.PI / 2;
    const mid = new THREE.Group(), wrap = new THREE.Group();
    mid.add(inner);
    wrap.add(mid);
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mid), sz = box.getSize(new THREE.Vector3());
    const kx = p.size[0] / (sz.x || 1), kz = p.size[2] / (sz.z || 1), k = Math.min(kx, kz);
    if (p.fit === 'stretch') mid.scale.set(kx, k, kz);
    else mid.scale.setScalar(k);
    wrap.updateMatrixWorld(true);
    box.setFromObject(mid);
    const c = box.getCenter(new THREE.Vector3());
    mid.position.set(-c.x, -box.min.y, -c.z);
    inner.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.fitted.set(key, wrap);
    return wrap;
  }

  // 원점 = 밑면 중심인 그룹(키트 위 부품 기울임과 같은 회전 중심)
  make(p) {
    const g = new THREE.Group();
    const tpl = p.model ? this.fit(p) : null;
    const jigH = p.jig ? p.jig.size[1] : 0;
    let body;
    if (tpl) body = tpl.clone(true);
    else {
      body = new THREE.Mesh(this.geo(p.size), this.mat(p.color));
      body.castShadow = true;
      body.position.y = p.size[1] / 2;
    }
    body.position.y += jigH;
    g.add(body);
    if (p.jig) {
      const j = new THREE.Mesh(this.geo(p.jig.size), this.mat(p.jig.color));
      j.castShadow = true;
      j.position.y = jigH / 2;
      j.name = 'jig';
      g.add(j);
    }
    g.userData = { model: p.model ?? null, fit: !!tpl, box: !tpl, jig: !!p.jig, color: p.color ?? null };
    return g;
  }

  // poses: [{ id, size:[x,y,z], color, model?, lay?, fit?, jig?, x, y, z, yaw }]
  update(poses) {
    const seen = new Set();
    for (const p of poses ?? []) {
      if (!p.size) continue;
      seen.add(p.id);
      let m = this.items.get(p.id);
      if (m && m.userData.jig !== !!p.jig) { this.root.remove(m); m = null; }
      if (!m) {
        m = this.make(p);
        m.name = `part-${p.id}`;
        this.root.add(m);
        this.items.set(p.id, m);
      } else if (m.userData.box && p.color && m.userData.color !== p.color) {
        const body = m.children.find((c) => c.isMesh && c.name !== 'jig');
        if (body) body.material = this.mat(p.color);
        m.userData.color = p.color;
      }
      const tilt = p.tilt ?? 0;
      const lift = Math.sin(tilt) * (p.size[0] / 2);
      m.position.set(p.x, p.y + lift, p.z);
      m.rotation.order = 'YZX';
      m.rotation.y = p.yaw;
      m.rotation.z = tilt;
    }
    for (const [id, m] of this.items) if (!seen.has(id)) { this.root.remove(m); this.items.delete(id); }
  }

  clear() { this.update([]); }
}
