// 작업대 리프트(가정 형상): PRESS·SCREW 리프트 자리 둘레 가이드 기둥 4개 · 와이어 · 클립 캐리지.
// 클립이 지그 긴 변 밑을 물고(clamp 0→1) 캐리지가 리프트 높이(y)를 따라 오르내린다. 기둥은 AMR 통로(차체 폭) 밖 — 차가 그 사이로 지나간다.
// 시뮬 cellwork view().lift(셀 로컬)를 읽기만 한다.
import * as THREE from 'three';

const POST = 0.06, CAR = [0.12, 0.07, 0.07], ARM_T = 0.02, CLEAR = 0.12, BITE = 0.04;

export class LiftView {
  constructor() {
    this.cells = new Map();
    this.mats = {
      post: new THREE.MeshStandardMaterial({ color: 0x59626e, roughness: 0.6, metalness: 0.4 }),
      car: new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.5, metalness: 0.3 }),
      open: new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.5, metalness: 0.3 }),
      shut: new THREE.MeshStandardMaterial({ color: 0xf5b74e, roughness: 0.45, metalness: 0.2, emissive: 0x5a3a00, emissiveIntensity: 0.4 }),
      wire: new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.4, metalness: 0.6 }),
    };
    this.geo = {
      car: new THREE.BoxGeometry(...CAR),
      arm: new THREE.BoxGeometry(1, ARM_T, 0.05),
      wire: new THREE.CylinderGeometry(0.005, 0.005, 1, 6),
    };
  }

  // group: 셀 그룹(셀 로컬 = 시뮬 좌표). L: view().lift
  attach(cellId, group, L) {
    this.detach(cellId);
    if (!group || !L) return;
    const root = new THREE.Group();
    root.name = 'lift';
    const [fx, fz] = L.foot;
    const px = fx / 2 - 0.2, pz = fz / 2 + CLEAR, H = L.top + 0.14;
    const postGeo = new THREE.BoxGeometry(POST, H, POST);
    const posts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = L.x + sx * px, z = L.z + sz * pz;
      const post = new THREE.Mesh(postGeo, this.mats.post);
      post.position.set(x, H / 2, z);
      const car = new THREE.Mesh(this.geo.car, this.mats.car);
      const arm = new THREE.Mesh(this.geo.arm, this.mats.open);
      arm.rotation.y = Math.PI / 2;   // 상자 x(길이) → 셀 z(지그 쪽)
      const wire = new THREE.Mesh(this.geo.wire, this.mats.wire);
      for (const m of [post, car, arm]) m.castShadow = true;
      root.add(post, car, arm, wire);
      posts.push({ x, z, sz, car, arm, wire });
    }
    group.add(root);
    this.cells.set(cellId, { root, posts, H, pz, edge: fz / 2, geos: [postGeo] });
    this.update(cellId, L);
  }

  update(cellId, L) {
    const c = this.cells.get(cellId);
    if (!c || !L) return;
    const y = L.y, k = L.clamp ?? 0;
    const reach = 0.03 + k * (c.pz - c.edge + BITE - 0.03);   // 기둥 안쪽 면에서 지그 쪽으로 나온 길이
    for (const p of c.posts) {
      const inner = p.z - p.sz * POST / 2;
      p.car.position.set(p.x, y - CAR[1] / 2 + 0.01, p.z);
      p.arm.scale.x = reach;
      p.arm.position.set(p.x, y - ARM_T / 2, inner - p.sz * reach / 2);
      p.arm.material = k > 0.5 ? this.mats.shut : this.mats.open;
      const top = c.H, bot = y + CAR[1] / 2;
      p.wire.scale.y = Math.max(0.01, top - bot);
      p.wire.position.set(p.x + POST / 2 + 0.01, (top + bot) / 2, p.z);
    }
  }

  detach(cellId) {
    const c = this.cells.get(cellId);
    if (!c) return;
    c.root.parent?.remove(c.root);
    for (const g of c.geos) g.dispose();
    this.cells.delete(cellId);
  }
}
