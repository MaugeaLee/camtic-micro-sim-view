// OpenAPI 스펙이 cfg 경로를 따르고 디스크 경로를 넣지 않는지.
import { readConfig, mergeConfig, VERSION } from '../server/env.mjs';
import { buildOpenApi } from '../server/openapi.mjs';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('openapi');

const def = buildOpenApi(readConfig({}));
check('OpenAPI 3', def.openapi.startsWith('3.'));
check('기본 경로', !!(def.paths['/api/status'] && def.paths['/api/docs'] && def.paths['/api/openapi.json'] && def.paths['/api/asset-viewer'] && def.paths['/api/layout'] && def.paths['/api/plant']));
check('에셋 파일 경로', !!def.paths['/assets/{file}']);
check('상대 서버', def.servers?.[0]?.url === '/');
const writes = Object.entries(def.paths).filter(([, item]) => Object.keys(item).some((m) => m !== 'get'));
check('쓰기는 layout PUT · plant PUT/DELETE', writes.length === 2
  && writes.some(([p, i]) => p === '/api/layout' && i.put)
  && writes.some(([p, i]) => p === '/api/plant' && i.put && i.delete));

const cfg = mergeConfig({
  name: 'alt', assetUrl: '/models/', assetDir: 'secret/disk',
  api: { status: '/v1/health', assets: '/v1/files', config: '/v1/cfg', assetViewer: '/v1/view', docs: '/v1/docs', openapi: '/v1/openapi.json' },
});
const spec = buildOpenApi(cfg);
const raw = JSON.stringify(spec);
check('커스텀 경로', !!(spec.paths['/v1/health'] && spec.paths['/v1/docs'] && spec.paths['/v1/openapi.json'] && spec.paths['/models/{file}']));
check('기본 경로 없음', !spec.paths['/api/status'] && !spec.paths['/assets/{file}']);
check('디스크 경로 없음', !raw.includes('secret/disk') && !raw.includes('assetDir'));
check('제목이 APP_NAME', spec.info.title === 'alt');
check('버전은 package.json', def.info.version === VERSION);
check('버전 오버라이드', buildOpenApi(mergeConfig({ version: '9.9.9' })).info.version === '9.9.9');

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
