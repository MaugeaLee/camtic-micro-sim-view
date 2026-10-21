// OpenAPI 스펙이 cfg 경로를 따르고 디스크 경로를 넣지 않는지.
import { readConfig } from '../server/env.mjs';
import { buildOpenApi } from '../server/openapi.mjs';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('openapi');

const def = buildOpenApi(readConfig({}));
check('OpenAPI 3', def.openapi.startsWith('3.'));
check('기본 경로', !!(def.paths['/api/status'] && def.paths['/api/docs'] && def.paths['/api/openapi.json'] && def.paths['/api/asset-viewer']));
check('에셋 파일 경로', !!def.paths['/assets/{file}']);
check('상대 서버', def.servers?.[0]?.url === '/');
check('연산은 GET만', Object.values(def.paths).every((item) => Object.keys(item).every((m) => m === 'get')));

const cfg = readConfig({
  APP_NAME: 'alt', ASSET_URL: 'models', ASSET_DIR: 'secret/disk',
  API_STATUS: 'v1/health', API_ASSETS: 'v1/files', API_CONFIG: 'v1/cfg',
  API_ASSET_VIEWER: 'v1/view', API_DOCS: 'v1/docs', API_OPENAPI: 'v1/openapi.json',
});
const spec = buildOpenApi(cfg);
const raw = JSON.stringify(spec);
check('커스텀 경로', !!(spec.paths['/v1/health'] && spec.paths['/v1/docs'] && spec.paths['/v1/openapi.json'] && spec.paths['/models/{file}']));
check('기본 경로 없음', !spec.paths['/api/status'] && !spec.paths['/assets/{file}']);
check('디스크 경로 없음', !raw.includes('secret/disk') && !raw.includes('assetDir'));
check('제목이 APP_NAME', spec.info.title === 'alt');

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
