// PRESS 북쪽 레일을 남쪽(R6·R9·R10) 레일 행정에 맞추는지. GLB 파일은 바꾸지 않는다.
import { readFile } from 'node:fs/promises';
import { cellFrame, readGlb, writeGlb } from '../js/assets/glb.js';
import { cellRig, baseName } from '../js/assets/rigdata.js';
import { fitRails } from '../js/assets/rail-fit.js';
import { scanGlb } from '../js/assets/scan-glb.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const near = (a, b, e = 0.05) => Math.abs(a - b) <= e;
const tracksOf = (json, bin) => scanGlb(json, bin).filter((m) => m.kind === 'track');

console.log('rail-fit');
const pressBuf = await readFile(new URL('../src/render_asset/PRESS.glb', import.meta.url));
const screwBuf = await readFile(new URL('../src/render_asset/SCREW.glb', import.meta.url));

const raw = readGlb(pressBuf);
const rawTracks = tracksOf(raw.json, raw.bin);
check('원본 PRESS 레일 2개 · 남쪽이 더 김', rawTracks.length === 2 && rawTracks[0].plan.span > rawTracks[1].plan.span + 0.5,
  rawTracks.map((t) => `${t.name}:${t.plan.span.toFixed(2)}`).join(' '));

const fitted = readGlb(pressBuf);
check('fitRails 가 PRESS 를 바꿈', fitRails(fitted.json, fitted.bin));
check('두 번째 fit 은 그대로', !fitRails(fitted.json, fitted.bin));

const after = cellRig(fitted.json, fitted.bin);
const along = (t, p) => p[0] * t.axis[0] + p[1] * t.axis[1] + p[2] * t.axis[2];
const ext = (t) => [along(t, t.origin) - t.span, along(t, t.origin) + t.span];
const e0 = ext(after.tracks[0]), e1 = ext(after.tracks[1]);
check('맞춘 뒤 북쪽 레일 행정 = 남쪽', near(e1[0], e0[0]) && near(e1[1], e0[1]),
  `남 ${e0.map((v) => v.toFixed(2)).join('..')} · 북 ${e1.map((v) => v.toFixed(2)).join('..')}`);

const on = (n) => after.arms.find((a) => baseName(a.name) === n)?.track;
check('로봇 배정 유지 R6·R9·R10 남 · R7·R8 북', on('R6') === 0 && on('R9') === 0 && on('R10') === 0 && on('R7') === 1 && on('R8') === 1,
  `R6=${on('R6')} R7=${on('R7')} R8=${on('R8')} R9=${on('R9')} R10=${on('R10')}`);

const fp = cellFrame(fitted.json), rawFp = cellFrame(raw.json);
check('셀 프레임 크기 그대로', near(fp.size[0], rawFp.size[0], 0.01) && near(fp.size[2], rawFp.size[2], 0.01),
  `${fp.size.map((v) => v.toFixed(2)).join('×')} vs ${rawFp.size.map((v) => v.toFixed(2)).join('×')}`);

const packed = writeGlb(fitted.json, fitted.bin);
const back = readGlb(packed);
check('writeGlb 왕복 · extras.railFit', !back.errors?.length && back.json.extras?.railFit === true && back.bin?.length === fitted.bin.length);

const screw = readGlb(screwBuf);
const screwSpan = tracksOf(screw.json, screw.bin).map((t) => t.plan.span);
check('SCREW 레일은 이미 같아서 fit 안 함', !fitRails(screw.json, screw.bin));
const screwRig = cellRig(screw.json, screw.bin);
check('SCREW 레일 길이 그대로', screwRig.tracks.every((t, i) => near(t.span, screwSpan[i], 0.01)),
  screwRig.tracks.map((t) => t.span.toFixed(2)).join(' '));

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
