// 머리 위 라벨 문구·색. three·DOM 없음. 셀 라벨(view.js)과 같은 상태 색을 쓴다.
export const TAG_COLOR = Object.freeze({
  idle: 0x9aa4b2,
  busy: 0x3ccf8e,
  down: 0xff5d5d,
  move: 0x4fb3ff,
  wait: 0xf5b74e,
  charge: 0x3ccf8e,
});

export const SITE_NAME = Object.freeze({
  OUT: '완료품 적재',
  PARTS: '부품 창고',
  STORE: '원재료 창고',
});

const KIND = Object.freeze({ arm: '로봇', gantry: '직교', lift: '리프트', body: '몸통' });
const LIFT = Object.freeze({ empty: '빈 리프트', rise: '올림', work: '작업 중', done: '반출 대기', lower: '내림' });

export function clip(s, n = 22) {
  const t = String(s ?? '');
  return t.length <= n ? t : `${t.slice(0, Math.max(0, n - 1))}…`;
}

// AMR: id + 작업. 운휴·고장·충전에 색을 맞춤.
export function amrTag(a) {
  if (!a) return null;
  if (a.off) return { title: a.id, sub: '운휴', color: TAG_COLOR.idle };
  if (a.halt) return { title: a.id, sub: clip(a.halt.why ?? '정지'), color: TAG_COLOR.down };
  const load = a.load ? `#${a.load.id}` : '';
  const sub = clip([load, a.task].filter(Boolean).join(' · '));
  let color = TAG_COLOR.wait;
  if (a.battery < 30) color = TAG_COLOR.down;
  else if (a.charging) color = TAG_COLOR.charge;
  else if (a.moving) color = TAG_COLOR.move;
  return { title: a.id, sub, color };
}

// 드론·견마: id + 작업(배터리).
export function robotTag(v) {
  if (!v) return null;
  const batt = Number.isFinite(v.battery) ? `${v.battery.toFixed(0)}%` : '';
  const sub = clip([v.task, batt].filter(Boolean).join(' · '));
  let color = TAG_COLOR.move;
  if (v.mode === 'nudge' || v.job?.kind === 'fault') color = TAG_COLOR.down;
  else if (v.mode === 'charge' || v.mode === 'idle') color = TAG_COLOR.charge;
  else if (v.scanning) color = TAG_COLOR.busy;
  return { title: v.id, sub, color };
}

export function siteTag(id) {
  if (!SITE_NAME[id]) return null;
  return { title: id, sub: SITE_NAME[id], color: TAG_COLOR.idle };
}

// 셀 안 장비(PRESS:R6). work = CellWork/SortWork. cellState = IDLE|BUSY|DOWN.
export function equipTag(e, { cellState, work } = {}) {
  if (!e) return null;
  const down = cellState === 'DOWN';
  let busy = false, label = KIND[e.kind] ?? e.kind;
  if (e.kind === 'arm') {
    const list = Array.isArray(work?.robots) ? work.robots : Object.values(work?.robots ?? {});
    const r = list.find((x) => x.name === e.name);
    busy = !!(r?.op || (Array.isArray(work?.robots) && work?.op));
    label = r?.label ?? '대기';
  } else if (e.kind === 'gantry') {
    const L = work?.lines?.find((x) => x.id === e.name);
    busy = !!L?.gantry?.op;
    label = L?.part ?? '직교이송';
  } else if (e.kind === 'lift') {
    const ph = work?.lift?.phase;
    busy = !!(ph && ph !== 'empty');
    label = LIFT[ph] ?? '리프트';
  } else if (e.kind === 'body') {
    busy = !!work?.op;
    label = '몸통';
  }
  const color = down ? TAG_COLOR.down : busy ? TAG_COLOR.busy : TAG_COLOR.idle;
  return { title: e.id, sub: clip(label), color };
}
