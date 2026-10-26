// 부속 부품 창고(PARTS) 절차 형상: 바닥 표시 · 뒤쪽 선반(토트 진열) · 앞쪽 이송 테이블(토트가 AMR 로 옮겨 가는 자리).
// 형상·치수는 가정이다(GLB 없음). 움직이는 토트는 부품 엔티티(render/parts.js)가 그린다. 그리기만 한다.
import * as THREE from 'three';

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...o });
const box = (w, h, d, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = true; m.receiveShadow = true; return m; };
const TOTES = ['#2f7dd1', '#3a8f5c', '#c8763a', '#7a5cc2'];

export class PartsSiteView {
  // size: 바닥 {w, d} (layout FOOTPRINT.PARTS)
  constructor(scene, size) {
    this.root = new THREE.Group();
    this.root.name = 'parts-site';
    this.root.visible = false;
    scene.add(this.root);
    this.build(size);
  }

  build({ w, d }) {
    const steel = M('#8a96a6'), dark = M('#2f343b'), roller = M('#5b6470');
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M('#34434d', { roughness: 0.9, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.004;
    floor.receiveShadow = true;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.001, d)), new THREE.LineBasicMaterial({ color: '#3fb6c9' }));
    edge.position.y = 0.006;
    this.root.add(floor, edge);
    // 선반: 뒤쪽(로컬 −z) 3단, 칸마다 토트
    const sw = w - 0.4, sz = -d / 2 + 0.3, levels = [0.35, 0.95, 1.55];
    for (const x of [-sw / 2, 0, sw / 2]) for (const z of [sz - 0.25, sz + 0.25]) { const p = box(0.06, 1.9, 0.06, steel); p.position.set(x, 0.95, z); this.root.add(p); }
    levels.forEach((y, k) => {
      const deck = box(sw, 0.04, 0.56, dark);
      deck.position.set(0, y - 0.02, sz);
      this.root.add(deck);
      for (let i = 0; i < 7; i++) {
        const t = box(0.55, 0.28, 0.4, M(TOTES[(i + k) % TOTES.length], { roughness: 0.7, metalness: 0 }));
        t.position.set(-sw / 2 + 0.4 + i * ((sw - 0.8) / 6), y + 0.14, sz);
        this.root.add(t);
      }
    });
    // 이송 테이블: 선반 앞에서 AMR 쪽으로(로컬 +z) 롤러. 끝은 도크에 선 AMR 앞코(로컬 z 0.75) 앞.
    const top = 0.88, len = 0.7 - (sz + 0.4);
    const table = box(0.8, 0.05, len, dark);
    table.position.set(0, top - 0.025, sz + 0.4 + len / 2);
    this.root.add(table);
    for (let z = sz + 0.5; z < sz + 0.4 + len; z += 0.18) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 10), roller);
      r.rotation.z = Math.PI / 2;
      r.position.set(0, top + 0.01, z);
      this.root.add(r);
    }
    for (const x of [-0.35, 0.35]) for (const z of [sz + 0.45, sz + 0.35 + len]) { const l = box(0.05, top - 0.05, 0.05, steel); l.position.set(x, (top - 0.05) / 2, z); this.root.add(l); }
  }

  update(pose) {
    if (!pose) { this.root.visible = false; return; }
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = (pose.rotY * Math.PI) / 180;
    this.root.visible = true;
  }
}
