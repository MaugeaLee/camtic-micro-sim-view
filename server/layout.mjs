// 레이아웃 JSON. 쓰는 파일은 LAYOUT_FILE, 없을 때만 기본 파일을 읽는다. 디스크 경로는 응답에 넣지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.mjs';
import { defaultLayout, normalizeLayout, validateLayout } from '../js/sim/layout.js';

export const DEFAULT_LAYOUT_FILE = 'src/layout.default.json';

export function resolveUnderRoot(rel, root = ROOT) {
  const file = path.resolve(root, rel || '');
  const base = path.resolve(root);
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  return file;
}

export function resolveLayoutFile(cfg, root = ROOT) {
  return resolveUnderRoot(cfg.layoutFile || 'data/layout.json', root);
}

export function resolveDefaultLayoutFile(root = ROOT) {
  return resolveUnderRoot(DEFAULT_LAYOUT_FILE, root);
}

function readValid(file, source) {
  if (!file || !fs.existsSync(file)) return null;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
  if (validateLayout(raw).length) return null;
  const doc = normalizeLayout(raw);
  doc.rev = fs.statSync(file).mtimeMs;
  return { ok: true, doc, source };
}

export function loadLayout(cfg, root = ROOT) {
  return readValid(resolveLayoutFile(cfg, root), 'file')
    ?? readValid(resolveDefaultLayoutFile(root), 'default')
    ?? { ok: true, doc: defaultLayout(), source: 'builtin' };
}

export function saveLayout(cfg, raw, root = ROOT) {
  const errors = validateLayout(raw);
  if (errors.length) return { ok: false, errors };
  const file = resolveLayoutFile(cfg, root);
  if (!file) return { ok: false, errors: ['레이아웃 경로 거부'] };
  const fallback = resolveDefaultLayoutFile(root);
  if (fallback && path.resolve(file) === path.resolve(fallback)) return { ok: false, errors: ['기본 레이아웃은 덮지 않음'] };
  const doc = normalizeLayout(raw);
  delete doc.rev;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  fs.renameSync(tmp, file);
  doc.rev = fs.statSync(file).mtimeMs;
  return { ok: true, doc, source: 'file' };
}
