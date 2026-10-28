// .env 읽기. dotenv 패키지 없음. 이미 있는 process.env 는 덮지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILE = path.join(ROOT, '.env');

const KEY = /^[A-Z_][A-Z0-9_]*$/;

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    if (!KEY.test(key)) continue;
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

export function loadEnv(file = ENV_FILE, target = process.env) {
  if (!fs.existsSync(file)) return false;
  const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(parsed)) {
    if (target[k] === undefined || target[k] === '') target[k] = v;
  }
  return true;
}

const slash = (p, trail = false) => {
  let s = String(p ?? '').trim();
  if (!s.startsWith('/')) s = `/${s}`;
  if (trail) { if (!s.endsWith('/')) s += '/'; }
  else if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
};

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
export const VERSION = typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';

export const API_PREFIX = '/api';

export const API = Object.freeze({
  status: '/api/status',
  assets: '/api/assets',
  config: '/api/config',
  assetViewer: '/api/asset-viewer',
  docs: '/api/docs',
  openapi: '/api/openapi.json',
  layout: '/api/layout',
  process: '/api/process',
  bStatus: '/api/b/status',
  bStream: '/api/b/stream',
  bInspect: '/api/b/inspect',
  bFac: '/api/b/fac',
});

export const DASHBOARD = '/dashboard';

// 호스트·포트·에셋만 env. API 경로는 위 상수. 배포 값은 파일·환경변수가 우선.
export function readConfig(env = process.env) {
  const portRaw = env.PORT;
  const port = portRaw === undefined || portRaw === '' ? 8790 : Number(portRaw);
  return {
    host: env.HOST || '127.0.0.1',
    port: Number.isFinite(port) ? port : 8790,
    name: env.APP_NAME || 'micro-cell-viewer',
    version: VERSION,
    assetDir: env.ASSET_DIR || 'src/render_asset',
    assetUrl: slash(env.ASSET_URL || '/assets', true),
    layoutFile: env.LAYOUT_FILE || 'data/layout.json',
    apiPrefix: API_PREFIX,
    api: { ...API },
  };
}

export function mergeConfig(overrides = {}, env = process.env) {
  const base = readConfig(env);
  return { ...base, ...overrides, api: { ...base.api, ...(overrides.api || {}) } };
}

export function publicConfig(cfg) {
  return { name: cfg.name, version: cfg.version, host: cfg.host, port: cfg.port, assetUrl: cfg.assetUrl, api: { ...cfg.api } };
}

export function resolveAssetDir(cfg, root = ROOT) {
  return path.isAbsolute(cfg.assetDir) ? cfg.assetDir : path.join(root, cfg.assetDir);
}
