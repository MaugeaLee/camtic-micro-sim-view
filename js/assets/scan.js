// 씬 그래프에서 운동 그룹(arm/amr/rollers/gantry/track)을 찾는다. 판정은 movers.js(형상), 여기는 three 점 추출만.
// 에셋 뷰어와 메인 뷰가 같이 쓴다.
import * as THREE from 'three';
import { classifyMover } from './movers.js';

const POINT_CAP = 4000;

export function partPoints(obj) {
  const meshes = [];
  obj.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o); });
  const total = meshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
  const step = Math.max(1, Math.ceil(total / POINT_CAP));
  const out = [], v = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  }
  return out;
}

export function planFor(group) {
  if (group.userData.moverPlan !== undefined) return group.userData.moverPlan;
  const objects = group.children.filter((c) => c.isMesh || c.children.length);
  let plan = null;
  if (objects.length >= 3) {
    const hit = classifyMover(objects.map((o) => ({ name: o.name, points: partPoints(o) })));
    if (hit.kind !== 'none') plan = { ...hit, objects };
  }
  group.userData.moverPlan = plan;
  return plan;
}

function isDescendant(anc, node) {
  let p = node.parent;
  while (p) {
    if (p === anc) return true;
    p = p.parent;
  }
  return false;
}

// 가장 바깥 운동 그룹만 돌려준다.
export function scanMovers(scene) {
  scene.updateWorldMatrix(true, true);
  const raw = [];
  scene.traverse((o) => {
    if (o === scene || o.isMesh) return;
    const plan = planFor(o);
    if (plan) raw.push({ obj: o, kind: plan.kind, plan });
  });
  return raw.filter((a) => !raw.some((b) => b !== a && isDescendant(a.obj, b.obj)));
}
