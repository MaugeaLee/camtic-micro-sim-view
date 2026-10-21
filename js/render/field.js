// 필드: 바닥·통로 표시·벽·기둥. 재질은 meta-factory factory.js(buildBuilding · floorTexture)의 바닥·벽 톤을 따른다.
// 로봇·설비는 두지 않는다. 치수는 정의 데이터(def)에서만 받는다.
import * as THREE from 'three';
import { columnXs } from './field-def.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...o });

const COLOR = Object.freeze({ floorTint: 0xd8e2ec, lane: 0x4a5560, laneLine: 0xe8b923, wall: 0xc9ccd1, steel: 0x9aa3ad, accent: 0x1f6feb });
const LANE_LINE = 0.1;

export function buildField(scene, def) {
  const { size: { w: W, d: D }, wall, column, band } = def;
  const root = new THREE.Group();
  root.name = 'field';

  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(), color: COLOR.floorTint, roughness: 0.85, metalness: 0.05 });
  floorMat.map.repeat.set(W / def.tile, D / def.tile);
  const floor = plane(W, D, floorMat, 0);
  floor.name = 'floor';
  root.add(floor);

  const laneMat = std(COLOR.lane, { roughness: 0.9 });
  const lineMat = std(COLOR.laneLine, { roughness: 0.7 });
  for (const l of def.lanes) {
    root.add(plane(l.w, l.d, laneMat, 0.005, l.x, l.z));
    const horiz = l.w >= l.d;
    for (const s of [-1, 1]) {
      root.add(horiz
        ? plane(l.w, LANE_LINE, lineMat, 0.01, l.x, l.z + s * (l.d / 2))
        : plane(LANE_LINE, l.d, lineMat, 0.01, l.x + s * (l.w / 2), l.z));
    }
  }

  const wallMat = std(COLOR.wall, { roughness: 0.9 });
  const steel = std(COLOR.steel, { metalness: 0.65, roughness: 0.32 });
  const z0 = -D / 2, x0 = -W / 2, x1 = W / 2, H = wall.h, T = wall.t;
  const sides = new Set(wall.sides);
  // 벽은 그림자를 드리우지 않는다 — 해가 비스듬해 바닥 절반을 덮는다. 받기만 한다.
  if (sides.has('back')) root.add(box(W + T, H, T, wallMat, 0, H / 2, z0, false));
  if (sides.has('front')) root.add(box(W + T, H, T, wallMat, 0, H / 2, -z0, false));
  if (sides.has('left')) root.add(box(T, H, D, wallMat, x0, H / 2, 0, false));
  if (sides.has('right')) root.add(box(T, H, D, wallMat, x1, H / 2, 0, false));

  if (sides.has('back')) {
    for (const x of columnXs(def)) root.add(box(column.size, H, column.size, steel, x, H / 2, z0 + T / 2 + column.size / 2));
    root.add(box(W, band.h, band.d, std(COLOR.accent, { roughness: 0.4 }), 0, band.y, z0 + T / 2 + band.d / 2));
  }

  scene.add(root);
  return { root, floorMat };
}

function plane(w, d, mat, y, x = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

function box(w, h, d, mat, x, y, z, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

// 512 px 한 장 = def.tile m, 128 px 격자. 잡티는 고정 시드라 매번 같은 바닥이다.
function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#8b9096';
  g.fillRect(0, 0, 512, 512);
  const rnd = mulberry32(0x5eed);
  for (let i = 0; i < 4000; i++) {
    const v = 120 + rnd() * 40;
    g.fillStyle = `rgba(${v},${v + 2},${v + 5},0.25)`;
    g.fillRect(rnd() * 512, rnd() * 512, 2, 2);
  }
  g.strokeStyle = 'rgba(40,44,50,0.55)';
  g.lineWidth = 2;
  for (let i = 0; i <= 512; i += 128) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
