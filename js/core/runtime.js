// 서버가 index.html 에 넣은 공개 설정. DOM 없음 — window 없으면 null.
export function runtime() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  const env = g.__ENV;
  return env && typeof env === 'object' ? env : null;
}

export function assetUrl(rt = runtime()) {
  const u = rt?.assetUrl;
  if (!u) return null;
  return u.endsWith('/') ? u : `${u}/`;
}

export function apiPath(name, rt = runtime()) {
  return rt?.api?.[name] ?? null;
}
