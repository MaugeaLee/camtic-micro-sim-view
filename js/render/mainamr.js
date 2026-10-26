// 메인 AMR 모델: 셀 GLB(PRESS·SCREW)의 AMR_MAIN_JIG(이송 AMR + 지그 상판 + MAIN 패널) 그룹을 복제해 플릿 차체로 쓴다. 그리기만 한다.
// GLB 에서 이 차는 +x 로 셀을 통과한다 → 플릿 차체 앞(+z)으로 돌린다. 밑면(바퀴 밑) = 0 · 이동 베이스 중심 = 원점.
// 가로(x·z)만 시뮬 차체 치수(AMR.length × width)에 맞추고 높이는 그대로 둔다 — MAIN 패널 윗면(적재면)이 공정 정의 deck 과 같다.
// 지그 상판·MAIN 패널은 앞뒤로 길어서(2.2 m) 줄 선 차끼리 겹친다 — 진행 방향 길이만 panel 로 줄인다(지그는 그 위에 얹힌다, 가정).
import * as THREE from 'three';

const NODE = /^AMR_MAIN_JIG/;
const LONG = /^(MainJig|MAIN_panel)/;
const BASE = /^MobileBase/;

// scene: 셀 GLB 씬(로더 원본, 바꾸지 않는다). foot: { length, width } (m). panel: 지그 상판·패널 진행 방향 길이(m).
export function mainAmrModel(scene, { length, width, panel }) {
  let node = null;
  scene.traverse((o) => { if (!node && NODE.test(o.name)) node = o; });
  if (!node) return null;
  scene.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert(), M = new THREE.Matrix4();
  const flat = new THREE.Group();
  const meshes = [];
  node.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.clone(false);
    M.multiplyMatrices(inv, o.matrixWorld).decompose(m.position, m.quaternion, m.scale);
    m.castShadow = true;
    // 이름: 메시 자신 또는 부모(멀티 프리미티브 메시는 부모 그룹에 이름이 있다)
    m.userData.part = (NODE.test(o.parent?.name ?? '') ? o.name : o.parent?.name) || o.name;
    flat.add(m);
    meshes.push(m);
  });
  if (!meshes.length) return null;
  flat.updateMatrixWorld(true);
  const boxOf = (list) => list.reduce((b, m) => b.union(new THREE.Box3().setFromObject(m)), new THREE.Box3());
  const all = boxOf(meshes), base = boxOf(meshes.filter((m) => BASE.test(m.userData.part)));
  const B = base.isEmpty() ? all : base;
  const c = B.getCenter(new THREE.Vector3()), bs = B.getSize(new THREE.Vector3());
  const kx = length / (bs.x || 1), kz = width / (bs.z || 1);
  // 지그 상판·패널: 제 중심 기준 진행 방향만 줄인다(가로 배율 kx 뒤 길이 = panel)
  for (const m of meshes.filter((k) => LONG.test(k.userData.part))) {
    const b = new THREE.Box3().setFromObject(m), mc = b.getCenter(new THREE.Vector3()), L = b.max.x - b.min.x;
    const f = Math.min(1, panel / ((L || 1) * kx));
    const w = new THREE.Group();
    w.position.set(mc.x, 0, 0);
    w.scale.x = f;
    m.position.x -= mc.x;
    flat.remove(m);
    w.add(m);
    flat.add(w);
  }
  flat.position.set(-c.x, -all.min.y, -c.z);
  const scale = new THREE.Group();
  scale.scale.set(kx, 1, kz);
  scale.add(flat);
  const out = new THREE.Group();
  out.name = 'main-amr';
  out.rotation.y = -Math.PI / 2;   // GLB +x → 차체 앞 +z
  out.add(scale);
  out.updateMatrixWorld(true);
  const deck = boxOf(meshes.filter((m) => /^MAIN_panel/.test(m.userData.part)));
  out.userData = { deck: deck.isEmpty() ? null : deck.max.y - all.min.y, length: bs.x * kx, width: bs.z * kz };
  return out;
}

// 셀 GLB 안 AMR_MAIN_JIG 그룹(자세 인스턴스) — 리프트 셀에서 숨긴다. 플릿 메인 AMR 이 그 자리에 들어온다.
export function mainAmrNodes(obj) {
  const out = [];
  obj.traverse((o) => { if (NODE.test(o.name) && !NODE.test(o.parent?.name ?? '')) out.push(o); });
  return out;
}
