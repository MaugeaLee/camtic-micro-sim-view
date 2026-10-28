// 온보드 가상 카메라 자세(sim/livecam.js). 산업 로봇 손목 · AMR 전방 · 견마 머리 · 드론 짐벌.
import { readFile } from 'node:fs/promises';
import { ViewerState } from '../js/sim/state.js';
import { LIVE, droneCam, liveCamOf, liveKindOf, vehicleCam, wristCam } from '../js/sim/livecam.js';
import { equipmentStatus } from '../js/data/monitor.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

const doc = JSON.parse(await readFile(new URL('../src/process.default.json', import.meta.url), 'utf8'));

console.log('livecam');

{
  const h0 = vehicleCam(0, 0, 0, LIVE.amr);
  check('heading 0 은 +z 전방', h0.look[2] > h0.eye[2] && near(h0.eye[0], 0) && near(h0.look[0], 0));
  const h1 = vehicleCam(3, -2, Math.PI / 2, LIVE.amr);
  check('heading π/2 는 +x 전방', h1.look[0] > h1.eye[0] && near(h1.eye[2], -2) && near(h1.look[2], -2));
  const down = wristCam([1, 1.2, 0], [0, -1, 0], { x: 10, z: 4, rotY: 0 });
  check('손목 캠은 공구 방향으로 내려다봄', down.look[1] < down.eye[1] && near(down.eye[0], 10 + 1) && near(down.eye[2], 4));
  const yaw = wristCam([0, 1, 1], [1, 0, 0], { x: 0, z: 0, rotY: 90 });
  check('셀 90° 회전이면 접근 방향도 돈다', yaw.look[2] < yaw.eye[2] - 0.4, JSON.stringify(yaw));
  const air = droneCam({ x: 2, z: 5, y: 4.8, heading: 0, scanning: null });
  check('드론 순항은 앞-아래', air.look[1] < air.eye[1] && air.look[2] > air.eye[2]);
  const scan = droneCam({ x: 2, z: 5, y: 3.6, heading: 0, scanning: 'inspect', job: { x: 8, z: 1 } });
  check('드론 검사는 임무 자리를 봄', near(scan.look[0], 8) && near(scan.look[2], 1));
}

{
  const s = new ViewerState({ quiet: true, scenario: 'supply', process: doc });
  const amr = liveCamOf(s, 'AMR-01');
  const sub = liveCamOf(s, 'P-AMR-01');
  const hound = liveCamOf(s, 'HOUND-01');
  const inspect = liveCamOf(s, 'HOUND-02');
  const drone = liveCamOf(s, 'DRONE-01');
  const sort = liveCamOf(s, 'SORT:Dual_arm_L');
  check('메인·서브 AMR 전방 캠', amr?.name === '전방 캠' && sub?.name === '전방 캠' && amr.kind === 'amr');
  check('견마 헤드 캠(리커버리·점검)', hound?.name === '헤드 캠' && hound.kind === 'hound' && inspect?.kind === 'hound' && inspect.name === '헤드 캠');
  check('드론 짐벌 캠', drone?.name === '짐벌 캠' && drone.kind === 'drone');
  check('SORT 양팔은 셀 로컬 TCP 로 손목 캠', sort?.kind === 'arm' && sort.name === '로봇 캠' && sort.eye.every(Number.isFinite));
  check('SORT 몸통 포커스도 손목 캠', liveCamOf(s, 'SORT:Dual_arm_robot')?.kind === 'arm');
  check('셀·직교이송·리프트는 온보드 캠 없음',
    liveCamOf(s, 'PRESS') == null && liveCamOf(s, 'PRESS:L01') == null && liveCamOf(s, 'PRESS:LIFT') == null);
  check('없는 id · 시나리오 없음', liveCamOf(s, 'NOPE') == null && liveCamOf(new ViewerState({ quiet: true }), 'AMR-01') == null);

  const a = s.amrs.find((x) => x.id === 'AMR-01');
  const before = liveCamOf(s, 'AMR-01');
  a.heading = Math.PI / 2;
  a.x += 2;
  const after = liveCamOf(s, 'AMR-01');
  check('AMR 이 움직이면 캠도 따라감', after.eye[0] > before.eye[0] && after.look[0] > after.eye[0]);
  check('liveKind', liveKindOf(s, 'PRESS:R6') === 'arm' && liveKindOf(s, 'AMR-01') === 'amr' && liveKindOf(s, 'HOUND-01') === 'hound' && liveKindOf(s, 'HOUND-02') === 'hound' && liveKindOf(s, 'DRONE-01') === 'drone' && liveKindOf(s, 'PRESS') == null);

  const st = equipmentStatus(s, 'AMR-01');
  const hd = equipmentStatus(s, 'HOUND-01');
  const dr = equipmentStatus(s, 'DRONE-01');
  const arm = equipmentStatus(s, 'SORT:Dual_arm_L');
  check('상태 문서에 캠 메타', st.cam?.type === 'front' && hd.cam?.type === 'head' && dr.cam?.type === 'gimbal' && arm.cam?.type === 'wrist' && !equipmentStatus(s, 'PRESS').cam);
}

if (fail) { console.error(`livecam FAIL ${fail}`); process.exitCode = 1; }
else console.log(`livecam ${pass} ok`);
