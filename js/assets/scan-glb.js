// GLB 바이트만으로 운동 그룹(arm/amr/rollers/gantry/track)을 찾는다. scan.js(three 씬)와 같은 규칙, three·DOM 없음.
// 그룹 = 메시가 아닌 노드, 부품 = 그 노드의 직계 자식(메시이거나 자식이 있는 것) — 부품 점은 자식 서브트리 정점.
import { subtreePoints, walkNodes } from './glb.js';
import { classifyMover } from './movers.js';

// 반환: 가장 바깥 운동 그룹만 [{ name, index, kind, plan, parts:[이름], nodes:[부품 노드 index] }]. plan 의 부품 번호 i 는 nodes[i] 다.
export function scanGlb(json, bin, { cap = 4000 } = {}) {
  const nodes = walkNodes(json);
  const kids = new Map();
  for (const n of nodes) {
    if (!kids.has(n.parent)) kids.set(n.parent, []);
    kids.get(n.parent).push(n);
  }
  const raw = [];
  for (const n of nodes) {
    if (n.node.mesh != null) continue;
    const objs = (kids.get(n.index) ?? []).filter((c) => c.node.mesh != null || kids.has(c.index));
    if (objs.length < 3) continue;
    const plan = classifyMover(objs.map((o) => ({ name: o.name, points: subtreePoints(json, bin, nodes, o.index, { cap }) })));
    if (plan.kind !== 'none') raw.push({ name: n.name, index: n.index, kind: plan.kind, plan, parts: objs.map((o) => o.name), nodes: objs.map((o) => o.index) });
  }
  const parent = new Map(nodes.map((n) => [n.index, n.parent]));
  const under = (anc, i) => { for (let p = parent.get(i); p != null && p >= 0; p = parent.get(p)) if (p === anc) return true; return false; };
  return raw.filter((a) => !raw.some((b) => b !== a && under(a.index, b.index)));
}
