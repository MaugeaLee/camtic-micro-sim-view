// GLB 셀 계약 검사. 버퍼 읽기·기하는 js/assets/glb.js (three 없음, 브라우저와 공용).
import { readGlb, rootNames } from '../js/assets/glb.js';

export { readGlb, rootNames };

// 셀 GLB 계약: 헤더가 유효하고, 기본 씬 루트 노드가 하나이며 이름이 셀 id.
export function checkCellGlb(buf, id) {
  const g = readGlb(buf);
  const errors = [...g.errors];
  if (g.json) {
    const roots = rootNames(g.json);
    if (roots.length !== 1) errors.push(`루트 노드 ${roots.length}개 (1개여야 함): ${roots.join(', ')}`);
    else if (roots[0] !== id) errors.push(`루트 노드 이름 ${roots[0]} ≠ ${id}`);
  }
  return { ok: errors.length === 0, errors, roots: g.json ? rootNames(g.json) : [] };
}
