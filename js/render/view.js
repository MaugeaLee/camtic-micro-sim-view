// 상태를 그리기만 하는 뷰. 셀마다 빈 그룹을 두고, 에셋이 로드되면 그 안에 붙인다.
import * as THREE from 'three';

export class CellView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'cells';
    scene.add(this.root);
    this.groups = new Map();
  }

  // state가 바뀔 때마다(start) 다시 짠다. 이전 그룹은 버린다.
  setup(state) {
    this.clear();
    for (const c of state.cells) {
      const g = new THREE.Group();
      g.name = c.id;
      g.userData.cellId = c.id;
      this.root.add(g);
      this.groups.set(c.id, g);
    }
  }

  // 로드된 에셋 루트를 셀 그룹에 붙인다.
  attach(id, object) {
    const g = this.groups.get(id);
    if (!g) throw new Error(`없는 셀 그룹: ${id}`);
    g.clear();
    g.add(object);
  }

  update(dt, state, events) {
    for (const ev of events) this.onEvent(ev);
  }

  onEvent(ev) {
    // 셀 상태 표현(색·라벨 등)은 아직 없음.
  }

  clear() {
    for (const g of this.groups.values()) this.root.remove(g);
    this.groups.clear();
  }
}
