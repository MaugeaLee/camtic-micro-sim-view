// 공급 AMR 플릿을 그린다: 차체·바퀴·상태등·적재 토트, 남은 경로선, ACS 지도(루트 통로·셀 정차 칸·충전 자리·교차 구역) 바닥 표시.
// state.fleet(key) 의 amrs · acs.map() 을 읽기만 한다 (sim 을 import 하지 않음). 플릿(도어트림 · 부속 부품)마다 하나씩 만든다 — 차체·통로선 색으로 구분.
import * as THREE from 'three';

const BODY = Object.freeze({ l: 1.1, w: 0.78, h: 0.3, wheel: 0.1, clear: 0.06 });
const ROAD = Object.freeze({ two: 2.5, one: 1.4, link: 1.3, line: 0.07, dash: 0.8, gap: 0.7, arrow: 3.5 });
const LED = Object.freeze({ move: 0x4fb3ff, wait: 0xf5b74e, charge: 0x3ccf8e, low: 0xff5d5d, park: 0x6b7480 });
const PATH_MAX = 40;

export class FleetView {
  // fleet: state.fleet 키 · body: 차체 색 · lane: 통로 가장자리 선 색
  constructor(scene, { fleet = 'trim', body = 0xdfe3e8, lane = 0xe8b923 } = {}) {
    this.scene = scene;
    this.key = fleet;
    this.root = new THREE.Group();
    this.root.name = fleet === 'trim' ? 'fleet' : `fleet-${fleet}`;
    scene.add(this.root);
    this.items = new Map();
    this.mapRev = null;
    this.override = null;
    this.marks = new THREE.Group();
    this.marks.name = 'fleet-marks';
    this.root.add(this.marks);
    this.followed = null;
    this.t = 0;
    this.top = null;
    this.shared = sharedParts(body, lane);
  }

  of(state) { return state.fleet ? state.fleet(this.key) : { amrs: state.amrs, acs: state.acs }; }

  setup(state) {
    for (const it of this.items.values()) { this.root.remove(it.g, it.line); it.line.geometry.dispose(); it.line.material.dispose(); }
    this.items.clear();
    this.clearMarks();
    this.mapRev = undefined;
    for (const a of this.of(state).amrs) this.items.set(a.id, this.make(a));
    this.followed = state.followed;
  }

  showMap(map) { this.override = map ?? null; }

  // 적재면 높이(m, 바닥 기준). null 이면 차체 윗면. 다음 setup 부터 반영.
  setTop(y) { this.top = Number.isFinite(y) ? y : null; }

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
    const deckY = BODY.clear + BODY.h + 0.03, extra = [];
    // 상부 모듈(부품 AMR): 적재면을 top 높이로 올린다(분류 레인 · 투입 이송기 높이에 맞춤)
    if (this.top > deckY + 0.05) {
      const h = this.top - deckY;
      const col = new THREE.Mesh(S.module, S.moduleMat);
      col.scale.y = h - 0.03;
      col.position.set(0, deckY + (h - 0.03) / 2, -0.06);
      const plate = new THREE.Mesh(S.deck, S.deckMat);
      plate.position.y = this.top - 0.015;
      extra.push(col, plate);
    }
    const tote = new THREE.Mesh(S.tote, S.toteMat);
    tote.position.y = Math.max(deckY, this.top ?? 0) + 0.17;
    tote.visible = false;
    const sel = new THREE.Mesh(S.ring, new THREE.MeshBasicMaterial({ color: 0x4fb3ff, transparent: true, opacity: 0.9, depthWrite: false }));
    sel.rotation.x = -Math.PI / 2;
    sel.position.y = 0.02;
    sel.visible = false;
    g.add(body, deck, led, ledBack, lidar, ...wheels, ...extra, tote, sel);
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
    // override: main 이 넘긴 지도(편집 미리보기·시나리오 없음). 없으면 ACS 지도.
    const { acs, amrs } = this.of(state);
    const key = this.override ?? (acs ? acs.geoRev : null);
    if (key !== this.mapRev) { this.mapRev = key; this.drawMap(this.override ?? acs?.map() ?? null); }
    for (const a of amrs) {
      const it = this.items.get(a.id);
      if (!it) continue;
      it.g.visible = !a.off;
      if (a.off) { it.line.visible = false; continue; }
      it.g.position.set(a.x, 0, a.z);
      it.g.rotation.y = a.heading;
      const spin = (a.dist - it.dist) / BODY.wheel;
      it.dist = a.dist;
      for (const w of it.wheels) w.rotation.x += spin;
      it.tote.visible = !!a.load && !a.load.e;   // 키트 엔티티가 있으면 그것을 그린다(parts.js)
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

  // ACS 지도를 바닥에 그린다. 루트 간선 = 통로 띠(양방향은 가운데 점선, 단방향은 화살표), 접속선 = 좁은 진입로,
  // 셀 정차 칸(마지막 = 도크), 입구·출구 막대, 충전 자리 + 충전기, 교차 구역 원. 점검에 걸린 것은 빨갛게.
  drawMap(map) {
    this.clearMarks();
    if (!map) return;
    const S = this.shared, M = this.marks;
    for (const e of map.edges) {
      const w = e.oneway ? ROAD.one : ROAD.two;
      M.add(strip(e.pa, e.pb, w, e.bad ? S.badMat : S.roadMat, 0.004, w / 2));
      for (const s of [-1, 1]) M.add(strip(e.pa, e.pb, ROAD.line, S.lineMat, 0.008, w / 2, s * (w / 2 - ROAD.line)));
      if (e.oneway) arrows(M, e.pa, e.pb, S);
      else dashes(M, e.pa, e.pb, S);
    }
    for (const n of map.nodes) {
      const m = new THREE.Mesh(S.nodePad, S.roadMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(n.x, 0.005, n.z);
      M.add(m);
    }
    for (const c of map.cells) {
      for (const [p, q] of c.links) M.add(strip(p, q, ROAD.link, c.bad ? S.badMat : S.roadMat, 0.004, 0));
      c.stops.forEach((s, i) => {
        const dock = i === c.stops.length - 1;
        const pad = new THREE.Mesh(dock ? S.dockPad : S.queuePad, c.bad ? S.badMat : dock ? S.dockMat : S.queueMat);
        pad.rotation.set(-Math.PI / 2, s.heading, 0, 'YXZ');
        pad.position.set(s.x, 0.012, s.z);
        M.add(pad);
      });
      const first = c.stops[0];
      if (first) M.add(bar(c.entry, first.heading, S.entryMat));
      if (c.exit) M.add(bar(c.exit, c.stops.at(-1)?.heading ?? 0, S.exitMat));
    }
    for (const h of map.homes) {
      if (h.link) M.add(strip(h.link[0], h.link[1], ROAD.link, S.roadMat, 0.004, 0));
      const pad = new THREE.Mesh(S.parkPad, S.parkMat);
      pad.rotation.set(-Math.PI / 2, h.heading, 0, 'YXZ');
      pad.position.set(h.x, 0.012, h.z);
      const charger = new THREE.Mesh(S.charger, S.chargerMat);
      charger.position.set(h.x + Math.sin(h.heading) * 0.9, 0.25, h.z + Math.cos(h.heading) * 0.9);
      charger.rotation.y = h.heading;
      charger.castShadow = true;
      M.add(pad, charger);
    }
    for (const z of map.zones) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(z.r - 0.06, z.r, 64), S.zoneMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(z.x, 0.009, z.z);
      ring.userData.own = true;
      M.add(ring);
    }
  }

  clearMarks() {
    for (const o of [...this.marks.children]) {
      this.marks.remove(o);
      o.traverse((k) => { if (k.userData.own) k.geometry.dispose(); });
    }
  }

  focusOf(id, state) {
    const a = this.of(state).amrs.find((k) => k.id === id);
    return a ? { center: new THREE.Vector3(a.x, 0.4, a.z), size: 4 } : null;
  }

  pickables() {
    const out = [];
    for (const it of this.items.values()) it.g.traverse((o) => { if (o.isMesh && o.visible) out.push(o); });
    return out;
  }
}

// a→b 를 따라 놓인 바닥 띠. ext = 양 끝 연장, side = 진행 방향 오른쪽(+) 으로 비킴.
function strip(a, b, w, mat, y, ext = 0, side = 0) {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1e-3;
  const ux = dx / L, uz = dz / L;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, L + 2 * ext), mat);
  m.userData.own = true;
  m.rotation.set(-Math.PI / 2, Math.atan2(dx, dz), 0, 'YXZ');
  m.position.set((a.x + b.x) / 2 - uz * side, y, (a.z + b.z) / 2 + ux * side);
  return m;
}

// 진행 방향을 가로지르는 막대(입구·출구 표시)
function bar(p, heading, mat) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.14), mat);
  m.userData.own = true;
  m.rotation.set(-Math.PI / 2, heading, 0, 'YXZ');
  m.position.set(p.x, 0.013, p.z);
  return m;
}

function dashes(group, a, b, S) {
  const L = Math.hypot(b.x - a.x, b.z - a.z), step = ROAD.dash + ROAD.gap;
  for (let t = ROAD.gap; t + ROAD.dash <= L - ROAD.gap; t += step) {
    const k0 = t / L, k1 = (t + ROAD.dash) / L;
    group.add(strip({ x: a.x + (b.x - a.x) * k0, z: a.z + (b.z - a.z) * k0 }, { x: a.x + (b.x - a.x) * k1, z: a.z + (b.z - a.z) * k1 }, ROAD.line, S.dashMat, 0.008));
  }
}

function arrows(group, a, b, S) {
  const L = Math.hypot(b.x - a.x, b.z - a.z), h = Math.atan2(b.x - a.x, b.z - a.z);
  for (let t = ROAD.arrow / 2; t < L; t += ROAD.arrow) {
    const m = new THREE.Mesh(S.arrow, S.dashMat);
    m.rotation.set(-Math.PI / 2, h, 0, 'YXZ');
    m.position.set(a.x + (b.x - a.x) * (t / L), 0.008, a.z + (b.z - a.z) * (t / L));
    group.add(m);
  }
}

function ledColor(a) {
  if (a.battery < 30) return LED.low;
  if (a.charging) return LED.charge;
  if (a.mode === 'park' && !a.steps.length) return LED.park;
  return a.moving ? LED.move : LED.wait;
}

function sharedParts(bodyColor, laneColor) {
  const rounded = (w, h, d) => new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  return {
    body: rounded(BODY.w, BODY.h, BODY.l),
    bodyMat: new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.45, metalness: 0.15 }),
    deck: rounded(BODY.w - 0.08, 0.03, BODY.l - 0.08),
    deckMat: new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.8 }),
    module: rounded(BODY.w - 0.16, 1, BODY.l - 0.4),
    moduleMat: new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55, metalness: 0.1 }),
    led: rounded(BODY.w * 0.7, 0.05, 0.01),
    lidar: new THREE.CylinderGeometry(0.07, 0.08, 0.1, 20),
    lidarMat: new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.3, metalness: 0.4 }),
    wheel: new THREE.CylinderGeometry(BODY.wheel, BODY.wheel, 0.06, 18),
    wheelMat: new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.9 }),
    tote: rounded(0.6, 0.34, 0.8),
    toteMat: new THREE.MeshStandardMaterial({ color: 0x2f7dd1, roughness: 0.6 }),
    ring: new THREE.RingGeometry(0.85, 0.98, 40),
    dockPad: new THREE.PlaneGeometry(1.0, 1.3),
    dockMat: new THREE.MeshBasicMaterial({ color: 0xf5b74e, transparent: true, opacity: 0.45, depthWrite: false }),
    badMat: new THREE.MeshBasicMaterial({ color: 0xff5d5d, transparent: true, opacity: 0.45, depthWrite: false }),
    queuePad: new THREE.PlaneGeometry(0.95, 1.2),
    queueMat: new THREE.MeshBasicMaterial({ color: 0xf5b74e, transparent: true, opacity: 0.2, depthWrite: false }),
    parkPad: new THREE.PlaneGeometry(1.0, 1.3),
    parkMat: new THREE.MeshBasicMaterial({ color: 0x3ccf8e, transparent: true, opacity: 0.22, depthWrite: false }),
    charger: rounded(0.6, 0.5, 0.25),
    chargerMat: new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.6, emissive: 0x1d6b48, emissiveIntensity: 0.35 }),
    roadMat: new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.9 }),
    lineMat: new THREE.MeshStandardMaterial({ color: laneColor, roughness: 0.7 }),
    dashMat: new THREE.MeshBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.75, depthWrite: false }),
    entryMat: new THREE.MeshBasicMaterial({ color: 0x3ccf8e, transparent: true, opacity: 0.85, depthWrite: false }),
    exitMat: new THREE.MeshBasicMaterial({ color: 0x4fb3ff, transparent: true, opacity: 0.85, depthWrite: false }),
    zoneMat: new THREE.MeshBasicMaterial({ color: 0xf5b74e, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    nodePad: new THREE.CircleGeometry(ROAD.two / 2, 32),
    arrow: (() => {
      const s = new THREE.Shape();
      // 바닥에 누이면(x −90°) 모양의 −y 가 진행 방향(+z 쪽)이 된다
      s.moveTo(0, -0.45); s.lineTo(-0.35, 0.15); s.lineTo(-0.12, 0.15); s.lineTo(0, -0.05); s.lineTo(0.12, 0.15); s.lineTo(0.35, 0.15); s.closePath();
      return new THREE.ShapeGeometry(s);
    })(),
  };
}
