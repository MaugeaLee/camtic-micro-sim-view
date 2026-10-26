// Admin AMR 경로 편집: 루트 노드·간선, 충전 자리, 셀 입구·정차 칸·출구를 바닥에서 끌어 고친다.
// 데이터 편집 함수(ops)와 미리보기 지도는 main 이 넘긴다 — render 가 sim 을 import 하지 않는다.
//   좌클릭 끌기 = 옮기기 · Shift+바닥 = 노드 추가(선택 노드와 연결) · Shift+노드 = 선택 노드와 간선 바꾸기
//   Ctrl+바닥 = 충전 자리 추가 · Delete = 지우기 · X = 선택 셀에 출구 만들기
import * as THREE from 'three';

const SNAP = 0.1;
const COLOR = Object.freeze({ node: 0xf2f2f2, home: 0x3ccf8e, entry: 0x3ccf8e, stop: 0xf5b74e, exit: 0x4fb3ff, sel: 0xff4fd8 });
const snap = (v) => Math.round(v / SNAP) * SNAP;

export class RouteEditTool {
  // ops: { move(amr, ref, x, z), addNode(amr, x, z, linkTo) → {amr,id}, addHome(amr,x,z) → amr|null, remove(amr, ref) → amr|null,
  //        cycle(amr, a, b) → {amr,state}, addExit(amr, cell) → amr, mapOf(layout) → 지도,
  //        get?(layout) → 고칠 루트(기본 layout.amr), put?(layout, amr) → 새 layout(기본 { ...layout, amr }) }
  // onPreview(layout|null): 끄는 중 지도 미리보기 · onChange(layout, why): 확정
  constructor(stage, floor, { ops, onPreview, onChange, onNote } = {}) {
    this.stage = stage;
    this.floor = floor;
    this.ops = { get: (d) => d.amr, put: (d, amr) => ({ ...d, amr }), ...ops };
    this.onPreview = onPreview;
    this.onChange = onChange;
    this.onNote = onNote;
    this.doc = null;
    this.sel = null;
    this.drag = null;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.root = new THREE.Group();
    this.root.name = 'route-handles';
    stage.scene.add(this.root);
    this.geo = new THREE.CylinderGeometry(0.28, 0.28, 0.12, 20);
    this.mats = Object.fromEntries(Object.entries(COLOR).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.95 })]));

    const el = stage.renderer.domElement;
    this.onDown = (e) => this.pointerDown(e);
    this.onMove = (e) => this.pointerMove(e);
    this.onUp = (e) => this.pointerUp(e);
    this.onKey = (e) => this.key(e);
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey);
    stage.controls.mouseButtons.LEFT = -1;
    stage.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    stage.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  }

  setLayout(doc) {
    this.doc = doc;
    if (!this.drag) this.build(this.ops.mapOf(doc));
  }

  dispose() {
    const el = this.stage.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    this.stage.scene.remove(this.root);
    this.geo.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.onPreview?.(null);
    this.stage.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.stage.controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    this.stage.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  }

  // 지도에서 손잡이를 만든다. ref = { kind:'node',id } | { kind:'home',i } | { kind:'entry'|'exit',cell } | { kind:'stop',cell,i }
  build(map) {
    this.root.clear();
    if (!map) return;
    const add = (p, ref, kind, s = 1) => {
      const m = new THREE.Mesh(this.geo, this.mats[sameRef(ref, this.sel) ? 'sel' : kind]);
      m.position.set(p.x, 0.08, p.z);
      m.scale.setScalar(s);
      m.renderOrder = 10;
      m.userData.ref = ref;
      this.root.add(m);
    };
    for (const n of map.nodes) add(n, { kind: 'node', id: n.id }, 'node', 1.25);
    map.homes.forEach((h, i) => add(h, { kind: 'home', i }, 'home'));
    for (const c of map.cells) {
      add(c.entry, { kind: 'entry', cell: c.id }, 'entry', 0.8);
      c.stops.forEach((s, i) => { const dock = i === c.stops.length - 1; add(s, { kind: 'stop', cell: c.id, i, ...(dock ? { dock } : {}) }, 'stop', dock ? 1.1 : 0.8); });
      if (c.exit) add(c.exit, { kind: 'exit', cell: c.id }, 'exit', 0.8);
    }
  }

  commit(amr, why) {
    if (!amr) return;
    this.doc = this.ops.put(this.doc, amr);
    this.onChange?.(this.doc, why);
    this.build(this.ops.mapOf(this.doc));
  }

  select(ref) {
    this.sel = ref;
    this.build(this.ops.mapOf(this.doc));
  }

  pointerDown(e) {
    if (e.button !== 0 || !this.doc) return;
    const ref = this.hitHandle(e);
    const amr = this.ops.get(this.doc);
    if (e.shiftKey && ref?.kind === 'node' && this.sel?.kind === 'node' && ref.id !== this.sel.id) {
      const r = this.ops.cycle(amr, this.sel.id, ref.id);
      const name = { 'two-way': '양방향', oneway: `단방향 ${this.sel.id}→${ref.id}`, none: '없음' }[r.state];
      this.commit(r.amr, `간선 ${this.sel.id}–${ref.id}: ${name}`);
      return;
    }
    if (ref) { this.select(ref); this.drag = { ref, moved: false }; e.preventDefault(); return; }
    const p = this.hitFloor(e);
    if (!p) return;
    if (e.shiftKey) {
      const link = this.sel?.kind === 'node' ? this.sel.id : null;
      const r = this.ops.addNode(amr, snap(p.x), snap(p.z), link);
      this.sel = { kind: 'node', id: r.id };
      this.commit(r.amr, `노드 ${r.id} 추가${link ? ` (${link}와 연결)` : ''}`);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const next = this.ops.addHome(amr, snap(p.x), snap(p.z));
      if (!next) { this.onNote?.('충전 자리는 최대 개수까지만'); return; }
      this.commit(next, `충전 자리 ${next.homes.length} 추가`);
      return;
    }
    this.select(null);
  }

  pointerMove(e) {
    if (!this.drag || !this.doc) return;
    const p = this.hitFloor(e);
    if (!p) return;
    this.drag.moved = true;
    const amr = this.ops.move(this.ops.get(this.doc), this.drag.ref, snap(p.x), snap(p.z));
    this.drag.amr = amr;
    const preview = this.ops.put(this.doc, amr);
    const map = this.ops.mapOf(preview);
    this.build(map);
    this.onPreview?.(map);
  }

  pointerUp(e) {
    if (e.button !== 0 || !this.drag) return;
    const { ref, moved, amr } = this.drag;
    this.drag = null;
    this.onPreview?.(null);
    if (moved && amr) this.commit(amr, `${refName(ref)} 이동`);
    else this.build(this.ops.mapOf(this.doc));
  }

  key(e) {
    if (!this.doc || !this.sel || e.target?.closest?.('input,select,textarea')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const next = this.ops.remove(this.ops.get(this.doc), this.sel);
      if (!next) { this.onNote?.(`${refName(this.sel)}는 지울 수 없다`); return; }
      const name = refName(this.sel);
      this.sel = null;
      this.commit(next, `${name} 삭제`);
    } else if ((e.key === 'x' || e.key === 'X') && this.sel.cell) {
      this.commit(this.ops.addExit(this.ops.get(this.doc), this.sel.cell), `${this.sel.cell} 출구 추가`);
    }
  }

  hitHandle(e) {
    this.fromEvent(e);
    const hit = this.ray.intersectObjects(this.root.children, false)[0];
    return hit?.object.userData.ref ?? null;
  }

  hitFloor(e) {
    this.fromEvent(e);
    return this.ray.intersectObject(this.floor, false)[0]?.point ?? null;
  }

  fromEvent(e) {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.stage.camera);
  }
}

function sameRef(a, b) {
  return !!a && !!b && a.kind === b.kind && a.id === b.id && a.i === b.i && a.cell === b.cell;
}

function refName(r) {
  if (r.kind === 'node') return `노드 ${r.id}`;
  if (r.kind === 'home') return `충전 자리 ${r.i + 1}`;
  if (r.kind === 'entry') return `${r.cell} 입구`;
  if (r.kind === 'exit') return `${r.cell} 출구`;
  return r.dock ? `${r.cell} 도킹 자리` : `${r.cell} 정차 칸 ${r.i + 1}`;
}
