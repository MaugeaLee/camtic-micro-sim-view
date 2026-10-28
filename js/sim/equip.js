// 셀 GLB 안 장비(로봇·직교이송·리프트·몸통) id. DOM·three 없음.
// id = `${cell}:${name}` (PRESS:R6 · SCREW:L01 · SORT:Dual_arm_L · PRESS:LIFT).
// 셀 통째 선택과 따로, AMR처럼 하나하나 고를 수 있게 목록만 만든다. 값은 시뮬 가정값.

export function parseEquipId(id) {
  const s = String(id ?? '');
  const i = s.indexOf(':');
  if (i <= 0 || i === s.length - 1) return null;
  return { cell: s.slice(0, i), name: s.slice(i + 1) };
}

export function listEquip(state) {
  const out = [];
  if (!state?.plant?.work) return out;
  for (const c of state.cells) {
    const cw = state.plant.work[c.id];
    if (cw) pushWork(out, c.id, cw);
  }
  return out;
}

export function findEquip(state, id) {
  if (!id || !String(id).includes(':')) return null;
  return listEquip(state).find((e) => e.id === id) ?? null;
}

// 머리 위·셀 목록: 양팔은 몸통만 그린다(L/R 팔 라벨은 안 붙임). 상태·모니터 id 는 listEquip 그대로.
export function labelEquip(list) {
  const xs = list ?? [];
  const body = new Set(xs.filter((e) => e.kind === 'body').map((e) => e.cell));
  return xs.filter((e) => !(e.kind === 'arm' && body.has(e.cell)));
}

function pushWork(out, cell, cw) {
  const robots = cw.robots
    ? (Array.isArray(cw.robots) ? cw.robots : Object.values(cw.robots))
    : [];
  for (const r of robots) {
    if (r?.name) out.push({ id: `${cell}:${r.name}`, cell, name: r.name, kind: 'arm' });
  }
  if (cw.L?.body) out.push({ id: `${cell}:${cw.L.body}`, cell, name: cw.L.body, kind: 'body' });
  if (Array.isArray(cw.lines)) {
    for (const L of cw.lines) {
      if (L?.id && L.gantry) out.push({ id: `${cell}:${L.id}`, cell, name: L.id, kind: 'gantry' });
    }
  }
  if (cw.lift) out.push({ id: `${cell}:LIFT`, cell, name: 'LIFT', kind: 'lift' });
}
