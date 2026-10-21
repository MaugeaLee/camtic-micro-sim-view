// GLB 트리 직렬화·HTML. three 없이 가짜 노드로 판정.
import { toTree, countNodes, findNode, findObject, objectToId, ancestorIds, renderTreeHtml, esc } from '../js/assets/tree.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('tree');
const scene = {
  name: 'PRESS', type: 'Group',
  children: [
    { name: '00_Floor', type: 'Mesh', isMesh: true, children: [] },
    {
      name: 'Boundary', type: 'Group',
      children: [
        { name: 'Post_002', type: 'Mesh', isMesh: true, children: [] },
        { name: '<rail>', type: 'Mesh', isMesh: true, children: [] },
      ],
    },
  ],
};

const tree = toTree(scene);
check('루트 id', tree.id === '0' && tree.name === 'PRESS');
check('자식 경로', tree.children[1].children[0].id === '0.1.0' && tree.children[1].children[0].name === 'Post_002');
check('메시 표시', tree.children[0].mesh && !tree.mesh);
check('노드 수', countNodes(tree) === 5);
check('findNode', findNode(tree, '0.1.1').name === '<rail>');
check('findObject', findObject(scene, '0.1.0').name === 'Post_002');
check('objectToId', objectToId(scene, scene.children[1].children[1]) === '0.1.1');
check('없는 오브젝트', objectToId(scene, { name: 'x' }) === null);
check('ancestorIds', ancestorIds('0.1.1').join() === '0,0.1,0.1.1');

const html = renderTreeHtml(tree);
check('HTML 이스케이프', html.includes('&lt;rail&gt;') && !html.includes('<rail>'));
check('루트 펼침', html.startsWith('<details open>'));
check('data-id', html.includes('data-id="0.1.0"') && html.includes('Post_002'));
check('이름 없는 노드', toTree({ type: 'Object3D', children: [] }).name === '(unnamed)');
check('esc', esc(`a&b<"'>`) === 'a&amp;b&lt;&quot;&#39;&gt;');

console.log(`  ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
