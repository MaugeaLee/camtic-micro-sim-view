// app-server: 화이트리스트, 경로 탈출, API 경로, index 주입.
import fs from 'node:fs';
import path from 'node:path';
import { startServer, listAssets, ROOT } from '../server/app-server.mjs';
import { defaultLayout } from '../js/sim/layout.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('server');
const { server, port, cfg } = await startServer({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${port}`;
const get = (p, init) => fetch(base + p, init);

try {
  const html = await (await get('/')).text();
  check('/ → index.html', html.includes('importmap'));
  check('index 에 __ENV 주입', html.includes('window.__ENV') && html.includes(`"port":${port}`));

  const js = await get('/js/main.js');
  check('js MIME', js.status === 200 && js.headers.get('content-type').startsWith('text/javascript'));
  check('vendor three 서빙', (await get('/vendor/three/three.module.js')).status === 200);

  const st = await (await get(cfg.api.status)).json();
  check('status', st.name === cfg.name && Array.isArray(st.assets) && st.env.api.status === cfg.api.status);

  const assets = await (await get(cfg.api.assets)).json();
  check('assets = 디스크 목록', JSON.stringify(assets) === JSON.stringify(listAssets()), assets.map((a) => a.key).join(','));

  const conf = await (await get(cfg.api.config)).json();
  check('config 공개 필드', conf.host && conf.assetUrl && conf.version && !('assetDir' in conf));

  if (assets.length) {
    const glb = await get(`${cfg.assetUrl}${encodeURIComponent(assets[0].file)}`, { method: 'HEAD' });
    check('glb MIME', glb.status === 200 && glb.headers.get('content-type') === 'model/gltf-binary');
  }

  check('경로 탈출 차단', (await get('/js/%2e%2e/server/app-server.mjs')).status === 404);
  check('화이트리스트 밖 404', (await get('/server.mjs')).status === 404 && (await get('/context/facts.json')).status === 404);
  check('API 쓰기 거부', (await get(cfg.api.status, { method: 'POST' })).status === 405);
  check('layout POST 거부', (await get(cfg.api.layout, { method: 'POST' })).status === 405);

  const lay = await (await get(cfg.api.layout)).json();
  check('layout GET', lay.version === 2 && lay.cells.PRESS && lay.cells.SCREW && lay.cells.SORT && lay.amr?.homes?.length > 0);
  const dl = await get(`${cfg.api.layout}?download=1`);
  check('layout 내려받기 헤더', dl.status === 200 && (dl.headers.get('content-disposition') || '').includes('layout.json'));
  check('없는 API 404', (await get(`${cfg.apiPrefix}/nope`)).status === 404);
  const proc = await (await get(cfg.api.process)).json();
  check('process GET (가정 표시 · PRESS 흐름)', proc.version === 1 && proc.assumed === true && proc.cells.PRESS.flow.length === 2);
  check('process 쓰기 거부', (await get(cfg.api.process, { method: 'PUT' })).status === 405);

  const av = await (await get(`${cfg.api.assetViewer}?format=json`)).json();
  check('asset-viewer 목록', av.count >= 3 && av.items.every((a) => a.three && a.url && a.format === 'glb'));
  const one = await (await get(`${cfg.api.assetViewer}?format=json&key=${av.items[0].key}`)).json();
  check('asset-viewer 단건', one.count === 1 && one.items[0].key === av.items[0].key);
  check('asset-viewer 없는 키', (await get(`${cfg.api.assetViewer}?format=json&key=__nope__`)).status === 404);
  const page = await get(`${cfg.api.assetViewer}?view=1&key=${av.items[0].key}`, { headers: { accept: 'text/html' } });
  const pageHtml = await page.text();
  check('asset-viewer 뷰포트 HTML', page.status === 200 && pageHtml.includes('preview.js') && pageHtml.includes('window.__ENV'));

  const spec = await (await get(cfg.api.openapi)).json();
  check('openapi 스펙', spec.openapi.startsWith('3.') && spec.paths[cfg.api.status] && spec.paths[cfg.api.docs]);
  const docs = await get(cfg.api.docs);
  const docsHtml = await docs.text();
  check('swagger UI', docs.status === 200 && docsHtml.includes('swagger.js') && docsHtml.includes('window.__ENV') && docsHtml.includes(`"port":${port}`));
  check('docs 쓰기 거부', (await get(cfg.api.docs, { method: 'POST' })).status === 405);
} finally {
  server.close();
}

const custom = await startServer({
  port: 0, host: '127.0.0.1', name: 'alt',
  assetUrl: '/models/', apiPrefix: '/v1',
  api: { status: '/v1/health', assets: '/v1/files', config: '/v1/cfg', docs: '/v1/docs', openapi: '/v1/openapi.json' },
});
try {
  const u = `http://127.0.0.1:${custom.port}`;
  const health = await (await fetch(`${u}/v1/health`)).json();
  check('커스텀 엔드포인트', health.name === 'alt' && (await fetch(`${u}/api/status`)).status === 404);
  const page = await (await fetch(`${u}/`)).text();
  check('주입된 경로가 커스텀', page.includes('/v1/health') && page.includes('/models/'));
  const spec = await (await fetch(`${u}/v1/openapi.json`)).json();
  check('커스텀 openapi', spec.paths['/v1/health'] && spec.paths['/models/{file}'] && !spec.paths['/api/status']);
  check('커스텀 swagger', (await fetch(`${u}/v1/docs`)).status === 200 && (await fetch(`${u}/api/docs`)).status === 404);
} finally {
  custom.server.close();
}

const rel = `tests/_tmp_layout_${process.pid}.json`;
const tmp = path.join(ROOT, rel);
const moved = await startServer({ port: 0, host: '127.0.0.1', layoutFile: rel });
try {
  const u = `http://127.0.0.1:${moved.port}`;
  const empty = await (await fetch(`${u}${moved.cfg.api.layout}`)).json();
  check('없는 파일은 기본 자리', empty.cells.PRESS.x === defaultLayout().cells.PRESS.x);
  const next = { ...defaultLayout(), cells: { ...defaultLayout().cells, PRESS: { x: 4, z: 6, rotY: 0 } } };
  next.amr = { ...next.amr, homes: next.amr.homes.slice(0, 5) };
  const put = await fetch(`${u}${moved.cfg.api.layout}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
  const saved = await put.json();
  check('layout PUT (셀 자리 + AMR 경로)', put.status === 200 && saved.cells.PRESS.z === 6 && saved.amr.homes.length === 5);
  const again = await (await fetch(`${u}${moved.cfg.api.layout}`)).json();
  check('PUT 후 GET', again.cells.PRESS.z === 6 && again.amr.homes.length === 5 && again.rev > 0);
  const bad = await fetch(`${u}${moved.cfg.api.layout}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"version":1}' });
  check('잘못된 PUT 거부', bad.status === 400);
} finally {
  moved.server.close();
  try { fs.unlinkSync(tmp); } catch { /* 없으면 무시 */ }
}

const locked = await startServer({ port: 0, host: '127.0.0.1', layoutFile: 'src/layout.default.json' });
try {
  const u = `http://127.0.0.1:${locked.port}`;
  const got = await (await fetch(`${u}${locked.cfg.api.layout}`)).json();
  check('기본 파일 GET', got.cells.SORT.x === defaultLayout().cells.SORT.x && JSON.stringify(got.amr) === JSON.stringify(defaultLayout().amr));
  const putDef = await fetch(`${u}${locked.cfg.api.layout}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(defaultLayout()),
  });
  check('기본 파일 PUT 거부', putDef.status === 400);
} finally {
  locked.server.close();
}

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
