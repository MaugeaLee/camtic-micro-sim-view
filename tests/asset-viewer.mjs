// Three.js 가 읽는 포맷만 목록에 넣고, HTML/JSON 협상을 가른다.
import { catalog, listRenderAssets, wantsHtml, THREE_MESH } from '../server/asset-viewer.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('asset-viewer');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-'));
fs.writeFileSync(path.join(dir, 'A.glb'), Buffer.from('glTF'));
fs.writeFileSync(path.join(dir, 'B.gltf'), '{}');
fs.writeFileSync(path.join(dir, 'skip.step'), 'ISO');
fs.writeFileSync(path.join(dir, 'note.txt'), 'x');

const items = listRenderAssets(dir, '/files');
check('glb·gltf만', items.map((i) => i.key).join() === 'A,B' && items.every((i) => i.three));
check('step 제외', !items.some((i) => i.file.endsWith('.step')));
check('url 인코딩', items[0].url === '/files/A.glb');
check('포맷 표', THREE_MESH['.glb'].format === 'glb');

const miss = catalog(dir, '/files/', 'NO');
check('없는 키', miss.error === 'not found' && miss.count === 0);

const req = (accept) => ({ headers: { accept } });
const u = (qs) => new URL(`http://127.0.0.1/x${qs}`);
check('view=1 → HTML', wantsHtml(req('*/*'), u('?view=1')));
check('format=json → JSON', !wantsHtml(req('text/html'), u('?format=json')));
check('브라우저 Accept → HTML', wantsHtml(req('text/html,application/xhtml+xml'), u('')));
check('fetch 기본 → JSON', !wantsHtml(req('*/*'), u('')));

fs.rmSync(dir, { recursive: true });
console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
