// 바퀴·롤러·레일 추정. three 없이 합성 점군.
import { inferWheels, inferRollers, inferTrack, inferGantry, isDockedJig, classifyMover, pointOnTrack } from '../js/assets/movers.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const near = (a, b, e = 1e-5) => Math.abs(a - b) <= e;

const AX = { x: [0, 1, 2], y: [1, 2, 0], z: [2, 0, 1] };
function cyl([cx, cy, cz], ax, r, len, seg = 24) {
  const [a, u, w] = AX[ax], out = [];
  for (const h of [-len / 2, len / 2]) {
    for (let i = 0; i < seg; i++) {
      const p = [cx, cy, cz], t = (i / seg) * Math.PI * 2;
      p[a] += h; p[u] += Math.cos(t) * r; p[w] += Math.sin(t) * r;
      out.push(...p);
    }
  }
  return out;
}
function box(min, max) {
  const out = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push(x, y, z);
  return out;
}

console.log('movers');
const amr = [
  { name: 'Base', points: box([-0.4, 0.08, -0.35], [0.4, 0.28, 0.35]) },
  { name: 'Cover', points: box([-0.35, 0.28, -0.3], [0.35, 0.4, 0.3]) },
];
for (const [x, z] of [[-0.28, -0.22], [0.28, -0.22], [-0.28, 0.22], [0.28, 0.22]]) {
  amr.push({ name: `Wheel${x}${z}`, points: cyl([x, 0.07, z], 'x', 0.07, 0.05) });
}
const w = inferWheels(amr);
check('AMR 바퀴 4', w && w.kind === 'amr' && w.wheels.length === 4);
check('AMR 진행은 바퀴축에 수직', w && near(Math.abs(w.forward[2]), 1));

const bed = [{ name: 'Frame', points: box([-0.5, 0, -1], [0.5, 0.2, 1]) }];
for (let i = 0; i < 6; i++) bed.push({ name: `Roller${i}`, points: cyl([0, 0.25, -0.9 + i * 0.3], 'x', 0.04, 0.9) });
const roll = inferRollers(bed);
check('롤러 6', roll && roll.kind === 'rollers' && roll.rollers.length === 6);
check('롤러 축 X', roll && near(Math.abs(roll.axis[0]), 1));

const rail = [
  { name: 'GuideA', points: box([-2, 0.4, -0.12], [2, 0.5, -0.08]) },
  { name: 'GuideB', points: box([-2, 0.4, 0.08], [2, 0.5, 0.12]) },
  { name: 'Foot', points: box([-2, 0, -0.2], [-1.8, 0.4, 0.2]) },
];
const tr = inferTrack(rail);
check('레일', tr && tr.kind === 'track' && tr.amp > 0);
check('레일 축 X', tr && near(Math.abs(tr.axis[0]), 1));
check('레일 위 점', pointOnTrack([0, 0.45, 0], tr).on);
check('레일 밖 점', !pointOnTrack([0, 0.45, 3], tr).on);
const pathSeg = [];
for (let i = 0; i < 6; i++) pathSeg.push({ name: `Seg${i}`, points: box([-2 + i * 0.7, 0, -0.04], [-1.4 + i * 0.7, 0.02, 0.04]) });
check('경로 조각은 레일 아님', !inferTrack(pathSeg));

const pads = [{ name: 'Plate', points: box([-0.3, 0.5, -0.3], [0.3, 0.55, 0.3]) }];
for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
  pads.push({ name: 'Pad', points: cyl([x, 0.46, z], 'y', 0.03, 0.08) });
}
check('세로 패드는 AMR 아님', !inferWheels(pads));

const arm = [
  { name: 'Base', points: box([-0.3, 0, -0.3], [0.3, 0.05, 0.3]) },
  { name: 'Turret', points: cyl([0, 0.07, 0], 'y', 0.2, 0.04) },
  { name: 'Shoulder', points: cyl([0, 0.2, 0], 'x', 0.1, 0.18) },
  { name: 'UpperArm', points: box([-0.06, 0.2, -0.05], [0.06, 0.8, 0.05]) },
  { name: 'Elbow', points: cyl([0, 0.8, 0], 'x', 0.08, 0.14) },
  { name: 'Forearm', points: box([-0.04, 0.76, 0], [0.04, 0.84, 0.6]) },
  { name: 'Tool', points: cyl([0, 0.75, 0.6], 'y', 0.05, 0.02) },
];
function gantryParts({ spanX = 1.8, spanZ = 3.0 } = {}) {
  const hx = spanX / 2, hz = spanZ / 2;
  const posts = [[-hx, 0, -hz], [hx, 0, -hz], [-hx, 0, hz], [hx, 0, hz]];
  const parts = [];
  for (const [x, , z] of posts) {
    parts.push({ name: 'Post', points: box([x - 0.04, 0, z - 0.04], [x + 0.04, 1.3, z + 0.04]) });
    parts.push({ name: 'Foot', points: box([x - 0.1, 0, z - 0.1], [x + 0.1, 0.03, z + 0.1]) });
  }
  parts.push({ name: 'SideA', points: box([-hx - 0.04, 1.25, -hz], [-hx + 0.04, 1.35, hz]) });
  parts.push({ name: 'SideB', points: box([hx - 0.04, 1.25, -hz], [hx + 0.04, 1.35, hz]) });
  parts.push({ name: 'EndA', points: box([-hx, 1.25, -hz - 0.04], [hx, 1.35, -hz + 0.04]) });
  parts.push({ name: 'EndB', points: box([-hx, 1.25, hz - 0.04], [hx, 1.35, hz + 0.04]) });
  parts.push({ name: 'Cross', points: box([-hx, 1.38, -0.09], [hx, 1.48, 0.09]) });
  parts.push({ name: 'ZCol', points: box([-0.09, 1.35, -0.09], [0.09, 1.8, 0.09]) });
  parts.push({ name: 'Plate', points: box([-0.24, 1.28, -0.19], [0.24, 1.34, 0.19]) });
  for (const [x, z] of [[-0.12, -0.1], [0.12, -0.1], [-0.12, 0.1], [0.12, 0.1]]) {
    parts.push({ name: 'Pad', points: box([x - 0.04, 1.22, z - 0.04], [x + 0.04, 1.28, z + 0.04]) });
  }
  return parts;
}

const gantry = gantryParts();
const g = inferGantry(gantry);
check('직교 문형', g && g.kind === 'gantry' && g.tool.length >= 1 && g.lift.length > g.tool.length);
check('직교는 사이드 레일(긴 변)', g && near(Math.abs(g.horiz[2]), 1));
check('캐리지에 크로스 포함', g && g.lift.some((x) => x.name === 'Cross'));
check('크로스는 수직축 아님', g && !g.tool.some((x) => x.name === 'Cross'));
check('직교 진폭', g && g.ampX > 0 && g.ampZ > 0);
const gantryLongX = inferGantry(gantryParts({ spanX: 3.1, spanZ: 1.6 }));
check('긴 레일이 X면 X 슬라이드', gantryLongX && near(Math.abs(gantryLongX.horiz[0]), 1));
check('레일은 직교 아님', !inferGantry(rail));
check('직교는 레일보다 먼저', classifyMover(gantry).kind === 'gantry');

check('팔은 arm', classifyMover(arm).kind === 'arm');
const jigAmr = [
  ...amr,
  { name: 'Deck', points: box([-1.1, 0.55, -0.5], [1.1, 0.65, 0.5]) },
];
for (const [x, z] of [[-0.9, -0.35], [0.9, -0.35], [-0.9, 0.35], [0.9, 0.35]]) {
  jigAmr.push({ name: 'Leg', points: box([x - 0.05, 0.28, z - 0.05], [x + 0.05, 0.55, z + 0.05]) });
}
check('지그 상판+다리는 도킹', isDockedJig(jigAmr, inferWheels(jigAmr).wheels));
check('도킹 지그는 이동 AMR 아님', classifyMover(jigAmr).kind === 'none');
check('공급 AMR은 그대로', classifyMover(amr).kind === 'amr');

check('AMR 분류', classifyMover(amr).kind === 'amr');
check('롤러 분류', classifyMover(bed).kind === 'rollers');
check('레일 분류', classifyMover(rail).kind === 'track');
check('빈 그룹', classifyMover(arm.slice(0, 1)).kind === 'none');

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
