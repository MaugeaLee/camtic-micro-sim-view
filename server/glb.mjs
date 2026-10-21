// GLB 헤더·JSON 청크 검사. three 없이 버퍼만 읽는다 (Node·브라우저 공용 로직).
// 규격: glTF 2.0 바이너리 — 12바이트 헤더(magic 'glTF', version 2, length) 뒤 JSON 청크가 먼저 온다.
const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;

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
  return { magic, version, length, json, errors };
}

// 기본 씬의 루트 노드 이름.
export function rootNames(json) {
  const scene = json?.scenes?.[json.scene ?? 0];
  return (scene?.nodes ?? []).map((i) => json.nodes?.[i]?.name ?? '');
}

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
