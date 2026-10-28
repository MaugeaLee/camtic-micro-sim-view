// .env 파싱 · 환경변수가 파일보다 우선 · 공개 설정에 디스크 경로 없음.
import { parseEnv, loadEnv, readConfig, mergeConfig, publicConfig, VERSION } from '../server/env.mjs';
import { runtime, assetUrl, apiPath, processUrl, staticAssetUrl, staticProcessUrl } from '../js/core/runtime.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('env');

const parsed = parseEnv(`
# comment
HOST=0.0.0.0
PORT=9000
APP_NAME="cell view"
ASSET_URL=models
SKIP
=novalue
`);
check('주석·빈 줄 무시', parsed.SKIP === undefined && parsed.HOST === '0.0.0.0');
check('따옴표 제거', parsed.APP_NAME === 'cell view');

const tmp = path.join(os.tmpdir(), `microsim-env-${Date.now()}.env`);
fs.writeFileSync(tmp, 'HOST=10.0.0.1\nPORT=1\nALREADY=file\n');
const box = { ALREADY: 'env' };
loadEnv(tmp, box);
check('파일 로드', box.HOST === '10.0.0.1' && box.PORT === '1');
check('이미 있는 키는 유지', box.ALREADY === 'env');
fs.unlinkSync(tmp);

const cfg = readConfig({ HOST: '192.168.0.8', PORT: '8123', APP_NAME: 'x', ASSET_DIR: 'a/b', ASSET_URL: 'files', API_STATUS: '/v1/health', API_PREFIX: 'svc' });
check('에셋 URL 정규화', cfg.assetUrl === '/files/');
check('포트 숫자', cfg.port === 8123 && cfg.host === '192.168.0.8');
check('API는 env를 안 읽음', cfg.apiPrefix === '/api' && cfg.api.status === '/api/status' && cfg.api.docs === '/api/docs');

const pub = publicConfig(cfg);
check('공개 설정에 디스크 경로 없음', !('assetDir' in pub) && !('layoutFile' in pub) && !('plantFile' in pub) && pub.api.config === '/api/config' && pub.api.layout === '/api/layout' && pub.api.plant === '/api/plant');
check('버전은 package.json', cfg.version === VERSION && pub.version === VERSION && typeof VERSION === 'string' && VERSION.length > 0);

const merged = mergeConfig({ port: 0, api: { status: '/z' } }, { PORT: '9', API_STATUS: '/a' });
check('오버라이드가 env보다 우선', merged.port === 0 && merged.api.status === '/z' && merged.api.assets === '/api/assets');

check('브라우저 설정 없으면 API null', runtime() === null && assetUrl() === null && processUrl() === null && apiPath('status') === null);
check('정적 에셋 URL은 src/render_asset', /\/src\/render_asset\/$/.test(staticAssetUrl()));
check('정적 공정 JSON 파일', fs.existsSync(fileURLToPath(staticProcessUrl())));
const pagesRt = { assetUrl: '/assets', api: { process: '/api/process' } };
check('서버 주입이 정적 경로보다 우선', assetUrl(pagesRt) === '/assets/' && processUrl(pagesRt) === '/api/process');

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
