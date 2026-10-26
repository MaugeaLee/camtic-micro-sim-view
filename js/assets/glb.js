// GLB 버퍼를 three 없이 읽는다: 헤더·JSON·BIN 청크, 노드 월드 행렬, 정점, 셀 프레임. Node·브라우저 공용.
// 규격: glTF 2.0 바이너리 — 12바이트 헤더(magic 'glTF', version 2, length) 뒤 JSON 청크, 그다음 BIN 청크.
// 행렬은 glTF와 같은 열 우선 16칸 배열이다.
const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const FLOAT = 5126;

export function readGlb(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const errors = [];
  if (u8.byteLength < 20) return { errors: ['12바이트 헤더 + 청크 헤더보다 짧음'] };
  const magic = dv.getUint32(0, true), version = dv.getUint32(4, true), length = dv.getUint32(8, true);
  if (magic !== MAGIC) errors.push('magic이 glTF 아님');
  if (version !== 2) errors.push(`version ${version} (2여야 함)`);
  if (length !== u8.byteLength) errors.push(`헤더 길이 ${length} ≠ 파일 ${u8.byteLength}`);
  const jsonLen = dv.getUint32(12, true), jsonType = dv.getUint32(16, true);
  if (jsonType !== CHUNK_JSON) errors.push('첫 청크가 JSON 아님');
  if (errors.length) return { magic, version, length, errors };
  let json = null;
  try { json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jsonLen))); }
  catch (e) { errors.push(`JSON 청크 파싱 실패: ${e.message}`); }
  let bin = null;
  const at = 20 + jsonLen;
  if (at + 8 <= u8.byteLength && dv.getUint32(at + 4, true) === CHUNK_BIN) bin = u8.subarray(at + 8, at + 8 + dv.getUint32(at, true));
  return { magic, version, length, json, bin, errors };
}

// 기본 씬의 루트 노드 이름.
export function rootNames(json) {
  const scene = json?.scenes?.[json.scene ?? 0];
  return (scene?.nodes ?? []).map((i) => json.nodes?.[i]?.name ?? '');
}

// ── 행렬 (열 우선) ──
export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export function compose(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

export function apply(m, p) {
  const [x, y, z] = p;
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

const local = (n) => n.matrix ?? compose(n.translation, n.rotation, n.scale);

// 기본 씬 노드마다 월드 행렬·부모. [{ index, name, parent, world }]
export function walkNodes(json) {
  const out = [];
  const visit = (i, parent, pm) => {
    const n = json.nodes[i];
    const world = mul(pm, local(n));
    out.push({ index: i, name: n.name ?? '', parent, world, node: n });
    for (const c of n.children ?? []) visit(c, i, world);
  };
  for (const r of json.scenes?.[json.scene ?? 0]?.nodes ?? []) visit(r, -1, IDENTITY);
  return out;
}

export function emptyBox() { return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; }
export function grow(box, p) {
  for (let k = 0; k < 3; k++) { if (p[k] < box.min[k]) box.min[k] = p[k]; if (p[k] > box.max[k]) box.max[k] = p[k]; }
  return box;
}
export const isEmpty = (box) => !(box.min[0] <= box.max[0]);

// 메시 노드 하나의 월드 AABB. accessor min/max 8모서리를 월드로 옮긴다 — three Box3.setFromObject(정밀 아님)와 같은 규칙.
function meshBox(json, nd, box) {
  const mesh = json.meshes?.[nd.node.mesh];
  for (const prim of mesh?.primitives ?? []) {
    const acc = json.accessors[prim.attributes.POSITION];
    if (!acc?.min || !acc?.max) continue;
    for (let c = 0; c < 8; c++) {
      grow(box, apply(nd.world, [c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]]));
    }
  }
  return box;
}

// 노드 index 아래(자신 포함) 모든 메시의 월드 AABB.
export function subtreeBox(json, nodes, index, box = emptyBox()) {
  const byParent = childrenOf(nodes);
  const stack = [index];
  while (stack.length) {
    const i = stack.pop();
    const nd = nodes.find((n) => n.index === i);
    if (nd?.node.mesh != null) meshBox(json, nd, box);
    stack.push(...(byParent.get(i) ?? []));
  }
  return box;
}

function childrenOf(nodes) {
  const m = new Map();
  for (const n of nodes) {
    if (!m.has(n.parent)) m.set(n.parent, []);
    m.get(n.parent).push(n.index);
  }
  return m;
}

// 정점 월드 좌표. 노드 아래 메시 POSITION 을 step 간격으로 뽑아 평면 배열로 (float만).
export function subtreePoints(json, bin, nodes, index, { cap = 4000 } = {}) {
  const byParent = childrenOf(nodes);
  const meshes = [];
  const stack = [index];
  while (stack.length) {
    const i = stack.pop();
    const nd = nodes.find((n) => n.index === i);
    if (nd?.node.mesh != null) meshes.push(nd);
    stack.push(...(byParent.get(i) ?? []));
  }
  const prims = meshes.flatMap((nd) => (json.meshes[nd.node.mesh]?.primitives ?? []).map((p) => ({ nd, acc: json.accessors[p.attributes.POSITION] })));
  const total = prims.reduce((n, p) => n + (p.acc?.count ?? 0), 0);
  const step = Math.max(1, Math.ceil(total / cap));
  const out = [];
  for (const { nd, acc } of prims) {
    if (!acc || acc.componentType !== FLOAT || acc.bufferView == null) continue;
    const bv = json.bufferViews[acc.bufferView];
    const stride = bv.byteStride || 12;
    const dv = new DataView(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0));
    for (let i = 0; i < acc.count; i += step) {
      const o = i * stride;
      out.push(...apply(nd.world, [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]));
    }
  }
  return out;
}

// 셀 프레임: 기본 씬 전체 AABB. 밑면을 y=0, xz 중심을 0 으로 옮기는 offset 을 준다.
// 렌더와 sim 이 이 offset 하나를 같이 써야 셀 로컬 지점(도크 등)이 화면과 맞는다.
export function cellFrame(json) {
  const nodes = walkNodes(json);
  const box = emptyBox();
  for (const nd of nodes) if (nd.node.mesh != null) meshBox(json, nd, box);
  if (isEmpty(box)) return null;
  const offset = [-(box.min[0] + box.max[0]) / 2, -box.min[1], -(box.min[2] + box.max[2]) / 2];
  return {
    offset,
    size: [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]],
    height: box.max[1] - box.min[1],
  };
}

// 루트(셀) 바로 아래 그룹마다 셀 프레임 기준 AABB. [{ name, index, min, max, center }]
export function topGroups(json, frame = cellFrame(json)) {
  const nodes = walkNodes(json);
  const root = nodes.find((n) => n.parent === -1);
  if (!root || !frame) return [];
  const off = frame.offset;
  return nodes.filter((n) => n.parent === root.index).map((n) => {
    const b = subtreeBox(json, nodes, n.index);
    if (isEmpty(b)) return { name: n.name, index: n.index, empty: true };
    const min = b.min.map((v, k) => v + off[k]), max = b.max.map((v, k) => v + off[k]);
    return { name: n.name, index: n.index, min, max, center: min.map((v, k) => (v + max[k]) / 2) };
  });
}
