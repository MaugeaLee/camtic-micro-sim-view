// 셀 바닥 자리. DOM 없음. 좌표는 필드 원점 기준, 1 = 1 m. rotY 는 도(0·90·180·270).
// 발자국은 GLB 바닥 AABB 가정(PRESS/SCREW ≈ 10.1×10.8 m, SORT ≈ 16.6×9.5 m). 실측 아님.
import { CELLS } from './cells.js';

// field-def.js FIELD.size 와 같아야 한다. sim은 render를 import 하지 않는다.
export const FIELD_SIZE = Object.freeze({ w: 48, d: 30 });

export const LAYOUT_VERSION = 1;
export const SNAP = 1;

export const FOOTPRINT = Object.freeze({
  PRESS: Object.freeze({ w: 10.1, d: 10.82 }),
  SCREW: Object.freeze({ w: 10.1, d: 10.82 }),
  SORT: Object.freeze({ w: 16.56, d: 9.45 }),
});

// 세 셀이 통로(+z)를 비우고 한 줄로 서게 한 가정 자리. 겹침 없음.
export const DEFAULT_POSES = Object.freeze({
  PRESS: Object.freeze({ x: -14, z: -2, rotY: 0 }),
  SCREW: Object.freeze({ x: 0, z: -2, rotY: 0 }),
  SORT: Object.freeze({ x: 14, z: -2, rotY: 0 }),
});

const IDS = CELLS.map((c) => c.id);
const ROTS = new Set([0, 90, 180, 270]);

export function defaultLayout() {
  return { version: LAYOUT_VERSION, snap: SNAP, cells: { ...DEFAULT_POSES } };
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
  if (raw.version !== LAYOUT_VERSION) errors.push(`version은 ${LAYOUT_VERSION}`);
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
  const doc = { version: LAYOUT_VERSION, snap, cells };
  if (raw?.rev != null) doc.rev = raw.rev;
  return doc;
}

export function canPlace(doc, id, pose, field = FIELD_SIZE) {
  if (!IDS.includes(id)) return [`없는 셀 ${id}`];
  if (!insideField(id, pose, field)) return [`${id}가 바닥 밖`];
  const errors = [];
  for (const other of IDS) {
    if (other === id) continue;
    if (overlaps(id, pose, other, doc.cells[other])) errors.push(`${id}·${other} 겹침`);
  }
  return errors;
}

export function moveCell(doc, id, pose) {
  const next = normalizeLayout({ ...doc, cells: { ...doc.cells, [id]: pose } });
  const errors = validateLayout(next);
  return { ok: errors.length === 0, errors, doc: next };
}

export function layoutStamp(doc) {
  return JSON.stringify({ rev: doc.rev ?? null, cells: doc.cells });
}
