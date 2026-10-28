// 상태를 그리기만 하는 뷰. 셀마다 빈 그룹을 두고, 에셋이 로드되면 그 안에 붙인다.
// 셀 상태는 바닥 테두리 색과 머리 위 라벨로, 선택은 테두리 굵기·밝기와 바닥 펄스로 보인다.
import * as THREE from 'three';

export const STATE_COLOR = Object.freeze({ IDLE: 0x9aa4b2, BUSY: 0x3ccf8e, DOWN: 0xff5d5d });
const STATE_TEXT = Object.freeze({ IDLE: '대기', BUSY: '가동', DOWN: '고장' });
const FRAME = Object.freeze({ pad: 0.35, band: 0.16, bandSel: 0.34, y: 0.025 });
const LABEL = Object.freeze({ w: 512, h: 160, scale: 5.2, lift: 1.2 });

export class CellView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'cells';
    scene.add(this.root);
    this.groups = new Map();
    this.marks = new Map();
    this.selected = null;
    this.t = 0;
    this.showLabels = true;
  }

  // state가 바뀔 때마다(start) 다시 짠다. 이전 그룹은 버린다.
  // extent(id, rotY) → {w,d}: 셀 발자국. render 가 sim 을 import 하지 않도록 main 이 넘긴다.
  setup(state, { extent } = {}) {
    this.clear();
    this.extent = extent;
    for (const c of state.cells) {
      const g = new THREE.Group();
      g.name = c.id;
      g.userData.cellId = c.id;
      this.root.add(g);
      this.groups.set(c.id, g);
      const fp = extent?.(c.id, 0);
      if (fp) this.marks.set(c.id, makeMark(g, fp, c));
    }
    this.selected = state.selected;
    this.applyLabels();
  }

  // 셀 머리 위 라벨(id·상태·재고). AMR·드론·장비 라벨은 TagLayer. 패널 글자는 건드리지 않는다.
  setLabels(on) {
    this.showLabels = !!on;
    this.applyLabels();
  }

  applyLabels() {
    for (const m of this.marks.values()) m.label.visible = this.showLabels;
  }

  // 로드된 에셋 루트를 셀 그룹에 붙인다. 자리는 그룹에 두고, 메시는 셀 프레임 오프셋(glb.js cellFrame)으로 바닥(y=0)·XZ 중심에 앉힌다.
  attach(id, object, frame) {
    const g = this.groups.get(id);
    if (!g) throw new Error(`없는 셀 그룹: ${id}`);
    const mark = this.marks.get(id);
    g.clear();
    const [ox, oy, oz] = frame?.offset ?? [0, 0, 0];
    object.position.x += ox; object.position.y += oy; object.position.z += oz;
    const h = frame?.height ?? 3;
    g.add(object);
    if (mark) {
      g.add(mark.frame, mark.floor, mark.label);
      mark.label.position.y = h + LABEL.lift;
    }
  }

  applyLayout(doc) {
    for (const [id, pose] of Object.entries(doc.cells)) {
      const g = this.groups.get(id);
      if (!g) continue;
      g.position.set(pose.x, 0, pose.z);
      g.rotation.y = (pose.rotY * Math.PI) / 180;
    }
  }

  // 셀 중심(월드)과 대략 크기 — 카메라 포커스용
  focusOf(id) {
    const g = this.groups.get(id);
    if (!g) return null;
    const fp = this.extent?.(id, 0) ?? { w: 10, d: 10 };
    return { center: new THREE.Vector3(g.position.x, 1.5, g.position.z), size: Math.max(fp.w, fp.d) };
  }

  update(dt, state, events) {
    this.t += dt;
    for (const ev of events) this.onEvent(ev, state);
    const parent = state.equipOf?.(state.followed)?.cell ?? null;
    this.selected = state.selected ?? parent;
    const units = state.plant?.units;
    for (const c of state.cells) {
      const m = this.marks.get(c.id);
      if (!m) continue;
      const sel = c.id === this.selected;
      drawLabel(m, c, units?.[c.id], sel);
      paint(m, c.state, sel);
      m.floor.material.opacity = sel ? 0.12 + 0.08 * Math.sin(this.t * 4) : c.state === 'DOWN' ? 0.1 + 0.06 * Math.sin(this.t * 6) : 0.05;
    }
  }

  onEvent(ev, state) {
    if (ev.type === 'cell:state') {
      const m = this.marks.get(ev.id);
      if (m) paint(m, ev.to, ev.id === this.selected);
    } else if (ev.type === 'select') {
      this.selected = ev.id;
      for (const c of state.cells) {
        const m = this.marks.get(c.id);
        if (m) paint(m, c.state, c.id === ev.id);
      }
    }
  }

  // 화면 좌표 레이캐스트로 고를 수 있는 메시들
  pickables() {
    const out = [];
    this.root.traverse((o) => { if (o.isMesh && visibleChain(o)) out.push(o); });
    return out;
  }

  clear() {
    for (const g of this.groups.values()) this.root.remove(g);
    for (const m of this.marks.values()) disposeMark(m);
    this.groups.clear();
    this.marks.clear();
  }
}

function visibleChain(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

// 발자국 둘레 띠(4개)와 바닥 틴트, 머리 위 라벨 스프라이트
function makeMark(g, fp, cell) {
  const w = fp.w + FRAME.pad * 2, d = fp.d + FRAME.pad * 2;
  const mat = new THREE.MeshBasicMaterial({ color: STATE_COLOR.IDLE, transparent: true, opacity: 0.85, depthWrite: false });
  const frame = new THREE.Group();
  frame.name = 'state-frame';
  const bands = [[w, 1, 0, -d / 2], [w, 1, 0, d / 2], [1, d, -w / 2, 0], [1, d, w / 2, 0]].map(([sx, sz, x, z]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, FRAME.y, z);
    m.userData.base = { sx, sz };
    m.renderOrder = 2;
    frame.add(m);
    return m;
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: STATE_COLOR.IDLE, transparent: true, opacity: 0.05, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FRAME.y - 0.005;
  floor.name = 'state-floor';
  floor.renderOrder = 1;

  const canvas = document.createElement('canvas');
  canvas.width = LABEL.w; canvas.height = LABEL.h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  label.scale.set(LABEL.scale, LABEL.scale * LABEL.h / LABEL.w, 1);
  label.position.y = 4;
  label.renderOrder = 10;
  label.name = 'state-label';

  const mark = { frame, bands, floor, label, canvas, tex, key: '' };
  for (const b of bands) b.userData.mark = mark;
  g.add(frame, floor, label);
  paint(mark, cell.state, false);
  return mark;
}

function paint(m, state, selected) {
  const c = STATE_COLOR[state] ?? STATE_COLOR.IDLE;
  m.bands[0].material.color.setHex(selected ? brighten(c) : c);
  m.bands[0].material.opacity = selected ? 1 : 0.8;
  m.floor.material.color.setHex(c);
  const t = selected ? FRAME.bandSel : FRAME.band;
  for (const b of m.bands) {
    const { sx, sz } = b.userData.base;
    b.scale.set(sx === 1 ? t : sx + t, sz === 1 ? t : sz + t, 1);
  }
  m.key = '';
}

function brighten(hex) {
  const c = new THREE.Color(hex);
  return c.lerp(new THREE.Color(0xffffff), 0.35).getHex();
}

function drawLabel(m, cell, unit, selected) {
  const sub = unit
    ? unit.role === 'source' ? `키트 ${unit.done}개 분류` : `재고 ${unit.stock} · 완료 ${unit.done}`
    : cell.label;
  const pct = unit && cell.state === 'BUSY' ? Math.floor(unit.progress * 20) : -1;
  const key = `${cell.state}|${sub}|${pct}|${selected}`;
  if (key === m.key) return;
  m.key = key;
  const ctx = m.canvas.getContext('2d');
  const { w, h } = LABEL;
  ctx.clearRect(0, 0, w, h);
  const col = `#${(STATE_COLOR[cell.state] ?? STATE_COLOR.IDLE).toString(16).padStart(6, '0')}`;
  roundRect(ctx, 6, 6, w - 12, h - 12, 22);
  ctx.fillStyle = selected ? 'rgba(18,28,40,0.94)' : 'rgba(14,17,22,0.82)';
  ctx.fill();
  ctx.lineWidth = selected ? 6 : 3;
  ctx.strokeStyle = col;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 54px system-ui, "Malgun Gothic", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(cell.id, 30, 56);
  const badge = `${cell.state} ${STATE_TEXT[cell.state] ?? ''}`;
  ctx.font = 'bold 36px system-ui, "Malgun Gothic", sans-serif';
  const bw = ctx.measureText(badge).width + 28;
  roundRect(ctx, w - bw - 26, 30, bw, 52, 12);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.fillStyle = '#0e1116';
  ctx.fillText(badge, w - bw - 12, 57);
  ctx.fillStyle = '#c4ccd6';
  ctx.font = '34px system-ui, "Malgun Gothic", sans-serif';
  ctx.fillText(sub, 30, 116);
  if (pct >= 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(30, h - 26, w - 60, 8);
    ctx.fillStyle = col;
    ctx.fillRect(30, h - 26, ((w - 60) * pct) / 20, 8);
  }
  m.tex.needsUpdate = true;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function disposeMark(m) {
  m.bands[0].material.dispose();
  for (const b of m.bands) b.geometry.dispose();
  m.floor.geometry.dispose();
  m.floor.material.dispose();
  m.tex.dispose();
  m.label.material.dispose();
}