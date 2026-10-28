// 온보드 라이브 뷰: 같은 씬을 장비에 단 가상 카메라로 렌더 타깃에 다시 그려 Detail 칸에 붙인다.
// 관제 모니터(CCTV)와 같이 녹화·감지·송출은 없다. 프레임마다 포커스된 장비 하나만(def.fps).
import * as THREE from 'three';

export const LIVE_VIEW = Object.freeze({ w: 480, h: 270, fps: 8, near: 0.04, far: 70 });

export function camLens({ scale = 1 } = {}) {
  const g = new THREE.Group();
  g.name = 'live-cam';
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.055 * scale, 0.036 * scale, 0.07 * scale),
    new THREE.MeshStandardMaterial({ color: 0x1a1f26, roughness: 0.45, metalness: 0.45 }),
  );
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016 * scale, 0.02 * scale, 0.018 * scale, 12),
    new THREE.MeshStandardMaterial({ color: 0x152433, emissive: 0x3aa0ff, emissiveIntensity: 0.4, roughness: 0.22, metalness: 0.2 }),
  );
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.044 * scale;
  body.castShadow = true;
  g.add(body, lens);
  return g;
}

export class LiveCam {
  constructor(stage, canvas) {
    this.stage = stage;
    this.canvas = canvas;
    this.cam = new THREE.PerspectiveCamera(70, LIVE_VIEW.w / LIVE_VIEW.h, LIVE_VIEW.near, LIVE_VIEW.far);
    this.rt = new THREE.WebGLRenderTarget(LIVE_VIEW.w, LIVE_VIEW.h, { samples: 0 });
    this.ctx = canvas?.getContext('2d') ?? null;
    if (canvas) { canvas.width = LIVE_VIEW.w; canvas.height = LIVE_VIEW.h; }
    this.buf = new Uint8Array(LIVE_VIEW.w * LIVE_VIEW.h * 4);
    this.img = this.ctx?.createImageData(LIVE_VIEW.w, LIVE_VIEW.h) ?? null;
    this.pose = null;
    this.mounts = new Map();
    this.acc = 0;
    this.enabled = true;
  }

  mount(id, obj) {
    if (id && obj) this.mounts.set(id, obj);
  }

  clearMounts() { this.mounts.clear(); }

  setPose(pose) {
    this.pose = pose && Number.isFinite(pose.eye?.[0]) && Number.isFinite(pose.look?.[0]) ? pose : null;
  }

  // dt: 벽시계. 포커스된 장비만 다시 그린다.
  update(dt) {
    if (!this.enabled || this.stage.lost || !this.ctx || !this.pose) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    this.acc += dt;
    if (this.acc < 1 / LIVE_VIEW.fps) return;
    this.acc = Math.min(this.acc - 1 / LIVE_VIEW.fps, 1 / LIVE_VIEW.fps);
    this.render();
  }

  refresh() {
    if (this.enabled && this.pose && !this.stage.lost) this.render();
  }

  render() {
    const { eye, look, fov } = this.pose;
    this.cam.fov = fov ?? 70;
    this.cam.updateProjectionMatrix();
    this.cam.position.set(eye[0], eye[1], eye[2]);
    this.cam.lookAt(look[0], look[1], look[2]);
    this.cam.updateMatrixWorld();

    const r = this.stage.renderer, { scene } = this.stage;
    const hid = [];
    const lens = this.mounts.get(this.pose.id);
    if (lens) { hid.push(lens); lens.visible = false; }
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.render(scene, this.cam);
    r.setRenderTarget(prev);
    for (const o of hid) o.visible = true;

    r.readRenderTargetPixels(this.rt, 0, 0, LIVE_VIEW.w, LIVE_VIEW.h, this.buf);
    const { data } = this.img, { w, h } = LIVE_VIEW, row = w * 4;
    for (let y = 0; y < h; y++) data.set(this.buf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    this.ctx.putImageData(this.img, 0, 0);
  }
}
