// OpenAPI 스펙을 읽어 GET을 실행한다. 메인 뷰어와 분리.
import { runtime, apiPath } from '../core/runtime.js';

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const kid of kids) node.append(kid);
  return node;
}

function fillPath(path, values) {
  return path.replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(values[name] ?? ''));
}

function buildUrl(path, specParams, values) {
  const q = new URLSearchParams();
  for (const p of specParams) {
    const v = values[p.name];
    if (p.in === 'query' && v) q.set(p.name, v);
  }
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

function paramRow(p) {
  const input = el(p.schema?.enum ? 'select' : 'input', {
    name: p.name,
    placeholder: p.schema?.example ?? p.example ?? p.name,
  });
  if (p.schema?.enum) {
    input.append(el('option', { value: '', text: '' }));
    for (const v of p.schema.enum) input.append(el('option', { value: v, text: v }));
  }
  if (p.example) input.value = p.example;
  const row = el('tr', {}, [
    el('td', {}, [
      el('code', { text: p.name }),
      p.required ? el('span', { class: 'req', text: ' *' }) : '',
    ]),
    el('td', { text: p.in }),
    el('td', {}, [input]),
    el('td', { text: p.description || '' }),
  ]);
  return { row, input, param: p };
}

function renderOp(path, method, op) {
  const verb = method.toUpperCase();
  const params = op.parameters || [];
  const fields = params.map(paramRow);
  const out = el('pre', { class: 'out', text: '' });
  const status = el('div', { class: 'out-h', text: '' });

  async function run() {
    const values = {};
    for (const f of fields) values[f.param.name] = f.input.value.trim();
    const url = buildUrl(fillPath(path, values), params, values);
    status.textContent = '실행 중…';
    out.textContent = '';
    try {
      const res = await fetch(url, { headers: { accept: 'application/json, text/html;q=0.8, */*;q=0.5' } });
      const ct = res.headers.get('content-type') || '';
      const text = await res.text();
      status.textContent = `${res.status} ${res.statusText} · ${ct || 'no content-type'} · ${url}`;
      if (ct.includes('json')) {
        try { out.textContent = JSON.stringify(JSON.parse(text), null, 2); }
        catch { out.textContent = text; }
      } else out.textContent = text.slice(0, 4000);
    } catch (err) {
      status.textContent = '실패';
      out.textContent = String(err);
    }
  }

  const bodyKids = [];
  if (params.length) {
    const table = el('table', { class: 'params' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: '이름' }), el('th', { text: '위치' }),
        el('th', { text: '값' }), el('th', { text: '설명' }),
      ])]),
      el('tbody', {}, fields.map((f) => f.row)),
    ]);
    bodyKids.push(table);
  }
  bodyKids.push(el('button', { type: 'button', text: '실행', onclick: run }));
  bodyKids.push(status, out);

  const box = el('details', { class: 'op' }, [
    el('summary', {}, [
      el('span', { class: `verb verb-${method}`, text: verb }),
      el('span', { class: 'path', text: path }),
      el('span', { class: 'sum', text: op.summary || '' }),
    ]),
    el('div', { class: 'op-body' }, bodyKids),
  ]);
  return { tag: (op.tags && op.tags[0]) || 'api', node: box };
}

async function boot() {
  const specUrl = apiPath('openapi', runtime());
  if (!specUrl) {
    $('meta').textContent = 'window.__ENV.api.openapi 없음. npm start 로 연다.';
    return;
  }
  $('meta').replaceChildren(document.createTextNode('스펙 '), el('code', { text: specUrl }));
  const res = await fetch(specUrl);
  if (!res.ok) {
    $('info').textContent = `스펙 ${res.status}`;
    return;
  }
  const spec = await res.json();
  $('info').textContent = spec.info?.description || '';
  document.title = `${spec.info?.title || 'API'} · Swagger`;

  const groups = new Map();
  for (const [path, item] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(item)) {
      if (method.startsWith('x-') || !op || typeof op !== 'object') continue;
      const { tag, node } = renderOp(path, method, op);
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push(node);
    }
  }
  const root = $('ops');
  for (const [tag, nodes] of groups) {
    root.append(el('div', { class: 'tag', text: tag }));
    for (const n of nodes) root.append(n);
  }
}

boot().catch((err) => { $('info').textContent = String(err); });
