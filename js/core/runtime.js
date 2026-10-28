// 서버가 index.html 에 넣은 공개 설정. DOM 없음 — window 없으면 null.
// Pages·file:// 는 __ENV 가 없다. 경로는 이 모듈 기준이라 프로젝트 Pages(/레포명/)에서도 맞다.
import { NO_SERVER } from './env.js';

export function runtime() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  const env = g.__ENV;
  return env && typeof env === 'object' ? env : null;
}

export function staticAssetUrl() {
  return new URL('../../src/render_asset/', import.meta.url).href;
}

export function staticProcessUrl() {
  return new URL('../../src/process.default.json', import.meta.url).href;
}

export function assetUrl(rt = runtime()) {
  const u = rt?.assetUrl;
  if (u) return u.endsWith('/') ? u : `${u}/`;
  return NO_SERVER ? staticAssetUrl() : null;
}

export function processUrl(rt = runtime()) {
  return rt?.api?.process ?? (NO_SERVER ? staticProcessUrl() : null);
}

export function apiPath(name, rt = runtime()) {
  return rt?.api?.[name] ?? null;
}
