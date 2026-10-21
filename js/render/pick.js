// 보기 모드 클릭 선택: 끌지 않고 누른 뒤 뗀 좌클릭만 고른다(궤도 회전과 구분). Esc 는 선택 해제.
import * as THREE from 'three';

const CLICK_PX = 5;

export class Picker {
  // layers: [{ meshes: () => Mesh[], key: 'amrId' | 'cellId' }] — 앞에 둔 것이 우선
  constructor(stage, layers, onPick) {
    this.stage = stage;
    this.layers = layers;
    this.onPick = onPick;
    this.enabled = true;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.down = null;
    const el = stage.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { if (e.button === 0) this.down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!this.enabled || e.button !== 0 || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX) return;
      this.onPick(this.hit(e));
    });
    window.addEventListener('keydown', (e) => { if (this.enabled && e.key === 'Escape') this.onPick(null); });
  }

  hit(e) {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.stage.camera);
    for (const { meshes, key } of this.layers) {
      const hit = this.ray.intersectObjects(meshes(), false)[0];
      if (!hit) continue;
      for (let o = hit.object; o; o = o.parent) if (o.userData[key]) return { [key]: o.userData[key] };
    }
    return null;
  }
}
