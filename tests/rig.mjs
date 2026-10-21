// 형상 기반 관절 추정. three 없이 합성 점군으로 판정.
import { eigSym3, roundAxis, inferRig, coaxial } from '../js/assets/rig.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

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

console.log('rig');
const e = eigSym3([[2, 1, 0], [1, 2, 0], [0, 0, 5]]);
check('고유값', [...e.values].sort((a, b) => a - b).every((v, i) => near(v, [1, 3, 5][i])));
const v3 = e.vectors[e.values.findIndex((v) => near(v, 3))];
check('고유벡터', near(Math.abs(v3[0]), Math.SQRT1_2) && near(Math.abs(v3[1]), Math.SQRT1_2));

const disc = roundAxis(cyl([0, 1, 0], 'y', 0.2, 0.03));
check('원판 축 Y', disc && near(disc.axis[1], 1, 1e-6));
const cap = roundAxis(cyl([0.3, 1, 0], 'x', 0.15, 0.2));
check('짧은 원통 축 X', cap && near(cap.axis[0], 1, 1e-6) && near(cap.center[0], 0.3));
check('긴 원통(롤러·링크)은 관절 아님', roundAxis(cyl([0, 0, 0], 'x', 0.03, 0.8)) === null);
check('정사각 판은 관절 아님', roundAxis(box([-0.2, 0, -0.2], [0.2, 0.03, 0.2])) === null);
check('정육면체는 관절 아님', roundAxis(box([0, 0, 0], [1, 1, 1])) === null);
check('동축', coaxial({ center: [0, 0, 0], axis: [0, 1, 0] }, { center: [0, 3, 0], axis: [0, 1, 0] }, 0.01));
check('평행이지만 다른 축', !coaxial({ center: [0, 0, 0], axis: [1, 0, 0] }, { center: [0, 0.5, 0], axis: [1, 0, 0] }, 0.01));

// 바닥판 → 선회 원판(Y) → 어깨 원통(X) → 위팔 → 팔꿈치 원통(X) → 아래팔 → 툴 원판(Y)
const arm = [
  { name: 'Base', points: box([-0.3, 0, -0.3], [0.3, 0.05, 0.3]) },
  { name: 'Turret', points: cyl([0, 0.07, 0], 'y', 0.2, 0.04) },
  { name: 'TurretRing', points: cyl([0, 0.1, 0], 'y', 0.18, 0.02) },
  { name: 'Shoulder', points: cyl([0, 0.2, 0], 'x', 0.1, 0.18) },
  { name: 'UpperArm', points: box([-0.06, 0.2, -0.05], [0.06, 0.8, 0.05]) },
  { name: 'Elbow', points: cyl([0, 0.8, 0], 'x', 0.08, 0.14) },
  { name: 'Forearm', points: box([-0.04, 0.76, 0], [0.04, 0.84, 0.6]) },
  { name: 'Tool', points: cyl([0, 0.75, 0.6], 'y', 0.05, 0.02) },
  { name: 'Gripper', points: box([-0.04, 0.6, 0.56], [0.04, 0.74, 0.64]) },
];
const r = inferRig(arm);
const nm = (i) => arm[i].name;
check('바닥이 고정 루트', nm(r.root) === 'Base' && r.link[r.root] === -1);
check('관절 4개 직렬', r.joints.length === 4 && r.levels === 4 && r.robot, r.joints.map((j) => j.name).join(','));
check('관절 순서', r.joints.map((j) => j.name).join() === 'Turret,Shoulder,Elbow,Tool');
check('축', near(r.joints[0].axis[1], 1) && near(r.joints[1].axis[0], 1) && near(r.joints[2].axis[0], 1));
check('같은 축 링은 선회 관절에 묶임', r.link[2] === 0);
check('위팔은 어깨 링크', r.link[4] === 1);
check('아래팔은 팔꿈치 링크', r.link[6] === 2);
check('그리퍼는 툴 링크', r.link[8] === 3);
check('부모 관절', r.joints.map((j) => j.parent).join() === '-1,0,1,2');

const conveyor = [{ name: 'Frame', points: box([-0.5, 0, -1], [0.5, 0.4, 1]) }];
for (let i = 0; i < 6; i++) conveyor.push({ name: `Roller${i}`, points: cyl([0, 0.43, -0.9 + i * 0.3], 'x', 0.03, 0.9) });
const c = inferRig(conveyor);
check('컨베이어는 로봇 아님', !c.robot && c.joints.length === 0);
check('부품 적으면 빈 결과', inferRig(arm.slice(0, 2)).joints.length === 0);

// 판에 패드 4개가 같은 방향으로 달리고 작업물이 패드를 다 덮는다 — 패드끼리 이어져도 관절 사슬이 아니다
const pads = [
  { name: 'Plate', points: box([-0.3, 0.5, -0.3], [0.3, 0.55, 0.3]) },
  { name: 'Post', points: box([-0.05, 0, -0.05], [0.05, 0.5, 0.05]) },
  { name: 'Work', points: box([-0.3, 0.38, -0.3], [0.3, 0.42, 0.3]) },
];
for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) pads.push({ name: `Pad${x}${z}`, points: cyl([x, 0.46, z], 'y', 0.03, 0.08) });
check('패드 묶음은 로봇 아님', !inferRig(pads).robot);

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
