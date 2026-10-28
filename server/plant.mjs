// 공장 이어가기 JSON. 쓰는 파일은 PLANT_FILE. 디스크 경로는 응답에 넣지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.mjs';
import { resolveUnderRoot } from './layout.mjs';
import { validatePlant } from '../js/data/plant.js';

export function resolvePlantFile(cfg, root = ROOT) {
  return resolveUnderRoot(cfg.plantFile || 'data/plant.json', root);
}

export function loadPlant(cfg, root = ROOT) {
  const file = resolvePlantFile(cfg, root);
  if (!file || !fs.existsSync(file)) return { ok: false, errors: ['없음'] };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { ok: false, errors: ['JSON 파싱 실패'] }; }
  const v = validatePlant(raw);
  return v.ok ? { ok: true, doc: v.doc } : { ok: false, errors: v.errors };
}

export function savePlant(cfg, raw, root = ROOT) {
  const v = validatePlant(raw);
  if (!v.ok) return { ok: false, errors: v.errors };
  const file = resolvePlantFile(cfg, root);
  if (!file) return { ok: false, errors: ['공장 상태 경로 거부'] };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(v.doc, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return { ok: true, doc: v.doc };
}

export function clearPlant(cfg, root = ROOT) {
  const file = resolvePlantFile(cfg, root);
  if (!file) return { ok: false, errors: ['공장 상태 경로 거부'] };
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return { ok: true };
}
