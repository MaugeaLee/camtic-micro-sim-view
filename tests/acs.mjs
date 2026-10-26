// ACS: 미리 배치된 AMR, 셀 잠금·정차 칸·교차 구역, 1~10대 장시간 무교착·무충돌, 레이아웃 재배치, 막힌 셀 배차 제외.
import { ViewerState } from '../js/sim/state.js';
import { AMR } from '../js/sim/fleet.js';
import { bounds, defaultLayout, normalizeLayout } from '../js/sim/layout.js';
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('acs');

// 잠금 불변식: 막다른 셀은 한 번에 1대, 통과 셀은 정차 칸 수까지. 정차 칸 하나에 한 대.
function soak(n, seconds, layout = defaultLayout()) {
  const s = new ViewerState({ scenario: 'supply', amr: n, layout });
  const fp = Object.fromEntries(Object.keys(layout.cells).map((id) => [id, bounds(id, layout.cells[id])]));
  let minGap = Infinity, maxBlock = 0, intrude = 0, lockOk = true, zoneOk = true;
  for (let i = 0; i < seconds * 10; i++) {
    s.step(0.1);
    const as = s.amrs;
    for (const L of Object.values(s.acs.locks)) {
      if (L.inside.size > L.cap) lockOk = false;
      // 정차 칸은 잠금 안 차만, 한 차가 쥐는 칸은 옮겨 가는 동안 최대 2칸 + 지나갈 칸 미리 잡기 1
      if (L.stops.some((h) => h && !L.inside.has(h))) lockOk = false;
      if (as.some((a) => L.stops.filter((h) => h === a).length > 3)) lockOk = false;
    }
    for (const Z of s.acs.zones) {
      const inZ = as.filter((a) => Math.hypot(a.x - Z.x, a.z - Z.z) < Z.r - 0.05);
      if (inZ.length > 1) zoneOk = false;
    }
    for (let a = 0; a < as.length; a++) {
      const A = as[a];
      maxBlock = Math.max(maxBlock, A.blockT);
      for (const [id, b] of Object.entries(fp)) {
        if (A.x <= b.x0 + 0.3 || A.x >= b.x1 - 0.3 || A.z <= b.z0 + 0.3 || A.z >= b.z1 - 0.3) continue;
        if (!s.acs.locks[id]?.inside.has(A) && !s.acs.locks[`${id}:OUT`]?.inside.has(A)) intrude++;
      }
      for (let k = a + 1; k < as.length; k++) minGap = Math.min(minGap, Math.hypot(A.x - as[k].x, A.z - as[k].z));
    }
  }
  const passes = s.logs.filter((l) => l.title.includes('우선 통행')).length;
  return { s, minGap, maxBlock, intrude, lockOk, zoneOk, passes };
}

// 시작: 생성이 아니라 충전 자리에 미리 서 있다
const homes = defaultLayout().amr.homes;
const s0 = new ViewerState({ scenario: 'supply', amr: homes.length });
check(`${homes.length}대가 처음부터 충전 자리에 있다`, s0.amrs.length === homes.length && s0.amrs.every((a, i) => a.x === homes[i].x && a.z === homes[i].z && a.mode === 'park'));
check('충전 자리는 루트를 등지고 선다(앞으로 들어와 후진으로 나감)', s0.amrs.every((a) => Math.abs(Math.abs(a.heading) - Math.PI) < 1e-6));

// 1~충전 자리 수 × 2시간: 교착(우선 통행) 없음, 간격 유지, 잠금 없이 셀 안 없음, 교차 구역 1대
const rows = [];
for (let n = 1; n <= homes.length; n++) {
  const r = soak(n, 7200);
  rows.push(`${n}대=${r.s.plant.delivered}`);
  const ok = r.passes === 0 && r.maxBlock <= 15 && (n === 1 || r.minGap >= 2 * AMR.radius) && r.intrude === 0 && r.lockOk && r.zoneOk;
  check(`${n}대 2시간: 무교착·무충돌·잠금·구역`, ok, `delivered=${r.s.plant.delivered} min=${Number.isFinite(r.minGap) ? r.minGap.toFixed(2) : '—'} maxBlock=${r.maxBlock.toFixed(1)} passes=${r.passes} intrude=${r.intrude} lock=${r.lockOk} zone=${r.zoneOk}`);
}
console.log(`    배송(2시간): ${rows.join(' ')}`);

// 도크 진입: 마지막 1 m 저속, 도크에서 셀 방향으로 정렬
const d = new ViewerState({ scenario: 'supply', amr: 2 });
let docked = null;
for (let i = 0; i < 6000 && !docked; i++) {
  d.step(0.1);
  docked = d.amrs.find((a) => a.task.startsWith('PRESS 하역'));
}
const press = d.acs.cells.PRESS.stops[0];
check('PRESS 하역 자리 = 셀 안 도크 · 방향 정렬', docked && Math.hypot(docked.x - press.x, docked.z - press.z) < 1e-3 && Math.abs(docked.heading - press.heading) < 1e-3,
  docked ? `(${docked.x.toFixed(2)}, ${docked.z.toFixed(2)}) h=${docked.heading.toFixed(3)}` : '하역 없음');

// 레이아웃 변경 → 미션 회수·키트 버퍼 복귀, 전원 충전 자리 재배치
const c = new ViewerState({ scenario: 'supply', amr: 4 });
for (let i = 0; i < 2000; i++) c.step(0.1);
const loaded = c.amrs.filter((a) => a.load).length, kits = c.plant.kits.length;
const lay2 = normalizeLayout({ ...defaultLayout(), amr: { ...defaultLayout().amr, homes: defaultLayout().amr.homes.slice(0, 2) } });
c.setLayout(lay2);
check('레이아웃 변경: 싣던 키트는 버퍼로, 모두 충전 자리', c.plant.kits.length === kits + loaded && c.amrs.filter((a) => !a.off).every((a, i) => a.x === lay2.amr.homes[i].x && a.mode === 'park'));
check('충전 자리보다 많은 차는 운휴', c.amrs.filter((a) => a.off).length === 2);
const before = c.plant.delivered, offAt = c.amrs.filter((a) => a.off).map((a) => `${a.x},${a.z}`).join();
for (let i = 0; i < 6000; i++) c.step(0.1);
check('운휴 차는 그대로, 나머지로 배송 계속', c.amrs.filter((a) => a.off).every((a) => !a.mission && !a.moving)
  && c.amrs.filter((a) => a.off).map((a) => `${a.x},${a.z}`).join() === offAt && c.plant.delivered > before + 5, `delivered ${before}→${c.plant.delivered}`);

// 막힌 셀(루트 끊김)은 배차하지 않는다
const cut = structuredClone(defaultLayout());
cut.amr.route.edges = cut.amr.route.edges.filter((e) => !(e.a === 'A2' && e.b === 'G2'));
const b = new ViewerState({ scenario: 'supply', amr: 4, layout: normalizeLayout(cut) });
for (let i = 0; i < 6000; i++) b.step(0.1);
const u = Object.fromEntries(b.plant.summary().units.map((x) => [x.id, x]));
check('SCREW 가 루트에서 끊기면 SCREW 로는 안 가고 PRESS 로만', !b.acs.ok('SCREW') && b.amrs.every((a) => a.load?.dest !== 'SCREW') && u.PRESS.done > 0 && b.plant.delivered > 0,
  `issues=${b.acs.check.issues.join(' · ')}`);

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
