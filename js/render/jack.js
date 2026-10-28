// 지개차 AMR 절차 형상: 파란 구동부 · H 마스트 · 앞 포크(가정). 그리기만 한다.
// GLB 없음. 치수·색은 참고 사진 비율. 키트는 parts.js 가 포크 윗면(deck)에 그린다.
import * as THREE from 'three';

export const JACK_VIEW = Object.freeze({
  cam: Object.freeze({ y: 1.56, z: -0.18 }),
});

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.22, ...o });

function shade(o) {
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

function box(w, h, d, mat) {
  return shade(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
}

function cyl(rt, rb, h, mat, seg = 16) {
  return shade(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat));
}

function ball(r, mat, seg = 14) {
  return shade(new THREE.Mesh(new THREE.SphereGeometry(r, seg, 12), mat));
}

function put(m, x, y, z) { m.position.set(x, y, z); return m; }

function tape(parent, yellow, black, { x, y, z, w, h, d, n = 7, axis = 'x' }) {
  const step = (axis === 'x' ? w : d) / n;
  for (let i = 0; i < n; i++) {
    const m = box(axis === 'x' ? step * 0.92 : w, h, axis === 'x' ? d : step * 0.92, i % 2 ? black : yellow);
    const ox = axis === 'x' ? x - w / 2 + step * (i + 0.5) : x;
    const oz = axis === 'z' ? z - d / 2 + step * (i + 0.5) : z;
    parent.add(put(m, ox, y, oz));
  }
}

// origin = 바닥 중심(키트 xz). +z = 포크/진행. deck = 포크 윗면(sim JACK.deck).
export function buildJack({ deck = 0.42, led } = {}) {
  const g = new THREE.Group();
  g.name = 'jack-body';
  const blue = M('#3aa4d6', { roughness: 0.38, metalness: 0.12 });
  const dark = M('#1a1e24', { roughness: 0.48, metalness: 0.28 });
  const steel = M('#2a3038', { roughness: 0.4, metalness: 0.45 });
  const yellow = M('#e6c13a', { roughness: 0.45, metalness: 0.2 });
  const glass = M('#1a2833', { roughness: 0.12, metalness: 0.55, emissive: '#0a3040', emissiveIntensity: 0.25 });
  const red = M('#c62828', { roughness: 0.35, metalness: 0.3 });
  const rubber = M('#14171b', { roughness: 0.9, metalness: 0.05 });
  const ledMat = led ?? M('#111111', { emissive: '#4fb3ff', emissiveIntensity: 1.6 });

  const forkH = 0.05;
  const forkY = deck - forkH / 2;
  const forkL = 1.16;
  const forkZ = 0.36;
  const span = 0.19;

  const hull = box(0.74, 0.12, 0.72, dark);
  put(hull, 0, 0.07, -0.48);
  const belly = box(0.62, 0.08, 0.5, dark);
  put(belly, 0, 0.16, -0.48);
  g.add(hull, belly);
  tape(g, yellow, dark, { x: 0, y: 0.125, z: -0.14, w: 0.72, h: 0.03, d: 0.04, n: 9, axis: 'x' });
  tape(g, yellow, dark, { x: 0, y: 0.125, z: -0.82, w: 0.72, h: 0.03, d: 0.04, n: 9, axis: 'x' });
  tape(g, yellow, dark, { x: -0.355, y: 0.125, z: -0.48, w: 0.04, h: 0.03, d: 0.64, n: 7, axis: 'z' });
  tape(g, yellow, dark, { x: 0.355, y: 0.125, z: -0.48, w: 0.04, h: 0.03, d: 0.64, n: 7, axis: 'z' });

  const cab = box(0.66, 1.08, 0.54, blue);
  put(cab, 0, 0.72, -0.50);
  const cap = box(0.70, 0.10, 0.58, dark);
  put(cap, 0, 1.28, -0.50);
  const chin = box(0.70, 0.10, 0.58, dark);
  put(chin, 0, 0.22, -0.50);
  const shoulderL = box(0.08, 0.42, 0.56, dark);
  const shoulderR = shoulderL.clone();
  put(shoulderL, -0.31, 1.04, -0.50);
  put(shoulderR, 0.31, 1.04, -0.50);
  const vLeft = box(0.06, 0.38, 0.02, dark);
  const vRight = vLeft.clone();
  put(vLeft, -0.10, 0.92, -0.772);
  put(vRight, 0.10, 0.92, -0.772);
  vLeft.rotation.z = 0.45;
  vRight.rotation.z = -0.45;
  const face = box(0.50, 0.72, 0.02, blue);
  put(face, 0, 0.70, -0.772);
  g.add(cab, cap, chin, shoulderL, shoulderR, vLeft, vRight, face);

  const slot = box(0.045, 0.42, 0.03, dark);
  put(slot, 0, 0.62, -0.786);
  const strip = box(0.022, 0.36, 0.018, ledMat);
  put(strip, 0, 0.62, -0.798);
  const screen = box(0.12, 0.08, 0.02, glass);
  put(screen, 0.14, 1.12, -0.786);
  const panel = box(0.10, 0.05, 0.018, dark);
  put(panel, -0.16, 1.14, -0.786);
  const knobs = [-0.18, -0.14, -0.10].map((x, i) => {
    const k = ball(0.012, i === 1 ? yellow : M('#3ccf8e', { emissive: '#1a7a48', emissiveIntensity: 0.5 }), 8);
    return put(k, x, 1.14, -0.798);
  });
  const estop = ball(0.028, red, 10);
  put(estop, 0, 1.02, -0.798);
  const estopSide = ball(0.022, red, 10);
  put(estopSide, 0.355, 0.92, -0.42);
  const sideGlass = box(0.02, 0.10, 0.14, glass);
  put(sideGlass, 0.342, 0.72, -0.50);
  g.add(slot, strip, screen, panel, ...knobs, estop, estopSide, sideGlass);

  const mastZ = -0.20;
  const postL = box(0.06, 0.52, 0.08, dark);
  const postR = postL.clone();
  put(postL, -0.13, 1.42, mastZ);
  put(postR, 0.13, 1.42, mastZ);
  const mastTop = box(0.36, 0.06, 0.10, dark);
  put(mastTop, 0, 1.66, mastZ);
  const mastBack = box(0.22, 0.36, 0.04, dark);
  put(mastBack, 0, 1.38, mastZ - 0.04);
  const carriage = box(0.46, 0.10, 0.08, steel);
  put(carriage, 0, forkY + 0.04, -0.16);
  g.add(postL, postR, mastTop, mastBack, carriage);

  const head = box(0.22, 0.16, 0.18, dark);
  put(head, 0, 1.78, mastZ);
  const lidar = cyl(0.055, 0.055, 0.06, M('#2a333c', { roughness: 0.22, metalness: 0.55 }), 20);
  put(lidar, 0, 1.88, mastZ);
  const camL = box(0.05, 0.04, 0.05, glass);
  const camR = camL.clone();
  put(camL, -0.05, 1.78, mastZ + 0.08);
  put(camR, 0.05, 1.78, mastZ + 0.08);
  const beacon = cyl(0.025, 0.025, 0.05, M('#c62828', { emissive: '#ff2a2a', emissiveIntensity: 0.7 }), 10);
  put(beacon, 0, 1.96, mastZ);
  const stack = [
    ['#e24b4b', 1.58],
    ['#e6c13a', 1.50],
    ['#3ccf8e', 1.42],
  ].map(([c, y]) => {
    const s = cyl(0.018, 0.018, 0.06, M(c, { emissive: c, emissiveIntensity: 0.55 }), 8);
    return put(s, -0.13, y, mastZ + 0.06);
  });
  g.add(head, lidar, camL, camR, beacon, ...stack);

  for (const x of [-span, span]) {
    const fork = box(0.09, forkH, forkL, steel);
    put(fork, x, forkY, forkZ);
    const tip = box(0.10, 0.04, 0.08, yellow);
    put(tip, x, 0.05, forkZ + forkL / 2 - 0.02);
    const leg = box(0.10, 0.07, forkL, dark);
    put(leg, x, 0.055, forkZ);
    g.add(fork, tip, leg);
  }

  const wheels = [];
  for (const [x, z, r, t] of [[-0.28, -0.55, 0.09, 0.07], [0.28, -0.55, 0.09, 0.07], [-span, 0.88, 0.05, 0.06], [span, 0.88, 0.05, 0.06]]) {
    const w = cyl(r, r, t, rubber, 14);
    w.rotation.z = Math.PI / 2;
    put(w, x, r, z);
    wheels.push(w);
    g.add(w);
  }

  return { body: g, wheels, camAt: [0, JACK_VIEW.cam.y, JACK_VIEW.cam.z] };
}
