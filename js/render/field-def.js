// 필드(바닥·벽) 정의 데이터. three·DOM 없음.
// 치수는 실측이 아니라 가정이다 — 셀 3개(GLB 바닥 약 10×11 m · 10×11 m · 17×9.5 m)가 통로와 함께 들어갈 크기.
// 원점 = 바닥 중심, x = 폭, z = 깊이(−z 뒷벽, +z 열린 앞면), 1 = 1 m.
export const FIELD = Object.freeze({
  assumed: true,
  size: Object.freeze({ w: 48, d: 30 }),
  tile: 4,
  wall: Object.freeze({ h: 8, t: 0.3, sides: Object.freeze(['back', 'left', 'right']) }),
  column: Object.freeze({ size: 0.6, pitch: 9 }),
  band: Object.freeze({ h: 0.5, d: 0.35, y: 7.7 }),
  lanes: Object.freeze([
    Object.freeze({ x: 0, z: 12.2, w: 45, d: 2.6 }),
  ]),
});

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

// 뒷벽 안쪽 기둥 x 좌표. 가운데 기준 대칭, 양 끝 벽에서 pitch/2 이상 띄운다.
export function columnXs(def) {
  const { size: { w }, column: { pitch } } = def;
  const n = Math.max(1, Math.floor(w / pitch));
  const x0 = -((n - 1) * pitch) / 2;
  return Array.from({ length: n }, (_, i) => x0 + i * pitch);
}
