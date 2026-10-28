// 좌·우 패널·장비 모니터가 하단 리모컨과 겹치지 않고, 셀 패널 접힘에 맞춰 Detail 이 왼쪽으로 붙는지.
import { readFile } from 'node:fs/promises';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

console.log('ui-layout');
const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const ui = await readFile(new URL('../js/ui/ui.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const one = (s) => s.replace(/\s+/g, ' ');

check('독 높이 변수', /--dock-h:\s*84px/.test(css) && /html\.dock-closed/.test(css) && /--dock-h:\s*44px/.test(css));
check('좌우 패널 아래는 독 위', one(css).includes('bottom: calc(var(--bottom) + var(--dock-h))'));
check('Detail 은 셀 패널 오른쪽', css.includes('--detail-left: calc(var(--panel-gutter) + var(--panel-w) + var(--panel-gutter))') && one(css).includes('#detail { left: var(--detail-left)'));
check('셀 패널 접으면 Detail 왼쪽', /html\.cell-closed\s*\{[^}]*--detail-left:/.test(one(css)) && /@property --detail-left/.test(css) && /#detail \{[^}]*left:\s*var\(--detail-left\)/.test(one(css)));
check('Detail max-height 도 독 위', /#detail \{[^}]*max-height:[^;]*--dock-h/.test(one(css)));
check('독 숨기면 html.dock-closed', ui.includes("classList.toggle('dock-closed'"));
check('셀 패널 접으면 html.cell-closed', ui.includes("classList.toggle('cell-closed'"));
check('셀 패널 접으면 Detail style.left', ui.includes("d.style.left = closed"));
check('마크업 순서: 셀 패널 다음 Detail', html.indexOf('id="panelLeft"') < html.indexOf('id="detail"') && html.indexOf('id="detail"') < html.indexOf('id="footTools"'));
check('Detail 위치 초기화 버튼', html.includes('id="btnRecall"') && html.includes('위치 초기화') && ui.includes('onRecall') && css.includes('#btnRecall'));

console.log(`  ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
