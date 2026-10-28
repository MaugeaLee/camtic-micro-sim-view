// 같은 셀에서 나란한 바닥 레일 중 짧은 쪽을 긴 쪽 행정에 맞춘다(가정).
// PRESS 북쪽 LM(R7·R8)이 남쪽 R6·R9·R10 레일보다 짧은 것을 맞추기 위한 것. GLB 파일은 그대로 두고 노드 TRS 만 바꾼다.
// three·DOM 없음. 로더가 같은 JSON 을 다시 묶어 Three 에 넘긴다.
import { isEmpty, rootNames, subtreeBox, walkNodes } from './glb.js';
import { scanGlb } from './scan-glb.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function fitRails(json, bin) {
  if (!json?.nodes || !bin || json.extras?.railFit) return false;
  // PRESS 북쪽 LM만. SORT 랙(Rack_station)이 트랙으로 잡히면 선반이 허공으로 늘어난다.
  if (rootNames(json)[0] !== 'PRESS') return false;
  const tracks = scanGlb(json, bin).filter((m) => m.kind === 'track');
  let changed = false;
  for (const src of tracks) {
    const dst = tracks
      .filter((t) => t !== src && Math.abs(dot(t.plan.axis, src.plan.axis)) >= 0.95 && t.plan.span > src.plan.span + 0.05)
      .sort((a, b) => b.plan.span - a.plan.span)[0];
    if (dst && stretchTrack(json, src, dst)) changed = true;
  }
  if (changed) json.extras = { ...(json.extras ?? {}), railFit: true };
  return changed;
}

function stretchTrack(json, src, dst) {
  const nodes = walkNodes(json);
  const ax = src.plan.axis;
  const along = (p) => dot(p, ax);
  const sMid = along(src.plan.origin), dMid = along(dst.plan.origin);
  const sLo = sMid - src.plan.span, sHi = sMid + src.plan.span;
  const dLo = dMid - dst.plan.span, dHi = dMid + dst.plan.span;
  const sLen = sHi - sLo, dLen = dHi - dLo;
  if (sLen < 1e-6 || dLen - sLen < 0.05) return false;
  const keepLo = Math.abs(sLo - dLo) <= Math.abs(sHi - dHi);
  const pivot = keepLo ? sLo : sHi;
  const shift = keepLo ? dHi - sHi : dLo - sLo;
  const S = dLen / sLen;
  const T = pivot * (1 - S);
  const axisI = Math.abs(ax[0]) >= Math.abs(ax[2]) ? 0 : 2;
  const trs = (scale, move) => {
    const s = [1, 1, 1], t = [0, 0, 0];
    if (scale) s[axisI] = S;
    t[axisI] = scale ? T : move;
    return { scale: s, translation: t };
  };

  for (const i of src.nodes ?? []) {
    const b = subtreeBox(json, nodes, i);
    if (isEmpty(b)) continue;
    const lo = Math.min(along(b.min), along(b.max)), hi = Math.max(along(b.min), along(b.max));
    const n = json.nodes[i];
    if (hi - lo >= sLen * 0.45) Object.assign(n, trs(true, 0));
    else if ((keepLo && Math.abs(hi - sHi) < 0.3) || (!keepLo && Math.abs(lo - sLo) < 0.3)) Object.assign(n, trs(false, shift));
  }
  fillSupports(json, src, dst, ax, axisI);
  return true;
}

// 긴 레일 발·지지대가 짧은 쪽에 없으면 가까운 같은 크기 부품을 복제해 그 자리에 둔다.
function fillSupports(json, src, dst, ax, axisI) {
  const nodes = walkNodes(json);
  const along = (p) => dot(p, ax);
  const shorts = (track) => (track.nodes ?? []).map((i) => {
    const b = subtreeBox(json, nodes, i);
    if (isEmpty(b)) return null;
    const lo = Math.min(along(b.min), along(b.max)), hi = Math.max(along(b.min), along(b.max));
    if (hi - lo >= 1) return null;
    return { i, c: (lo + hi) / 2, len: hi - lo };
  }).filter(Boolean);
  const have = shorts(src);
  const group = json.nodes[src.index];
  if (!group) return;
  group.children = group.children ?? [];
  for (const d of shorts(dst)) {
    if (have.some((s) => Math.abs(s.c - d.c) < 0.45)) continue;
    const twin = have.filter((s) => Math.abs(s.len - d.len) < 0.15)
      .sort((a, b) => Math.abs(a.c - d.c) - Math.abs(b.c - d.c))[0];
    if (!twin) continue;
    const dx = d.c - twin.c;
    if (Math.abs(dx) < 0.05) continue;
    const srcN = json.nodes[twin.i];
    const t = [0, 0, 0];
    t[axisI] = (srcN.translation?.[axisI] ?? 0) + dx;
    const copy = { name: `${String(srcN.name ?? 'Rail').replace(/\.\d+$/, '')}.fit`, mesh: srcN.mesh, translation: t };
    const idx = json.nodes.length;
    json.nodes.push(copy);
    group.children.push(idx);
    have.push({ i: idx, c: d.c, len: twin.len });
  }
}
