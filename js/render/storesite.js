// 도어트림 원재료 창고(STORE) 절차 형상: 바닥 표시 · 뒤쪽 2단 선반 · 앞쪽 입고 팔레트(랩 포장 묶음).
// 형상·치수는 가정이다(GLB 없음). 선반 칸·팔레트 위 키트는 부품 엔티티(render/parts.js)가 그린다. 그리기만 한다.
import * as THREE from 'three';

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...o });
const box = (w, h, d, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = true; m.receiveShadow = true; return m; };

export class StoreSiteView {
  // size: 바닥 {w, d} (layout FOOTPRINT.STORE)
  constructor(scene, size) {
    this.root = new THREE.Group();
    this.root.name = 'store-site';
    this.root.userData.siteId = 'STORE';
    this.root.visible = false;
    scene.add(this.root);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size.w, size.d), M('#3b4048', { roughness: 0.9, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.004;
    floor.receiveShadow = true;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.w, 0.001, size.d)), new THREE.LineBasicMaterial({ color: '#e0b04a' }));
    edge.position.y = 0.006;
    this.root.add(floor, edge);
    this.rack = null;
  }

  // def: process SORT inbound.store(선반 칸·팔레트, 자리 로컬). 한 번만 짓는다.
  setDef(def) {
    if (this.rack || !def) return;
    this.rack = new THREE.Group();
    this.root.add(this.rack);
    this.build(def);
  }

  build(def) {
    const steel = M('#8a96a6'), dark = M('#2f343b'), add = (...o) => this.rack.add(...o);
    // 선반: 칸 높이(y)마다 판, 칸 줄(z) 앞뒤로 기둥. 판 윗면 = 키트 밑면.
    const xs = def.slots.map((s) => s.x), z = def.slots[0].z;
    const x0 = Math.min(...xs) - 0.75, x1 = Math.max(...xs) + 0.75, sw = x1 - x0, cx = (x0 + x1) / 2;
    const levels = [...new Set(def.slots.map((s) => s.y))];
    const top = Math.max(...levels) + 0.55;
    for (const x of [x0, cx - sw / 6, cx + sw / 6, x1]) for (const dz of [-0.42, 0.42]) {
      const p = box(0.06, top, 0.06, steel);
      p.position.set(x, top / 2, z + dz);
      add(p);
    }
    for (const y of levels) {
      const deck = box(sw, 0.04, 0.9, dark);
      deck.position.set(cx, y - 0.02, z);
      add(deck);
    }
    // 입고 팔레트: 나무 받침 + 랩 포장 묶음. 묶음 윗면 = receive.y(새 키트가 여기서 선반으로 옮겨 간다).
    const r = def.receive, base = 0.14;
    const pallet = box(1.3, base, 0.8, M('#9a7a4f', { roughness: 0.9, metalness: 0 }));
    pallet.position.set(r.x, base / 2, r.z);
    const wrap = box(1.24, Math.max(0.02, r.y - base), 0.74, M('#c9d3db', { roughness: 0.35, metalness: 0, transparent: true, opacity: 0.85 }));
    wrap.position.set(r.x, base + (r.y - base) / 2, r.z);
    add(pallet, wrap);
  }

  update(pose) {
    if (!pose) { this.root.visible = false; return; }
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = (pose.rotY * Math.PI) / 180;
    this.root.visible = true;
  }
}
