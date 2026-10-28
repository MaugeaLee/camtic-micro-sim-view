// 온보드 가상 카메라 자세. DOM·three 없음.
// 산업 로봇(손목) · AMR 전방 · 견마 머리 · 드론 짐벌. 클릭해 Detail 에 포커스되면 이 시점을 라이브로 그린다.
// 좌표는 필드(m, Y-up). 영상·녹화·감지는 없다 — 같은 씬을 다시 그리는 가정 카메라다.
import { fk } from './kin.js';
import { placeOf, toWorld } from './layout.js';

export const LIVE = Object.freeze({
  amr: Object.freeze({ y: 0.48, z: 0.58, look: 6.5, lookY: 0.28, fov: 72 }),
  fork: Object.freeze({ y: 1.56, z: -0.18, look: 2.6, lookY: 0.32, fov: 70 }),
  hound: Object.freeze({ y: 0.44, z: 0.30, look: 4.6, lookY: 0.28, fov: 68 }),
  drone: Object.freeze({ drop: 0.08, fov: 78 }),
  arm: Object.freeze({ back: 0.10, ahead: 0.85, fov: 62 }),
});

export const LIVE_KINDS = Object.freeze(['arm', 'amr', 'hound', 'drone']);

const rotY = (p, w) => {
  const c = Math.cos(w), s = Math.sin(w);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
};

function worldPoint(pose, p) {
  const w = toWorld(pose, { x: p[0], z: p[2] });
  return [w.x, p[1], w.z];
}

function headingOf(h) {
  return { x: Math.sin(h), z: Math.cos(h) };
}

export function vehicleCam(x, z, heading, spec, fov = spec.fov) {
  const d = headingOf(heading);
  return {
    eye: [x + d.x * spec.z, spec.y, z + d.z * spec.z],
    look: [x + d.x * spec.look, spec.lookY, z + d.z * spec.look],
    fov,
  };
}

// tcp·approach 는 셀 로컬. approach = 공구가 작업물을 향하는 방향(손목 캠이 보는 쪽).
export function wristCam(tcp, approach, pose, spec = LIVE.arm) {
  const a = approach && Math.hypot(...approach) > 1e-6 ? approach : [0, -1, 0];
  const n = Math.hypot(...a) || 1;
  const u = [a[0] / n, a[1] / n, a[2] / n];
  const eyeL = [tcp[0] - u[0] * spec.back, tcp[1] - u[1] * spec.back, tcp[2] - u[2] * spec.back];
  const lookL = [tcp[0] + u[0] * spec.ahead, tcp[1] + u[1] * spec.ahead, tcp[2] + u[2] * spec.ahead];
  return {
    eye: worldPoint(pose, eyeL),
    look: worldPoint(pose, lookL),
    fov: spec.fov,
  };
}

export function droneCam(d) {
  const flying = (d.y ?? 0) > 0.3;
  const h = headingOf(d.heading ?? 0);
  if (!flying) {
    return { eye: [d.x, 0.22, d.z], look: [d.x + h.x * 5, 0.35, d.z + h.z * 5], fov: LIVE.drone.fov };
  }
  const y = Math.max(0.4, (d.y ?? 0) - LIVE.drone.drop);
  const eye = [d.x, y, d.z];
  if (Number.isFinite(d.job?.x) && Number.isFinite(d.job?.z)) {
    return { eye, look: [d.job.x, 0.45, d.job.z], fov: LIVE.drone.fov };
  }
  const pitch = d.scanning ? 1.05 : 0.48;
  const dist = Math.max(1.4, y / Math.max(0.2, Math.tan(pitch)));
  const k = d.scanning ? 0.28 : 0.85;
  return { eye, look: [d.x + h.x * dist * k, 0.12, d.z + h.z * dist * k], fov: LIVE.drone.fov };
}

function armWork(state, part) {
  return state.plant?.siteWork?.(part.cell) ?? state.plant?.work?.[part.cell] ?? null;
}

function armOf(cw, name) {
  if (!cw?.robots) return null;
  const list = Array.isArray(cw.robots) ? cw.robots : Object.values(cw.robots);
  return list.find((r) => r.name === name) ?? null;
}

function armApproach(r, cw) {
  let a = [0, -1, 0];
  if (r.ch && (r.pose?.q || r.ready?.q)) {
    const q = r.pose?.q ?? r.ready.q;
    const s = r.pose?.s ?? r.ready?.s ?? 0;
    a = fk(r.ch, q, s).a;
  }
  const w = cw.car?.w;
  return Number.isFinite(w) && w ? rotY(a, w) : a;
}

function armPose(state, part) {
  const cw = armWork(state, part);
  const r = armOf(cw, part.name);
  if (!r) return null;
  let tcp = r.tcp;
  if (!tcp && r.ch && (r.pose?.q || r.ready?.q)) {
    const q = r.pose?.q ?? r.ready.q;
    const s = r.pose?.s ?? r.ready?.s ?? 0;
    tcp = fk(r.ch, q, s).p;
  }
  if (!tcp) return null;
  const cell = placeOf(state.plant.layout, part.cell);
  if (!cell) return null;
  return { ...wristCam(tcp, armApproach(r, cw), cell), kind: 'arm', name: '로봇 캠' };
}

function houndHeading(r) {
  let h = r.heading ?? 0;
  const sweep = r.mode === 'goto' || r.mode === 'nudge' || r.scanning;
  if (sweep && r.gait != null) h += Math.sin(r.gait * 2.5) * 0.4;
  return h;
}

export function liveKindOf(state, id) {
  if (!id) return null;
  const part = state.equipOf?.(id);
  if (part?.kind === 'arm' || part?.kind === 'body') return 'arm';
  if (state.amrs?.some((a) => a.id === id)) return 'amr';
  if (state.plant?.hound?.id === id) return 'hound';
  const r = state.plant?.robots?.find((x) => x.id === id);
  if (!r) return null;
  return r.role === 'process' || r.role === 'stock' ? 'drone' : 'hound';
}

// 포커스된 장비의 온보드 카메라. 없으면 null(셀·직교이송·리프트는 안 달림). 양팔 몸통은 첫째 팔 손목.
export function liveCamOf(state, id) {
  if (!id || !state?.plant) return null;
  const part = state.equipOf?.(id);
  if (part?.kind === 'arm' || part?.kind === 'body') {
    const cw = armWork(state, part);
    const arms = Array.isArray(cw?.robots) ? cw.robots : Object.values(cw?.robots ?? {});
    const name = part.kind === 'body' ? arms[0]?.name : part.name;
    const pose = name ? armPose(state, { cell: part.cell, name }) : null;
    return pose ? { id, ...pose } : null;
  }
  if (part) return null;
  const a = state.amrs.find((x) => x.id === id);
  if (a && !a.off) {
    const fork = a.id.startsWith('F-AMR');
    const spec = fork ? LIVE.fork : LIVE.amr;
    return { id, kind: 'amr', name: fork ? '포크 캠' : '전방 캠', ...vehicleCam(a.x, a.z, a.heading, spec) };
  }
  const hound = state.plant.hound?.view?.();
  if (hound && hound.id === id) return { id, kind: 'hound', name: '헤드 캠', ...vehicleCam(hound.x, hound.z, houndHeading(hound), LIVE.hound) };
  const r = state.plant.robots?.find((x) => x.id === id);
  if (!r) return null;
  if (r.role === 'process' || r.role === 'stock') return { id, kind: 'drone', name: '짐벌 캠', ...droneCam(r) };
  return { id, kind: 'hound', name: '헤드 캠', ...vehicleCam(r.x, r.z, houndHeading(r), LIVE.hound) };
}
