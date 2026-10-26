// 셀 바닥 자리. DOM 없음. 좌표는 필드 원점 기준, 1 = 1 m. rotY 는 도(0·90·180·270).
// 발자국은 GLB 바닥 AABB 가정(PRESS/SCREW ≈ 10.1×10.8 m, SORT ≈ 16.6×9.5 m). 실측 아님.
import { CELLS } from './cells.js';
import { PARTS_IDS, defaultAmr, defaultPartsAmr, normalizeAmr, validateAmr } from './amrdata.js';

// field-def.js FIELD.size 와 같아야 한다. sim은 render를 import 하지 않는다.
export const FIELD_SIZE = Object.freeze({ w: 76, d: 30 });

// 2: amr(메인 루트·충전 자리·셀 AMR 지점) 추가. 1 은 읽을 때 기본 amr 을 붙인다.
export const LAYOUT_VERSION = 2;
const READS = new Set([1, 2]);
export const SNAP = 1;

export const FOOTPRINT = Object.freeze({
  PRESS: Object.freeze({ w: 10.1, d: 10.82 }),
  SCREW: Object.freeze({ w: 10.1, d: 10.82 }),
  SORT: Object.freeze({ w: 16.56, d: 9.45 }),
  OUT: Object.freeze({ w: 5.05, d: 5.41 }),
  PARTS: Object.freeze({ w: 6, d: 2 }),
});

// 셀이 아닌 AMR 자리(GLB 없음, 절차 형상). OUT = 완료품 적재 구역(협동로봇 + 책장), PARTS = 부속 부품 창고. 자리·크기는 가정이다.
// OUT 은 PRESS 발자국의 절반(5.05×5.41 m), SORT 서쪽(기본 −30, −2)에 따로 둔다. 예전 SORT 옆 5×3 통과형·PRESS 전체 크기는 쓰지 않는다.
// PARTS 는 남쪽 통로의 PRESS 도크 구역과 SCREW 도크 구역 사이(접속 구역이 도크 구역과 합쳐지면 도크에서 다음 미션을 기다리는 차가 길을 막는다).
// 레이아웃 파일에 없으면 기본 자리를 붙인다(예전 파일도 그대로 읽힌다).
export const SITES = Object.freeze(['OUT', 'PARTS']);
export const DEFAULT_SITES = Object.freeze({
  OUT: Object.freeze({ x: -30, z: -2, rotY: 0 }),
  PARTS: Object.freeze({ x: 10, z: -14, rotY: 0 }),
});

// 가정 자리. 서→동 SORT · PRESS · SCREW 한 줄, 통로(+z)는 비운다.
// 셀 GLB AMR 통로 입구가 서쪽 끝이라 셀 서쪽마다 AMR 세로 통로 칸(폭 2.7~3.9 m)을 남긴다. 겹침 없음.
export const DEFAULT_POSES = Object.freeze({
  SORT: Object.freeze({ x: -13, z: -2, rotY: 0 }),
  PRESS: Object.freeze({ x: 4, z: -2, rotY: 0 }),
  SCREW: Object.freeze({ x: 18, z: -2, rotY: 0 }),
});

const IDS = CELLS.map((c) => c.id);
const ROTS = new Set([0, 90, 180, 270]);

export function defaultLayout() {
  return { version: LAYOUT_VERSION, snap: SNAP, cells: { ...DEFAULT_POSES }, sites: { ...DEFAULT_SITES }, amr: defaultAmr(), parts: defaultPartsAmr() };
}

export function snapCoord(v, snap = SNAP) {
  return Math.round(v / snap) * snap;
}

export function snapRot(deg) {
  const t = ((deg % 360) + 360) % 360;
  return Math.round(t / 90) * 90 % 360;
}

export function poseOf(x, z, rotY = 0, snap = SNAP) {
  return { x: snapCoord(x, snap), z: snapCoord(z, snap), rotY: snapRot(rotY) };
}

export function extent(id, rotY = 0) {
  const fp = FOOTPRINT[id];
  if (!fp) return null;
  return rotY % 180 === 90 ? { w: fp.d, d: fp.w } : { w: fp.w, d: fp.d };
}

export function bounds(id, pose) {
  const e = extent(id, pose.rotY);
  if (!e) return null;
  return { x0: pose.x - e.w / 2, x1: pose.x + e.w / 2, z0: pose.z - e.d / 2, z1: pose.z + e.d / 2 };
}

export function insideField(id, pose, field = FIELD_SIZE) {
  const b = bounds(id, pose);
  if (!b) return false;
  const hw = (field.w ?? field.size?.w) / 2, hd = (field.d ?? field.size?.d) / 2;
  return b.x0 >= -hw && b.x1 <= hw && b.z0 >= -hd && b.z1 <= hd;
}

export function overlaps(idA, poseA, idB, poseB) {
  const a = bounds(idA, poseA), b = bounds(idB, poseB);
  if (!a || !b) return false;
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
}

export function validateLayout(raw, field = FIELD_SIZE) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return ['레이아웃이 객체 아님'];
  if (!READS.has(raw.version)) errors.push(`version은 ${[...READS].join('·')}`);
  if (raw.amr != null) errors.push(...validateAmr(raw.amr, IDS, field.size ?? field));
  if (raw.parts != null) errors.push(...validateAmr(raw.parts, [], field.size ?? field).map((e) => `부품 AMR ${e}`));
  if (raw.sites != null) {
    if (typeof raw.sites !== 'object') errors.push('sites가 객체 아님');
    else {
      for (const [id, p] of Object.entries(raw.sites)) {
        if (!SITES.includes(id)) { errors.push(`모르는 자리 ${id}`); continue; }
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || (p.rotY != null && !Number.isFinite(p.rotY))) { errors.push(`${id} x·z는 수`); continue; }
        const pose = poseOf(p.x, p.z, p.rotY ?? 0, raw.snap || SNAP);
        if (!insideField(id, pose, field)) errors.push(`${id}가 바닥 밖`);
        for (const c of IDS) {
          const q = raw.cells?.[c];
          if (q && Number.isFinite(q.x) && Number.isFinite(q.z) && overlaps(id, pose, c, poseOf(q.x, q.z, q.rotY ?? 0, raw.snap || SNAP))) errors.push(`${id}·${c} 겹침`);
        }
      }
    }
  }
  if (!Number.isFinite(raw.snap) || raw.snap <= 0) errors.push('snap은 양수');
  const cells = raw.cells;
  if (!cells || typeof cells !== 'object') return [...errors, 'cells 없음'];
  for (const id of IDS) {
    const p = cells[id];
    if (!p) { errors.push(`${id} 자리 없음`); continue; }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) errors.push(`${id} x·z는 수`);
    if (!ROTS.has(snapRot(p.rotY ?? 0)) || (p.rotY != null && !Number.isFinite(p.rotY))) errors.push(`${id} rotY는 0·90·180·270`);
    else if (!insideField(id, poseOf(p.x, p.z, p.rotY ?? 0, raw.snap || SNAP), field)) errors.push(`${id}가 바닥 밖`);
  }
  for (const k of Object.keys(cells)) if (!IDS.includes(k)) errors.push(`모르는 셀 ${k}`);
  if (!errors.length) {
    for (let i = 0; i < IDS.length; i++) {
      for (let j = i + 1; j < IDS.length; j++) {
        const a = IDS[i], b = IDS[j];
        if (overlaps(a, poseOf(cells[a].x, cells[a].z, cells[a].rotY ?? 0, raw.snap || SNAP), b, poseOf(cells[b].x, cells[b].z, cells[b].rotY ?? 0, raw.snap || SNAP))) {
          errors.push(`${a}·${b} 겹침`);
        }
      }
    }
  }
  return errors;
}

export function normalizeLayout(raw) {
  const snap = Number.isFinite(raw?.snap) && raw.snap > 0 ? raw.snap : SNAP;
  const cells = {};
  for (const id of IDS) {
    const p = raw?.cells?.[id] ?? DEFAULT_POSES[id];
    cells[id] = poseOf(p.x, p.z, p.rotY ?? 0, snap);
  }
  const sites = {};
  for (const id of SITES) {
    const p = raw?.sites?.[id] ?? DEFAULT_SITES[id];
    sites[id] = poseOf(p.x, p.z, p.rotY ?? 0, snap);
  }
  const doc = {
    version: LAYOUT_VERSION, snap, cells, sites,
    amr: normalizeAmr(raw?.amr, [...IDS, 'OUT', 'PRESS:OUT', 'SCREW:OUT', 'SORT:RAW']),
    parts: normalizeAmr(raw?.parts ?? defaultPartsAmr(), PARTS_IDS, defaultPartsAmr()),
  };
  if (raw?.rev != null) doc.rev = raw.rev;
  return doc;
}

export function canPlace(doc, id, pose, field = FIELD_SIZE) {
  if (!IDS.includes(id) && !SITES.includes(id)) return [`없는 자리 ${id}`];
  if (!insideField(id, pose, field)) return [`${id}가 바닥 밖`];
  const errors = [];
  for (const other of IDS) {
    if (other === id) continue;
    if (overlaps(id, pose, other, doc.cells[other])) errors.push(`${id}·${other} 겹침`);
  }
  for (const s of SITES) {
    if (s === id) continue;
    if (doc.sites?.[s] && overlaps(id, pose, s, doc.sites[s])) errors.push(`${id}·${s} 겹침`);
  }
  return errors;
}

export function moveCell(doc, id, pose) {
  return moveItem(doc, id, pose);
}

// 완료품 접근 레일(기본 A4–G4). 구역과 따로 두고, 옮기기·끝점·회전만 한다.
export const SITE_SPUR = Object.freeze({ OUT: Object.freeze(['A4', 'G4']) });

export function spurPts(doc, id) {
  const ids = SITE_SPUR[id];
  if (!ids || !doc.amr?.route?.nodes) return null;
  const pts = ids.map((nid) => doc.amr.route.nodes.find((n) => n.id === nid));
  return pts.every(Boolean) ? pts : null;
}

function setSpurPts(doc, id, pts) {
  const ids = SITE_SPUR[id];
  const nodes = doc.amr.route.nodes.map((n) => {
    const i = ids.indexOf(n.id);
    return i < 0 ? n : { ...n, x: pts[i].x, z: pts[i].z };
  });
  return { ...doc, amr: { ...doc.amr, route: { ...doc.amr.route, nodes } } };
}

export function translateSpur(doc, id, dx, dz) {
  const pts = spurPts(doc, id);
  if (!pts || (!dx && !dz)) return doc;
  return setSpurPts(doc, id, pts.map((p) => ({ x: p.x + dx, z: p.z + dz })));
}

export function moveSpurEnd(doc, id, end, x, z) {
  const pts = spurPts(doc, id);
  if (!pts || end < 0 || end > 1) return doc;
  const next = pts.map((p) => ({ x: p.x, z: p.z }));
  next[end] = { x, z };
  return setSpurPts(doc, id, next);
}

export function rotateSpur(doc, id, deg) {
  const pts = spurPts(doc, id);
  if (!pts || !deg) return doc;
  const cx = (pts[0].x + pts[1].x) / 2, cz = (pts[0].z + pts[1].z) / 2;
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return setSpurPts(doc, id, pts.map((p) => {
    const dx = p.x - cx, dz = p.z - cz;
    return { x: cx + dx * c + dz * s, z: cz - dx * s + dz * c };
  }));
}

export function itemPose(doc, id) {
  return doc.cells?.[id] ?? doc.sites?.[id] ?? null;
}

export function placeItem(doc, id, pose) {
  if (!itemPose(doc, id)) return doc;
  return doc.cells?.[id]
    ? { ...doc, cells: { ...doc.cells, [id]: pose } }
    : { ...doc, sites: { ...doc.sites, [id]: pose } };
}

export function moveItem(doc, id, pose) {
  const next = normalizeLayout(placeItem(doc, id, pose));
  const errors = validateLayout(next);
  return { ok: errors.length === 0, errors, doc: next };
}

export function layoutStamp(doc) {
  return JSON.stringify({ rev: doc.rev ?? null, cells: doc.cells, sites: doc.sites ?? null, amr: doc.amr ?? null, parts: doc.parts ?? null });
}

// 셀·자리 pose(셀이 먼저). 부품 도크 id 「셀:라인」은 그 셀 pose(지점은 셀 로컬).
export const placeOf = (doc, id) => doc.cells[id] ?? doc.sites?.[id] ?? doc.cells[String(id).split(':')[0]] ?? null;

// 부품 AMR 루트를 ACS 가 읽는 모양으로: amr 자리에 parts 를 둔 레이아웃 보기. SORT 레인은 도어트림 루트의 것을 같이 쓴다
// (같은 칸·같은 잠금 — 레인 칸을 한쪽만 고치면 두 플릿이 다른 자리에 선다).
export const partsLayout = (doc) => ({
  ...doc,
  amr: doc.amr?.cells?.SORT ? { ...doc.parts, cells: { ...doc.parts.cells, SORT: doc.amr.cells.SORT } } : doc.parts,
});

// 셀 로컬 ↔ 필드 좌표. three Object3D rotation.y = rotY(도) 와 같은 회전.
export function toWorld(pose, p) {
  const t = (pose.rotY * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return { x: pose.x + p.x * c + p.z * s, z: pose.z - p.x * s + p.z * c };
}

export function toLocal(pose, p) {
  const t = (pose.rotY * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = p.x - pose.x, dz = p.z - pose.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
