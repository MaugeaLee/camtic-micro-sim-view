// 관제 모니터: 뒷벽에 건 화면 한 장에 내부 CCTV(가상 카메라) 영상을 칸마다 띄운다.
// 영상 = 같은 씬을 CCTV 카메라로 렌더 타깃 한 장의 칸(viewport)에 다시 그린 것. 프레임마다 한 칸씩 차례로 갱신(def.fps).
// 녹화·감지·네트워크 송출은 없다. 셀·자리 위치는 main 이 넘기는 placeOf(id) 로만 받는다(sim import 없음).
import * as THREE from 'three';

const LOOK_Y = 0.8;          // 셀·자리를 볼 때 겨누는 높이(m)
const BEZEL = 0.18, DEPTH = 0.14;
const WALL_GAP = 0.9;        // 뒷벽 안쪽 면에서 화면까지(기둥 앞)

export class ControlMonitor {
  // field: FIELD(벽 위치) · M: MONITOR · cams: CCTV 정의
  constructor(stage, field, M, cams) {
    this.stage = stage;
    this.M = M;
    this.defs = cams;
    this.enabled = true;
    this.next = 0;
    this.acc = 0;
    this.clockText = '';
    const z = -field.size.d / 2 + field.wall.t / 2 + WALL_GAP;

    this.root = new THREE.Group();
    this.root.name = 'control-monitor';
    this.root.position.set(M.x, M.y, z);
    stage.scene.add(this.root);

    this.rt = new THREE.WebGLRenderTarget(M.res[0], M.res[1], { samples: 0 });
    this.rt.scissorTest = true;
    this.tile = { w: Math.floor(M.res[0] / M.cols), h: Math.floor(M.res[1] / M.rows) };

    const frame = new THREE.Mesh(new THREE.BoxGeometry(M.w + BEZEL * 2, M.h + BEZEL * 2, DEPTH), new THREE.MeshStandardMaterial({ color: 0x1a1f26, roughness: 0.5, metalness: 0.3 }));
    frame.position.z = -DEPTH / 2;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(M.w, M.h), new THREE.MeshBasicMaterial({ map: this.rt.texture }));
    this.screen.position.z = 0.002;
    this.canvas = document.createElement('canvas');
    [this.canvas.width, this.canvas.height] = M.res;
    this.overTex = new THREE.CanvasTexture(this.canvas);
    this.overTex.colorSpace = THREE.SRGBColorSpace;
    this.over = new THREE.Mesh(new THREE.PlaneGeometry(M.w, M.h), new THREE.MeshBasicMaterial({ map: this.overTex, transparent: true, toneMapped: false, depthWrite: false }));
    this.over.position.z = 0.004;
    const arm = new THREE.MeshStandardMaterial({ color: 0x59616b, metalness: 0.6, roughness: 0.4 });
    const arms = [-1, 1].map((s) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, WALL_GAP), arm);
      m.position.set(s * M.w * 0.3, M.h / 2 - 0.4, -WALL_GAP / 2);
      return m;
    });
    this.root.add(frame, this.screen, this.over, ...arms);

    this.cams = cams.map((c) => {
      const cam = new THREE.PerspectiveCamera(58, this.tile.w / this.tile.h, 0.2, 200);
      cam.name = c.id;
      return { def: c, cam };
    });
    this.setPlaces(() => null);
    this.drawOverlay();
  }

  // placeOf(id) → {x,z} | null. 셀을 옮기면 그 셀을 보는 카메라도 따라간다.
  setPlaces(placeOf) {
    for (const { def, cam } of this.cams) {
      const fixed = typeof def.look === 'object';
      const p = fixed ? def.look : placeOf(def.look);
      const t = p ? { x: p.x, y: fixed ? p.y : LOOK_Y, z: p.z } : { x: 0, y: LOOK_Y, z: 0 };
      const [dx, dy, dz] = def.from;
      if (fixed) cam.position.set(dx, dy, dz);
      else cam.position.set(t.x + dx, t.y + dy, t.z + dz);
      cam.lookAt(t.x, t.y, t.z);
      cam.updateMatrixWorld();
    }
  }

  setEnabled(on) {
    this.enabled = on;
    this.root.visible = on;
  }

  // 프레임마다: 시간이 되면 한 칸을 다시 그리고, 시계 문구가 바뀌면 덮개를 다시 그린다.
  update(dt, clockText) {
    if (!this.enabled || this.stage.lost) return;
    if (clockText !== this.clockText) { this.clockText = clockText; this.drawOverlay(); }
    this.acc += dt;
    const every = 1 / (this.M.fps * this.cams.length);
    if (this.acc < every) return;
    this.acc = Math.min(this.acc - every, every);
    this.renderTile(this.next);
    this.next = (this.next + 1) % this.cams.length;
  }

  // 모든 칸을 바로 그린다(시작·점검용).
  refresh() {
    for (let i = 0; i < this.cams.length; i++) this.renderTile(i);
  }

  renderTile(i) {
    const r = this.stage.renderer, { scene } = this.stage, { w, h } = this.tile;
    const c = i % this.M.cols, row = Math.floor(i / this.M.cols);
    const x = c * w, y = (this.M.rows - 1 - row) * h;
    this.rt.viewport.set(x, y, w, h);
    this.rt.scissor.set(x, y, w, h);
    // 그림자 맵 갱신을 끄면 칸이 어둡게(그림자 속처럼) 나온다 — 갱신은 그대로 둔다.
    const prev = r.getRenderTarget();
    this.root.visible = false;          // 화면이 자기 텍스처를 그리는 되먹임 방지
    r.setRenderTarget(this.rt);
    r.render(scene, this.cams[i].cam);
    r.setRenderTarget(prev);
    this.root.visible = true;
  }

  // 칸 테두리 · 카메라 이름 · 시뮬 시각(CCTV 화면 글자)
  drawOverlay() {
    const g = this.canvas.getContext('2d'), [W, H] = this.M.res, { w, h } = this.tile;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(10,14,20,0.95)';
    g.lineWidth = 6;
    for (let c = 1; c < this.M.cols; c++) { g.beginPath(); g.moveTo(c * w, 0); g.lineTo(c * w, H); g.stroke(); }
    for (let r = 1; r < this.M.rows; r++) { g.beginPath(); g.moveTo(0, r * h); g.lineTo(W, r * h); g.stroke(); }
    const fs = Math.round(h * 0.075);
    g.font = `600 ${fs}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
    g.textBaseline = 'top';
    this.cams.forEach(({ def }, i) => {
      const x = (i % this.M.cols) * w, y = Math.floor(i / this.M.cols) * h, pad = fs * 0.5;
      const label = `${def.id}  ${def.name}`;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(x + pad * 0.6, y + pad * 0.6, g.measureText(label).width + pad * 1.2, fs * 1.4);
      g.fillStyle = '#f2f5f8';
      g.fillText(label, x + pad * 1.2, y + pad * 0.6 + fs * 0.2);
      if (this.clockText) {
        const tw = g.measureText(this.clockText).width;
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.fillRect(x + w - tw - pad * 1.8, y + h - fs * 1.4 - pad * 0.6, tw + pad * 1.2, fs * 1.4);
        g.fillStyle = '#f2f5f8';
        g.fillText(this.clockText, x + w - tw - pad * 1.2, y + h - fs * 1.2 - pad * 0.6);
      }
    });
    this.overTex.needsUpdate = true;
  }
}
