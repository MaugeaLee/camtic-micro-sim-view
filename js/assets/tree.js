// GLB 씬 그래프 → 조회용 트리. DOM·three 없음. name/type/children 만 본다.

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export function toTree(obj, id = '0') {
  return {
    id,
    name: obj.name || '(unnamed)',
    type: obj.type || 'Object3D',
    mesh: !!(obj.isMesh || obj.type === 'Mesh'),
    children: (obj.children || []).map((c, i) => toTree(c, `${id}.${i}`)),
  };
}

export function countNodes(node) {
  return 1 + (node.children || []).reduce((n, c) => n + countNodes(c), 0);
}

export function findNode(node, id) {
  if (node.id === id) return node;
  for (const c of node.children || []) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

export function findObject(obj, id, cur = '0') {
  if (cur === id) return obj;
  const kids = obj.children || [];
  for (let i = 0; i < kids.length; i++) {
    const hit = findObject(kids[i], id, `${cur}.${i}`);
    if (hit) return hit;
  }
  return null;
}

export function objectToId(root, target, cur = '0') {
  if (root === target) return cur;
  const kids = root.children || [];
  for (let i = 0; i < kids.length; i++) {
    const hit = objectToId(kids[i], target, `${cur}.${i}`);
    if (hit) return hit;
  }
  return null;
}

export function ancestorIds(id) {
  if (!id) return [];
  const parts = String(id).split('.');
  return parts.map((_, i) => parts.slice(0, i + 1).join('.'));
}

export function renderTreeHtml(node) {
  const label = `<span class="nm${node.mesh ? ' mesh' : ''}">${esc(node.name)}</span><span class="kind">${esc(node.type)}</span>`;
  if (!node.children.length) {
    return `<div class="leaf" data-id="${esc(node.id)}">${label}</div>`;
  }
  const depth = node.id.split('.').length;
  const open = depth < 3 ? ' open' : '';
  return `<details${open}><summary data-id="${esc(node.id)}">${label}</summary>${node.children.map(renderTreeHtml).join('')}</details>`;
}
