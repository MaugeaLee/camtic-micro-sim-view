// 셀 밖 머리 위 라벨(AMR·드론·견마·자리·셀 장비). 좌표는 main 이 넘긴다. 그리기만 한다.
import * as THREE from 'three';
import { disposeTag, makeTag, paintTag, TAG } from './label.js';

export class TagLayer {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'tags';
    scene.add(this.root);
    this.items = new Map();
    this.show = true;
  }

  setLabels(on) {
    this.show = !!on;
    this.apply();
  }

  apply() {
    for (const it of this.items.values()) it.tag.sprite.visible = this.show;
  }

  // specs: [{ id, x, y, z, title, sub, color, selected, scale? }]
  sync(specs) {
    const live = new Set();
    for (const s of specs) {
      if (!s?.id) continue;
      live.add(s.id);
      let it = this.items.get(s.id);
      if (!it) {
        const tag = makeTag({ scale: s.scale ?? TAG.scale });
        this.root.add(tag.sprite);
        it = { tag };
        this.items.set(s.id, it);
      } else if (s.scale && s.scale !== it.tag.scale) {
        it.tag.scale = s.scale;
        it.tag.sprite.scale.set(s.scale, s.scale * TAG.h / TAG.w, 1);
      }
      it.tag.sprite.position.set(s.x, s.y, s.z);
      paintTag(it.tag, s);
    }
    for (const [id, it] of this.items) {
      if (live.has(id)) continue;
      this.root.remove(it.tag.sprite);
      disposeTag(it.tag);
      this.items.delete(id);
    }
    this.apply();
  }

  clear() {
    this.sync([]);
  }
}
