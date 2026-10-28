// 공장 시뮬 이어가기. DOM 없음. 시각·시나리오만 두고, 다시 켤 때 같은 스텝을 재생한다(결정론).
// 엔티티·관절을 통째로 직렬화하지 않는다. 레이아웃·공정이 바뀌면 복원하지 않는다.
import { MAX_STEP, SPEEDS } from '../core/env.js';

export const PLANT_VERSION = 1;
export const LOCAL_KEY = 'microsim.plant/1';

export function fingerprint(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

export function dumpPlant(state, extra = {}) {
  return {
    v: PLANT_VERSION,
    t: Number(state.time.toFixed(3)),
    scenario: state.scenario ?? null,
    running: !!state.running,
    speed: state.speed,
    amr: extra.amr ?? null,
    drones: extra.drones ?? null,
    inspect: extra.inspect ?? null,
    process: extra.process !== false,
    layoutFp: extra.layoutFp ?? null,
    processFp: extra.processFp ?? null,
    incidents: state.incidents?.dump() ?? [],
  };
}

export function validatePlant(raw) {
  if (raw == null) return { ok: false, errors: ['없음'], doc: null };
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['객체가 아님'], doc: null };
  const errors = [];
  if (raw.v !== PLANT_VERSION) errors.push('v는 1');
  if (!(typeof raw.t === 'number' && Number.isFinite(raw.t) && raw.t >= 0)) errors.push('t는 0 이상');
  if (!(raw.scenario === null || typeof raw.scenario === 'string')) errors.push('scenario는 문자열 또는 null');
  if (typeof raw.running !== 'boolean') errors.push('running은 boolean');
  if (!SPEEDS.includes(raw.speed)) errors.push(`speed는 ${SPEEDS.join('·')}`);
  if (raw.amr != null && !(Number.isInteger(raw.amr) && raw.amr >= 0 && raw.amr <= 10)) errors.push('amr은 0~10 또는 null');
  if (raw.drones != null && !(Number.isInteger(raw.drones) && raw.drones >= 0 && raw.drones <= 3)) errors.push('drones는 0~3 또는 null');
  if (raw.inspect != null && typeof raw.inspect !== 'boolean') errors.push('inspect는 boolean 또는 null');
  if (typeof raw.process !== 'boolean') errors.push('process는 boolean');
  if (raw.layoutFp != null && typeof raw.layoutFp !== 'string') errors.push('layoutFp는 문자열');
  if (raw.processFp != null && typeof raw.processFp !== 'string') errors.push('processFp는 문자열');
  if (raw.incidents != null && !Array.isArray(raw.incidents)) errors.push('incidents는 배열');
  if (errors.length) return { ok: false, errors, doc: null };
  return {
    ok: true,
    errors: [],
    doc: {
      v: PLANT_VERSION,
      t: raw.t,
      scenario: raw.scenario,
      running: raw.running,
      speed: raw.speed,
      amr: raw.amr ?? null,
      drones: raw.drones ?? null,
      inspect: raw.inspect ?? null,
      process: raw.process,
      layoutFp: raw.layoutFp ?? null,
      processFp: raw.processFp ?? null,
      incidents: raw.incidents ?? [],
    },
  };
}

// ctx.skip: 점검 URL 이면 이유 문자열. ctx.scenario 가 있으면 그 시나리오만 받음.
export function restoreOk(doc, ctx = {}) {
  const v = validatePlant(doc);
  if (!v.ok) return { ok: false, why: v.errors[0], doc: null };
  if (ctx.skip) return { ok: false, why: ctx.skip, doc: null };
  if (v.doc.layoutFp && ctx.layoutFp && v.doc.layoutFp !== ctx.layoutFp) return { ok: false, why: '레이아웃이 바뀜', doc: null };
  if (v.doc.process !== !!ctx.process) return { ok: false, why: '공정 정의 유무가 다름', doc: null };
  if (v.doc.process && v.doc.processFp && ctx.processFp && v.doc.processFp !== ctx.processFp) return { ok: false, why: '공정 정의가 바뀜', doc: null };
  if (ctx.scenario !== undefined && v.doc.scenario !== ctx.scenario) return { ok: false, why: '시나리오가 다름', doc: null };
  return { ok: true, why: null, doc: v.doc };
}

export function pickPlant(a, b) {
  const A = validatePlant(a).doc, B = validatePlant(b).doc;
  if (!A) return B;
  if (!B) return A;
  return A.t >= B.t ? A : B;
}

export function readLocal(store) {
  if (!store?.getItem) return null;
  try { return validatePlant(JSON.parse(store.getItem(LOCAL_KEY) ?? 'null')).doc; }
  catch { return null; }
}

export function writeLocal(store, doc) {
  if (!store?.setItem) return false;
  const v = validatePlant(doc);
  if (!v.ok) return false;
  store.setItem(LOCAL_KEY, JSON.stringify(v.doc));
  return true;
}

export function clearLocal(store) {
  if (!store?.removeItem) return;
  store.removeItem(LOCAL_KEY);
}

// 같은 시드(레이아웃·공정·시나리오)에서 t 초까지 스텝. quiet 로 로그를 남기지 않는다.
// incidents: 저장된 운영자 주입 — 시각이 찍혀 있어 재생 중 같은 시각에 켜진다.
export function restoreTime(state, t, incidents = null) {
  if (incidents && state.incidents) state.incidents.load(incidents);
  const steps = Math.round(Number(t) / MAX_STEP);
  if (steps <= 0) return 0;
  const was = state.quiet;
  state.quiet = true;
  for (let i = 0; i < steps; i++) state.step(MAX_STEP);
  state.quiet = was;
  state.events = [];
  return steps;
}
