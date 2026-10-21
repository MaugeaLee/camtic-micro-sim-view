// GLB 검사: 헤더(magic·version·length)와 기본 씬 루트 노드 이름 = 셀 id.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readGlb, checkCellGlb } from '../server/glb.mjs';
import { CELLS } from '../js/sim/cells.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('glb');
const dir = fileURLToPath(new URL('../src/render_asset/', import.meta.url));
for (const c of CELLS) {
  const buf = await readFile(`${dir}${c.asset}.glb`);
  const r = checkCellGlb(buf, c.id);
  check(`${c.asset}.glb 헤더·루트 = ${c.id}`, r.ok, r.ok ? `roots=${r.roots.join(',')}` : r.errors.join(' · '));
}

const bad = new Uint8Array(24);
check('짧거나 magic 아닌 버퍼 거부', readGlb(new Uint8Array(8)).errors.length > 0 && readGlb(bad).errors.some((e) => e.includes('magic')));

const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }], nodes: [{ name: 'A' }, { name: 'B' }] }));
const pad = (4 - (json.length % 4)) % 4;
const glb = new Uint8Array(20 + json.length + pad);
const dv = new DataView(glb.buffer);
dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, glb.length, true);
dv.setUint32(12, json.length + pad, true); dv.setUint32(16, 0x4e4f534a, true);
glb.set(json, 20); glb.fill(0x20, 20 + json.length);
const two = checkCellGlb(glb, 'A');
check('루트 2개면 실패', !two.ok && two.errors[0].includes('2개'));

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
