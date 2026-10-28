// 부속 부품 창고(PARTS) 절차 형상: 바닥 표시 · 뒤쪽 선반. 통로(휴머노이드 보행)에는 고정 물체를 두지 않는다.
// 형상·치수는 가정이다(GLB 없음). 움직이는 토트는 부품 엔티티(render/parts.js)가 그린다. 그리기만 한다.
import * as THREE from 'three';

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...o });
const box = (w, h, d, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = true; m.receiveShadow = true; return m; };

export class PartsSiteView {
  // size: 바닥 {w, d} (layout FOOTPRINT.PARTS)
  constructor(scene, size) {
    this.root = new THREE.Group();
    this.root.name = 'parts-site';
    this.root.userData.siteId = 'PARTS';
    this.root.visible = false;
    scene.add(this.root);
    this.build(size);
  }

  build({ w, d }) {
    const steel = M('#8a96a6'), dark = M('#2f343b');
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M('#34434d', { roughness: 0.9, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.004;
    floor.receiveShadow = true;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.001, d)), new THREE.LineBasicMaterial({ color: '#3fb6c9' }));
    edge.position.y = 0.006;
    this.root.add(floor, edge);
    // 선반: 뒤쪽(로컬 −z) 3단. 칸 위 토트·통로 테이블은 휴머노이드와 겹쳐서 두지 않는다(토트는 엔티티).
    const sw = w - 0.4, sz = -d / 2 + 0.3, levels = [0.35, 0.95, 1.55];
    for (const x of [-sw / 2, 0, sw / 2]) for (const z of [sz - 0.25, sz + 0.25]) { const p = box(0.06, 1.9, 0.06, steel); p.position.set(x, 0.95, z); this.root.add(p); }
    for (const y of levels) {
      const deck = box(sw, 0.04, 0.56, dark);
      deck.position.set(0, y - 0.02, sz);
      this.root.add(deck);
    }
  }

  update(pose) {
    if (!pose) { this.root.visible = false; return; }
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = (pose.rotY * Math.PI) / 180;
    this.root.visible = true;
  }
}
