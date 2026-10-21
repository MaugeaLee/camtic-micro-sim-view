// Three.js가 읽을 수 있는 렌더 에셋 목록. DOM 없음.
import fs from 'node:fs';
import path from 'node:path';

export const THREE_MESH = Object.freeze({
  '.glb': { format: 'glb', mime: 'model/gltf-binary' },
  '.gltf': { format: 'gltf', mime: 'model/gltf+json' },
});

export function listRenderAssets(dir, assetUrl = '/assets/') {
  if (!dir || !fs.existsSync(dir)) return [];
  const base = assetUrl.endsWith('/') ? assetUrl : `${assetUrl}/`;
  return fs.readdirSync(dir)
    .map((file) => {
      const ext = path.extname(file).toLowerCase();
      const spec = THREE_MESH[ext];
      if (!spec) return null;
      const full = path.join(dir, file);
      if (!fs.statSync(full).isFile()) return null;
      return {
        key: file.slice(0, -ext.length),
        file,
        bytes: fs.statSync(full).size,
        format: spec.format,
        mime: spec.mime,
        url: `${base}${encodeURIComponent(file)}`,
        three: true,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function catalog(dir, assetUrl, key) {
  const items = listRenderAssets(dir, assetUrl);
  if (!key) return { count: items.length, items };
  const item = items.find((a) => a.key === key);
  if (!item) return { count: 0, key, items: [], error: 'not found' };
  return { count: 1, key, items: [item] };
}

// format=json 이면 항상 JSON. view=1 이면 HTML. 그외 Accept 가 text/html 이면 뷰포트.
export function wantsHtml(req, url) {
  const q = url.searchParams;
  if (q.get('format') === 'json') return false;
  if (q.get('view') === '0') return false;
  if (q.has('view')) return true;
  const accept = req.headers.accept || '';
  return accept.includes('text/html') && !accept.includes('application/json');
}
