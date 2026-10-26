// 필드(바닥·벽) 정의 데이터. three·DOM 없음.
// 치수는 실측이 아니라 가정이다 — 셀 3개(GLB 바닥 약 10×11 m · 10×11 m · 17×9.5 m)가 통로와 함께 들어갈 크기.
// 원점 = 바닥 중심, x = 폭, z = 깊이(−z 뒷벽, +z 열린 앞면), 1 = 1 m.
export const FIELD = Object.freeze({
  assumed: true,
  // 76 m: SORT 서쪽에 완료품 구역(OUT, 중심 x −30)과 서쪽 벽 여유, 동쪽은 반출 지선(A3–G3, x 25.8)과 부품 통로(x 29).
  // 60 m 에서는 OUT 이 벽에 붙고, 52 m 에서는 동쪽 두 차로가 겹친다.
  size: Object.freeze({ w: 76, d: 30 }),
  tile: 4,
  wall: Object.freeze({ h: 8, t: 0.3, sides: Object.freeze(['back', 'left', 'right']) }),
  column: Object.freeze({ size: 0.6, pitch: 9 }),
  band: Object.freeze({ h: 0.5, d: 0.35, y: 7.7 }),
  // 고정 통로 도색. AMR 루트는 레이아웃 데이터(amr.route)라 render/fleet.js 가 따로 그린다.
  lanes: Object.freeze([]),
});

// 관제 모니터(가정): 뒷벽 SORT 앞 기둥(x −22.5 · −13.5 · −4.5) 사이에 건 화면 한 장, cols×rows 칸에 내부 CCTV 를 띄운다.
// 화면 속 영상은 씬을 가상 카메라로 다시 그린 것이다 — 녹화·감지·카메라 배치 최적화(F12)는 없다.
// x·y = 화면 중심(m), w·h = 화면 크기, res = 렌더 텍스처 픽셀, fps = 칸마다 갱신 빈도(차례로 한 칸씩).
export const MONITOR = Object.freeze({
  x: -13.5, y: 4.4, w: 14.4, h: 5.4, cols: 3, rows: 2, res: Object.freeze([1536, 864]), fps: 8,
});

// 내부 CCTV(가정, 천장 아래 고정). look: 셀·자리 id(레이아웃을 따라감) 또는 {x,y,z}. from: look 에서 카메라까지 [dx,dy,dz] — look 이 점이면 절대 위치.
export const CCTV = Object.freeze([
  Object.freeze({ id: 'CAM-01', name: 'SORT 분류', look: 'SORT', from: Object.freeze([-6, 6.6, -9]) }),
  Object.freeze({ id: 'CAM-02', name: 'PRESS', look: 'PRESS', from: Object.freeze([-5, 6.6, -9]) }),
  Object.freeze({ id: 'CAM-03', name: 'SCREW', look: 'SCREW', from: Object.freeze([5, 6.6, -9]) }),
  Object.freeze({ id: 'CAM-04', name: '부품 창고', look: 'PARTS', from: Object.freeze([-6, 5.5, 9]) }),
  Object.freeze({ id: 'CAM-05', name: '완료품 적재', look: 'OUT', from: Object.freeze([6, 6, 8]) }),
  Object.freeze({ id: 'CAM-06', name: '전경', look: Object.freeze({ x: -4, y: 0, z: -4 }), from: Object.freeze([34, 7.5, 13]) }),
]);

const SIDES = ['back', 'left', 'right', 'front'];
const pos = (v) => Number.isFinite(v) && v > 0;

export function validateField(def) {
  const errors = [];
  const { size, tile, wall, column, band, lanes } = def ?? {};
  if (!pos(size?.w) || !pos(size?.d)) errors.push('size.w·size.d는 양수');
  if (!pos(tile)) errors.push('tile은 양수');
  if (!pos(wall?.h) || !pos(wall?.t)) errors.push('wall.h·wall.t는 양수');
  if (!Array.isArray(wall?.sides) || wall.sides.some((s) => !SIDES.includes(s))) errors.push(`wall.sides는 ${SIDES.join('/')} 중에서`);
  if (!pos(column?.size) || !pos(column?.pitch)) errors.push('column.size·column.pitch는 양수');
  if (!pos(band?.h) || !pos(band?.d) || !(band?.y + band?.h / 2 <= wall?.h)) errors.push('band는 벽 높이 안');
  if (!errors.length) {
    for (const [i, l] of (lanes ?? []).entries()) {
      const inside = pos(l.w) && pos(l.d)
        && Math.abs(l.x) + l.w / 2 <= size.w / 2 && Math.abs(l.z) + l.d / 2 <= size.d / 2;
      if (!inside) errors.push(`lanes[${i}]가 바닥 밖`);
    }
  }
  return errors;
}

// 관제 모니터·CCTV 정의 점검. ids: look 으로 쓸 수 있는 셀·자리 id.
export function validateMonitor(M, cams, field = FIELD, ids = []) {
  const errors = [];
  if (!M || !cams) return ['모니터·CCTV 정의 없음'];
  const { size: { w: W }, band, wall } = field;
  if (![M.w, M.h, M.fps].every(pos) || !Number.isFinite(M.x) || !Number.isFinite(M.y)) errors.push('모니터 x·y는 수, w·h·fps는 양수');
  else {
    if (Math.abs(M.x) + M.w / 2 > W / 2) errors.push('모니터가 뒷벽 밖');
    if (M.y - M.h / 2 < 0.5 || M.y + M.h / 2 > band.y - band.h / 2) errors.push('모니터는 바닥 0.5 m 위 · 벽 띠 아래');
  }
  if (!wall.sides.includes('back')) errors.push('모니터를 걸 뒷벽 없음');
  if (!Number.isInteger(M.cols) || !Number.isInteger(M.rows) || M.cols < 1 || M.rows < 1) errors.push('모니터 cols·rows는 1 이상 정수');
  else if (cams.length !== M.cols * M.rows) errors.push(`CCTV ${cams.length}대 ≠ 모니터 칸 ${M.cols * M.rows}`);
  if (!Array.isArray(M.res) || M.res.length !== 2 || !M.res.every((v) => Number.isInteger(v) && v >= 64 && v <= 4096)) errors.push('모니터 res는 64~4096 정수 2개');
  const seen = new Set();
  for (const c of cams) {
    if (seen.has(c.id)) errors.push(`CCTV id ${c.id} 중복`);
    seen.add(c.id);
    const pt = typeof c.look === 'object' && c.look && ['x', 'y', 'z'].every((k) => Number.isFinite(c.look[k]));
    if (!pt && !ids.includes(c.look)) errors.push(`${c.id} look ${c.look} 모름`);
    if (!Array.isArray(c.from) || c.from.length !== 3 || !c.from.every(Number.isFinite)) errors.push(`${c.id} from은 수 3개`);
    else if (c.from[1] <= 0 || c.from[1] > wall.h) errors.push(`${c.id} 높이는 바닥과 벽 높이 사이`);
  }
  return errors;
}

// 뒷벽 안쪽 기둥 x 좌표. 가운데 기준 대칭, 양 끝 벽에서 pitch/2 이상 띄운다.
export function columnXs(def) {
  const { size: { w }, column: { pitch } } = def;
  const n = Math.max(1, Math.floor(w / pitch));
  const x0 = -((n - 1) * pitch) / 2;
  return Array.from({ length: n }, (_, i) => x0 + i * pitch);
}
