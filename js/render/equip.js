// 셀 안 장비(로봇·직교이송·리프트·몸통)를 AMR처럼 고르고 따라간다. 그리기만 한다.
// 메시 userData.partId = `${cell}:${name}`. 기구 링크는 rig 루트로 옮겨져 있으므로 붙인 뒤 태그를 단다.
// 선택은 AABB 상자 없이 그 메시 색만 바꾼다(공유 재질은 복제).
import * as THREE from 'three';
import { camLens } from './livecam.js';

const baseName = (n) => String(n ?? '').replace(/\.\d+$/, '');
const SKIP = new Set(['state-frame', 'state-floor', 'state-label', 'rig', 'lift', 'cells']);
const ACCENT = new THREE.Color(0x4fb3ff);

export class EquipView {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
    this.cams = new Map();
    this.box = new THREE.Box3();
    this.litId = null;
    this.lit = [];
    this._c = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  clear() {
    this.unmark();
    for (const cam of this.cams.values()) cam.parent?.remove(cam);
    this.cams.clear();
    this.items.clear();
  }

  // work: CellWork/SortWork, rigCell: RigView.cells 항목, liftRoot: LiftView 루트
  bind(cellId, { obj, work, rigCell, liftRoot } = {}) {
    if (this.litId && this.items.get(this.litId)?.cell === cellId) this.unmark();
    for (const [id, it] of [...this.items]) if (it.cell === cellId) {
      this.cams.get(id)?.parent?.remove(this.cams.get(id));
      this.cams.delete(id);
      this.items.delete(id);
    }
    if (!work) return;
    const robots = work.robots
      ? (Array.isArray(work.robots) ? work.robots : Object.values(work.robots))
      : [];
    for (const r of robots) {
      const A = rigCell?.arms.get(r.name);
      const links = (A?.links ?? []).map((L) => L.o).filter(Boolean);
      this.put(`${cellId}:${r.name}`, cellId, 'arm', links.length ? links : [findNamed(obj, r.name)].filter(Boolean));
    }
    if (work.L?.body) {
      const grabbed = rigCell?.body?.t?.o;
      this.put(`${cellId}:${work.L.body}`, cellId, 'body', [grabbed ?? findNamed(obj, work.L.body)].filter(Boolean));
    }
    if (Array.isArray(work.lines)) {
      for (const L of work.lines) {
        if (!L?.id || !L.gantry) continue;
        const G = L.rig?.gantry && rigCell?.gantries.find((g) => g.g.node === L.rig.gantry.node);
        const objs = G ? [...G.lift, ...G.head].map((x) => x.o).filter(Boolean) : [];
        this.put(`${cellId}:${L.id}`, cellId, 'gantry', objs.length ? objs : [L.rig?.gantry?.name ? findNamed(obj, L.rig.gantry.name) : null].filter(Boolean));
      }
    }
    if (work.lift && liftRoot) this.put(`${cellId}:LIFT`, cellId, 'lift', [liftRoot]);
  }

  put(id, cell, kind, objs) {
    const uniq = [...new Set(objs.filter(Boolean))];
    if (!uniq.length) return;
    for (const o of uniq) tag(o, id);
    this.items.set(id, { id, cell, kind, objs: uniq });
    if (kind === 'arm') {
      const last = uniq[uniq.length - 1];
      const cam = camLens({ scale: 0.65 });
      cam.position.set(0, 0.04, 0.06);
      last.add(cam);
      tag(cam, id);
      this.cams.set(id, cam);
    }
  }

  pickables() {
    const out = [];
    for (const it of this.items.values()) {
      for (const o of it.objs) {
        o.traverse((n) => { if (n.isMesh && n.userData.partId && visibleChain(n)) out.push(n); });
      }
    }
    return out;
  }

  focusOf(id) {
    const it = this.items.get(id);
    if (!it) return null;
    this.box.makeEmpty();
    for (const o of it.objs) {
      if (!visibleChain(o) || !hasMesh(o)) continue;
      o.updateWorldMatrix(true, true);
      this.box.expandByObject(o);
    }
    if (this.box.isEmpty()) return null;
    this.box.getCenter(this._c);
    this.box.getSize(this._s);
    return { center: this._c.clone(), size: Math.max(this._s.x, this._s.y, this._s.z, 1.2) };
  }

  mark(id) {
    if (id === this.litId) return;
    this.unmark();
    const it = id ? this.items.get(id) : null;
    if (!it) return;
    this.litId = id;
    for (const o of it.objs) {
      o.traverse((n) => {
        if (!n.isMesh || !n.material || !visibleChain(n)) return;
        const prev = n.material;
        const list = Array.isArray(prev) ? prev : [prev];
        const next = list.map(tint);
        n.material = Array.isArray(prev) ? next : next[0];
        this.lit.push({ mesh: n, prev, next });
      });
    }
  }

  unmark() {
    for (const { mesh, prev, next } of this.lit) {
      mesh.material = prev;
      for (const m of Array.isArray(next) ? next : [next]) m.dispose();
    }
    this.lit = [];
    this.litId = null;
  }
}

function tint(mat) {
  const m = mat.clone();
  if (m.color) m.color.lerp(ACCENT, 0.55);
  if (m.emissive) {
    m.emissive.copy(ACCENT);
    m.emissiveIntensity = Math.max(m.emissiveIntensity ?? 0, 0.45);
  }
  return m;
}

function findNamed(root, name) {
  if (!root || !name) return null;
  let hit = null;
  root.traverse((o) => {
    if (hit || SKIP.has(o.name) || o.isMesh) return;
    if (baseName(o.name) === baseName(name)) hit = o;
  });
  return hit;
}

function tag(o, id) {
  o.traverse((n) => {
    if (n.isMesh && visibleChain(n)) n.userData.partId = id;
  });
}

function visibleChain(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function hasMesh(o) {
  let n = 0;
  o.traverse((x) => { if (x.isMesh && x.geometry) n++; });
  return n > 0;
}
