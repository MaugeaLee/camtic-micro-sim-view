// 셀 카탈로그. DOM 없음.
// id는 STEP 최상위 조립품 이름(PRESS/SCREW/SORT)이다. OCS 셀 ID(A-3-n)와 대응시키지 않는다.
export const CELLS = Object.freeze([
  { id: 'PRESS', label: '프레스 셀', asset: 'PRESS' },
  { id: 'SCREW', label: '스크류 체결 셀', asset: 'SCREW' },
  { id: 'SORT', label: '분류 셀', asset: 'SORT' },
]);

export const CELL_STATES = Object.freeze(['IDLE', 'BUSY', 'DOWN']);

export const cellById = (id) => CELLS.find((c) => c.id === id) ?? null;
