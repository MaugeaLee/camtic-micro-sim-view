// 정적 파일 + API. 시뮬은 돌리지 않는다 — 상태는 브라우저가 가진다. 쓰기는 /api/layout PUT(루프백)만.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ROOT, mergeConfig, publicConfig, resolveAssetDir } from './env.mjs';
import { catalog, wantsHtml } from './asset-viewer.mjs';
import { buildOpenApi } from './openapi.mjs';
import { loadLayout, saveLayout } from './layout.mjs';
import { loadProcess } from './process.mjs';

export { ROOT };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
};

const ENV_MARK = '/*__ENV__*/';

export function listAssets(dir) {
  const root = dir ?? resolveAssetDir(mergeConfig());
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((f) => f.toLowerCase().endsWith('.glb'))
    .map((f) => ({ key: f.slice(0, -4), file: f, bytes: fs.statSync(path.join(root, f)).size }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function resolvePublic(urlPath, cfg) {
  const assetDir = resolveAssetDir(cfg);
  const map = [
    ['/css/', path.join(ROOT, 'css')],
    ['/js/', path.join(ROOT, 'js')],
    ['/vendor/', path.join(ROOT, 'vendor')],
    [cfg.assetUrl, assetDir],
  ];
  if (urlPath === '/' || urlPath === '/index.html') return path.join(ROOT, 'index.html');
  for (const [prefix, dir] of map) {
    if (!urlPath.startsWith(prefix)) continue;
    const rest = urlPath.slice(prefix.length);
    const file = path.resolve(dir, rest);
    return file.startsWith(dir + path.sep) ? file : null;
  }
  return null;
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const isApi = (p, cfg) => p === cfg.apiPrefix || p.startsWith(`${cfg.apiPrefix}/`);

function sendHtml(res, file, cfg) {
  let html = fs.readFileSync(file, 'utf8');
  const payload = `window.__ENV = ${JSON.stringify(publicConfig(cfg))};`;
  html = html.includes(ENV_MARK) ? html.replace(ENV_MARK, payload) : `${html.replace('</head>', `<script>${payload}</script></head>`)}`;
  res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
  res.end(html);
}

export function createHandler(cfg) {
  const assetDir = resolveAssetDir(cfg);
  return (req, res) => {
    const url = new URL(req.url, `http://${cfg.host}`);
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'bad path' }); }

    if (isApi(p, cfg)) {
      if (p === cfg.api.layout) return layoutApi(req, res, url, cfg);
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
      if (p === cfg.api.status) {
        return json(res, 200, { name: cfg.name, time: new Date().toISOString(), assets: listAssets(assetDir).map((a) => a.key), env: publicConfig(cfg) });
      }
      if (p === cfg.api.assets) return json(res, 200, listAssets(assetDir));
      if (p === cfg.api.config) return json(res, 200, publicConfig(cfg));
      if (p === cfg.api.process) {
        const loaded = loadProcess();
        return loaded.ok ? json(res, 200, loaded.doc) : json(res, 500, { error: loaded.errors.join(' · ') });
      }
      if (p === cfg.api.assetViewer) {
        const key = url.searchParams.get('key');
        const body = catalog(assetDir, cfg.assetUrl, key);
        if (key && body.error) return json(res, 404, body);
        if (wantsHtml(req, url)) return sendHtml(res, path.join(ROOT, 'js', 'assets', 'preview.html'), cfg);
        return json(res, 200, body);
      }
      if (p === cfg.api.docs) return sendHtml(res, path.join(ROOT, 'js', 'assets', 'swagger.html'), cfg);
      if (p === cfg.api.openapi) return json(res, 200, buildOpenApi(cfg));
      return json(res, 404, { error: 'not found' });
    }

    const file = resolvePublic(p, cfg);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end('not found');
    }
    if (path.basename(file) === 'index.html') return sendHtml(res, file, cfg);
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  };
}

function isLoopback(req) {
  const a = req.socket.remoteAddress;
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) {
        req.destroy();
        reject(new Error('too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function layoutApi(req, res, url, cfg) {
  if (req.method === 'GET') {
    const loaded = loadLayout(cfg);
    if (!loaded.ok) return json(res, 500, { error: loaded.errors.join(' · ') });
    const headers = { 'content-type': MIME['.json'], 'cache-control': 'no-store' };
    if (url.searchParams.get('download') === '1') headers['content-disposition'] = 'attachment; filename="layout.json"';
    res.writeHead(200, headers);
    return res.end(JSON.stringify(loaded.doc));
  }
  if (req.method === 'PUT') {
    if (!isLoopback(req)) return json(res, 403, { error: 'local only' });
    let text;
    try { text = await readBody(req); }
    catch { return json(res, 413, { error: 'too large' }); }
    let raw;
    try { raw = JSON.parse(text); }
    catch { return json(res, 400, { error: 'JSON 파싱 실패' }); }
    const saved = saveLayout(cfg, raw);
    if (!saved.ok) return json(res, 400, { error: saved.errors.join(' · ') });
    return json(res, 200, saved.doc);
  }
  return json(res, 405, { error: 'method not allowed' });
}

export function startServer(overrides = {}) {
  const cfg = mergeConfig(overrides);
  const server = http.createServer(createHandler(cfg));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, () => {
      const addr = server.address();
      cfg.port = addr.port;
      resolve({ server, port: addr.port, host: addr.address, cfg });
    });
  });
}
