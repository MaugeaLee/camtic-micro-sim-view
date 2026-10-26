// 추정 관절 체인 FK·IK. 합성 팔(축·원점 정해 둔 것)과 PRESS GLB 에서 뽑은 팔로 판정.
import { readFile } from 'node:fs/promises';
import { readGlb } from '../js/assets/glb.js';
import { cellRig } from '../js/assets/rigdata.js';
import { aimSeed, chainOf, fk, ik, jointPoints, lerpPose, reach, rotate } from '../js/sim/kin.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

console.log('kin');
const r = rotate([1, 0, 0], [0, 1, 0], Math.PI / 2);
check('Rodrigues: x 를 y 축으로 +90° → -z', dist(r, [0, 0, -1]) < 1e-12);

// 합성 5축 팔: J1 수직 선회, J2·J3 수평(어깨·팔꿈치), J4 손목 굽힘, J5 공구 롤. 영점에서 팔은 +z 로 뻗고 공구는 아래(-y).
const arm = {
  name: 'T1',
  joints: [
    { origin: [0, 0.3, 0], axis: [0, 1, 0], parent: -1 },
    { origin: [0, 0.5, 0], axis: [1, 0, 0], parent: 0 },
    { origin: [0, 0.5, 0.4], axis: [1, 0, 0], parent: 1 },
    { origin: [0, 0.5, 0.75], axis: [1, 0, 0], parent: 2 },
    { origin: [0, 0.4, 0.75], axis: [0, 1, 0], parent: 3 },
  ],
  tcp: { joint: 4, point: [0, 0.3, 0.75], approach: [0, -1, 0], reach: 0.1 },
};
const ch = chainOf(arm, { track: { axis: [1, 0, 0], lo: -0.5, hi: 0.5 } });
check('체인: 관절 5개, 베이스 = J1 원점', ch.joints.length === 5 && dist(ch.base, [0, 0.3, 0]) < 1e-12);
const z0 = fk(ch, [0, 0, 0, 0, 0], 0);
check('FK 영점 = CAD TCP', dist(z0.p, arm.tcp.point) < 1e-12 && dist(z0.a, [0, -1, 0]) < 1e-12);
check('FK 레일 0.3 m → TCP 도 x +0.3', dist(fk(ch, [0, 0, 0, 0, 0], 0.3).p, [0.3, 0.3, 0.75]) < 1e-12);
const q90 = fk(ch, [Math.PI / 2, 0, 0, 0, 0], 0).p;
check('FK J1 +90° → TCP 가 +x 쪽', dist(q90, [0.75, 0.3, 0]) < 1e-9, q90.map((v) => v.toFixed(3)).join(','));
const jp = jointPoints(ch, [Math.PI / 2, 0, 0, 0, 0], 0);
check('관절 원점도 같이 돈다(J3 → +x)', dist(jp[2], [0.4, 0.5, 0]) < 1e-9);

// IK 왕복: 아는 자세의 FK 를 목표로 → 풀어서 다시 FK
const qt = [0.4, 0.25, -0.5, 0.3, 0], st = 0.1;
const tgt = fk(ch, qt, st);
const sol = ik(ch, tgt.p, { approach: tgt.a, seed: [0, 0, 0, 0, 0] });
const back = fk(ch, sol.q, sol.s);
check('IK 왕복: 위치 < 0.1 mm, 접근 < 0.02 rad(ok 기준)', sol.ok && dist(back.p, tgt.p) < 1e-4 && dist(back.a, tgt.a) < 0.02, `err ${sol.err.toExponential(1)} · ${sol.angle.toFixed(4)} rad`);
const far = ik(ch, [0, 0.3, 3], { seed: [0, 0, 0, 0, 0] });
check('IK 못 닿는 점은 ok=false', !far.ok && far.err > 0.5, `err ${far.err.toFixed(2)}`);
const lim = ik(ch, [1.5, 0.3, 0.3], { seed: [0, 0, 0, 0, 0] });
check('IK 레일은 범위 안', lim.s <= 0.5 + 1e-12 && lim.s >= -0.5 - 1e-12, `s ${lim.s.toFixed(3)}`);
const ready = { q: [0, 0, 0, 0, 0], s: 0 };
const aim = aimSeed(ch, [-0.75, 0.3, 0], ready);
check('aimSeed: J1 을 목표 쪽(-x)으로 돌린다', Math.abs(aim.q[0] + Math.PI / 2) < 1e-9, aim.q[0].toFixed(3));
const back2 = reach(ch, [0, 0.3, -0.7], ready, ready);
check('reach: 뒤쪽 목표는 선회로(J1 ≈ ±π)', back2.ok && Math.abs(Math.abs(back2.q[0]) - Math.PI) < 0.3, `q1 ${back2.q[0].toFixed(2)}`);
const mid = lerpPose({ q: [0, 1], s: 0 }, { q: [1, 3], s: 2 }, 0.5);
check('lerpPose 중간', mid.q[0] === 0.5 && mid.q[1] === 2 && mid.s === 1);

// PRESS GLB: 팔 5대(R6~R10) TCP 가 뽑히고, 영점 FK = TCP, 공정 지점(가정)에 IK 가 닿는다.
const { json, bin } = readGlb(await readFile(new URL('../src/render_asset/PRESS.glb', import.meta.url)));
const rig = cellRig(json, bin);
const names = rig.arms.map((a) => a.name.replace(/\.\d+$/, '')).sort();
check('PRESS 팔 R6~R10 + TCP', ['R10', 'R6', 'R7', 'R8', 'R9'].every((n) => names.includes(n)) && rig.arms.every((a) => a.tcp), names.join(','));
const R = (n) => rig.arms.find((a) => a.name.replace(/\.\d+$/, '') === n);
const pts = {
  R6: [[-1.83, 0.42, 0], [-0.3, 1.27, 0], [-1.88, 1.30, -2.25], [-0.42, 1.30, -0.08]],
  R7: [[-1.88, 1.29, 2.25], [-0.18, 1.29, 0.08]],
  R9: [[-0.3, 1.27, 0], [0.8, 1.27, 0], [0.32, 1.29, -2.25], [0.93, 1.29, -0.08]],
  R8: [[0.32, 1.30, 2.25], [0.67, 1.30, 0.08]],
  R10: [[0.86, 1.33, -0.1], [1.0, 1.33, 0.1]],
};
for (const [n, list] of Object.entries(pts)) {
  const a = R(n), T = rig.tracks[a.track];
  const c = chainOf(a, { track: T ? { axis: T.axis, lo: -1.3, hi: 1.0 } : null });
  check(`${n} 영점 FK = GLB TCP`, dist(fk(c, c.joints.map(() => 0), 0).p, a.tcp.point) < 1e-9);
  const rd = { q: c.joints.map(() => 0), s: 0 };
  let prev = rd, bad = [];
  for (const p of list) {
    const s = reach(c, p, prev, rd);
    if (!s.ok) bad.push(`${p.join(',')} err ${s.err.toFixed(3)}`);
    prev = s;
  }
  check(`${n} 공정 지점 ${list.length}곳 IK 도달`, !bad.length, bad.join(' · '));
}

console.log(`  ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
