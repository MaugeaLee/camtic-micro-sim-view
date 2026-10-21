// 공급 AMR 플릿을 그린다: 차체·바퀴·상태등·적재 토트, 남은 경로선, 도크·대기 줄 바닥 표시.
// state.amrs · state.plant.docks 를 읽기만 한다 (sim 을 import 하지 않음).
import * as THREE from 'three';
import { FIELD } from './field-def.js';

const LANE = FIELD.lanes[0];
const BODY = Object.freeze({ l: 1.1, w: 0.78, h: 0.3, wheel: 0.1, clear: 0.06 });
const LED = Object.freeze({ move: 0x4fb3ff, wait: 0xf5b74e, charge: 0x3ccf8e, low: 0xff5d5d, park: 0x6b7480 });
const PATH_MAX = 40;

export class FleetView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'fleet';
    scene.add(this.root);
    this.items = new Map();
    this.docksRef = null;
    this.marks = new THREE.Group();
    this.marks.name = 'fleet-marks';
    this.root.add(this.marks);
    this.followed = null;
    this.parks = [];
    this.t = 0;
    this.shared = sharedParts();
  }

  // parks: 대기·충전 칸 [{x,z}] — sim 값이라 main 이 넘긴다.
  setup(state, { parks = [] } = {}) {
    for (const it of this.items.values()) { this.root.remove(it.g, it.line); it.line.geometry.dispose(); it.line.material.dispose(); }
    this.items.clear();
    this.clearMarks();
    this.docksRef = undefined;
    this.parks = parks;
    for (const a of state.amrs) this.items.set(a.id, this.make(a));
    this.followed = state.followed;
  }

  make(a) {
    const S = this.shared;
    const g = new THREE.Group();
    g.name = a.id;
    g.userData.amrId = a.id;
    const body = new THREE.Mesh(S.body, S.bodyMat);
    body.position.y = BODY.clear + BODY.h / 2;
    const deck = new THREE.Mesh(S.deck, S.deckMat);
    deck.position.y = BODY.clear + BODY.h + 0.015;
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: LED.park, emissiveIntensity: 1.6 });
    const led = new THREE.Mesh(S.led, ledMat);
    led.position.set(0, BODY.clear + BODY.h * 0.55, BODY.l / 2 + 0.005);
    const ledBack = led.clone();
    ledBack.position.z = -BODY.l / 2 - 0.005;
    const lidar = new THREE.Mesh(S.lidar, S.lidarMat);
    lidar.position.set(0, BODY.clear + BODY.h + 0.08, BODY.l / 2 - 0.16);
    const wheels = [];
    for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const w = new THREE.Mesh(S.wheel, S.wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(x * (BODY.w / 2 - 0.02), BODY.wheel, z * (BODY.l / 2 - 0.2));
      wheels.push(w);
    }
    const tote = new THREE.Mesh(S.tote, S.toteMat);
    tote.position.y = BODY.clear + BODY.h + 0.03 + 0.17;
    tote.visible = false;
    const sel = new THREE.Mesh(S.ring, new THREE.MeshBasicMaterial({ color: 0x4fb3ff, transparent: true, opacity: 0.9, depthWrite: false }));
    sel.rotation.x = -Math.PI / 2;
    sel.position.y = 0.02;
    sel.visible = false;
    g.add(body, deck, led, ledBack, lidar, ...wheels, tote, sel);
    g.traverse((o) => { if (o.isMesh && o !== sel) { o.castShadow = true; o.userData.amrId = a.id; } });
    this.root.add(g);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PATH_MAX * 3), 3));
    geo.setDrawRange(0, 0);
    const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0x4fb3ff, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.7 }));
    line.frustumCulled = false;
    line.renderOrder = 3;
    this.root.add(line);
    return { g, led: ledMat, wheels, tote, sel, line, dist: a.dist };
  }

  update(dt, state, events) {
    this.t += dt;
    for (const ev of events) if (ev.type === 'follow') this.followed = ev.id;
    const docks = state.plant?.docks ?? null;
    if (docks !== this.docksRef) { this.docksRef = docks; this.drawMarks(docks); }
    for (const a of state.amrs) {
      const it = this.items.get(a.id);
      if (!it) continue;
      it.g.position.set(a.x, 0, a.z);
      it.g.rotation.y = a.heading;
      const spin = (a.dist - it.dist) / BODY.wheel;
      it.dist = a.dist;
      for (const w of it.wheels) w.rotation.x += spin;
      it.tote.visible = !!a.load;
      const c = ledColor(a);
      it.led.emissive.setHex(c);
      it.led.emissiveIntensity = a.moving ? 1.8 : 1.0 + 0.6 * Math.sin(this.t * (a.charging ? 3 : 1.5) + a.idx);
      const on = a.id === this.followed;
      it.sel.visible = on;
      if (on) it.sel.scale.setScalar(1 + 0.08 * Math.sin(this.t * 5));
      this.drawPath(it, a, c);
    }
  }

  drawPath(it, a, color) {
    const pts = a.plan();
    const pos = it.line.geometry.attributes.position;
    const n = Math.min(PATH_MAX, pts.length + 1);
    if (n < 2 || a.mode === 'park') { it.line.visible = false; return; }
    it.line.visible = true;
    pos.setXYZ(0, a.x, 0.05, a.z);
    for (let i = 1; i < n; i++) pos.setXYZ(i, pts[i - 1].x, 0.05, pts[i - 1].z);
    pos.needsUpdate = true;
    it.line.geometry.setDrawRange(0, n);
    it.line.geometry.computeBoundingSphere();
    it.line.computeLineDistances();
    it.line.material.color.setHex(color);
    it.line.material.opacity = a.id === this.followed ? 0.95 : 0.55;
  }

  // 도크 정차점·대기점, 대기·충전 줄을 바닥에 표시한다.
  drawMarks(docks) {
    this.clearMarks();
    const S = this.shared;
    for (const d of Object.values(docks ?? {})) {
      const mat = d.ok ? S.dockMat : S.badMat;
      const stop = new THREE.Mesh(S.dockPad, mat);
      stop.rotation.x = -Math.PI / 2;
      stop.position.set(d.x, 0.012, d.z);
      const q = new THREE.Mesh(S.queuePad, S.queueMat);
      q.rotation.x = -Math.PI / 2;
      q.position.set(d.inX, 0.012, d.queue);
      this.marks.add(stop, q);
      const edge = LANE.z - LANE.d / 2;
      for (const x of [d.inX, d.outX]) {
        if (edge <= d.bay) continue;
        const s = new THREE.Mesh(S.strip, S.spurMat);
        s.rotation.x = -Math.PI / 2;
        s.scale.set(1, edge - d.bay, 1);
        s.position.set(x, 0.011, (d.bay + edge) / 2);
        this.marks.add(s);
      }
    }
    for (const s of this.parks) {
      const p = new THREE.Mesh(S.parkPad, S.parkMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(s.x, 0.012, s.z);
      this.marks.add(p);
    }
  }

  clearMarks() {
    for (const o of [...this.marks.children]) this.marks.remove(o);
  }

  focusOf(id, state) {
    const a = state.amrs.find((k) => k.id === id);
    return a ? { center: new THREE.Vector3(a.x, 0.4, a.z), size: 4 } : null;
  }

  pickables() {
    const out = [];
    for (const it of this.items.values()) it.g.traverse((o) => { if (o.isMesh && o.visible) out.push(o); });
    return out;
  }
}

function ledColor(a) {
  if (a.battery < 30) return LED.low;
  if (a.charging) return LED.charge;
  if (a.mode === 'park' && !a.steps.length) return LED.park;
  return a.moving ? LED.move : LED.wait;
}

function sharedParts() {
  const rounded = (w, h, d) => new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  return {
    body: rounded(BODY.w, BODY.h, BODY.l),
    bodyMat: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.45, metalness: 0.15 }),
    deck: rounded(BODY.w - 0.08, 0.03, BODY.l - 0.08),
    deckMat: new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.8 }),
    led: rounded(BODY.w * 0.7, 0.05, 0.01),
    lidar: new THREE.CylinderGeometry(0.07, 0.08, 0.1, 20),
    lidarMat: new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.3, metalness: 0.4 }),
    wheel: new THREE.CylinderGeometry(BODY.wheel, BODY.wheel, 0.06, 18),
    wheelMat: new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.9 }),
    tote: rounded(0.6, 0.34, 0.8),
    toteMat: new THREE.MeshStandardMaterial({ color: 0x2f7dd1, roughness: 0.6 }),
    ring: new THREE.RingGeometry(0.85, 0.98, 40),
    dockPad: new THREE.PlaneGeometry(1.2, 1.4),
    dockMat: new THREE.MeshBasicMaterial({ color: 0xf5b74e, transparent: true, opacity: 0.35, depthWrite: false }),
    badMat: new THREE.MeshBasicMaterial({ color: 0xff5d5d, transparent: true, opacity: 0.45, depthWrite: false }),
    queuePad: new THREE.PlaneGeometry(1.0, 1.0),
    queueMat: new THREE.MeshBasicMaterial({ color: 0xf5b74e, transparent: true, opacity: 0.18, depthWrite: false }),
    strip: new THREE.PlaneGeometry(0.08, 1),
    spurMat: new THREE.MeshBasicMaterial({ color: 0xf5b74e, transparent: true, opacity: 0.4, depthWrite: false }),
    parkPad: new THREE.PlaneGeometry(1.1, 1.3),
    parkMat: new THREE.MeshBasicMaterial({ color: 0x3ccf8e, transparent: true, opacity: 0.18, depthWrite: false }),
  };
}
