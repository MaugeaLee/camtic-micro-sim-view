// DOM 패널. 상태를 주기적으로 읽어 그린다(풀 방식). 입력은 콜백으로 main 에 넘긴다.
import { SPEEDS } from '../core/env.js';

const $ = (id) => document.getElementById(id);

const fmtTime = (t) => {
  const s = Math.floor(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const amrDot = (a) => (a.battery < 30 ? 'low' : a.charging ? 'charge' : a.mode === 'park' && !a.steps.length ? '' : a.moving ? 'move' : 'wait');

export class UI {
  constructor({ onPlay, onSpeed, onSelect, onFollow, onScenario, onPlace, onDownload, onImport, onSave, onAdmin, onBuildMode, onDetailClose, onTrace, onTraceClose, onLabels } = {}) {
    this.cb = { onPlay, onSpeed, onSelect, onFollow, onScenario, onPlace, onDownload, onImport, onSave, onAdmin, onBuildMode, onDetailClose, onTrace, onTraceClose, onLabels };
    this.lastLog = 0;
    this.detail = { doc: null, tab: 'mon', hold: false };
    this.el = {
      play: $('btnPlay'), speed: $('speedSeg'), clock: $('clock'), cells: $('cellList'), log: $('logList'),
      status: $('statusLine'), build: $('buildBar'), place: $('placeSeg'), mode: $('buildMode'), hint: $('buildHint'),
      dl: $('btnLayoutDl'), up: $('btnLayoutUp'), save: $('btnLayoutSave'), file: $('layoutFile'), admin: $('btnAdmin'),
      scenario: $('scenarioSel'), fleet: $('fleetBox'), amrs: $('amrList'), fleetSum: $('fleetSum'), acs: $('acsLine'),
      trace: $('btnTrace'), labels: $('btnLabels'),
    };
    this.el.mode?.addEventListener('click', (e) => {
      const m = e.target.dataset?.mode;
      if (m) this.cb.onBuildMode?.(m);
    });
    this.el.save?.addEventListener('click', () => this.cb.onSave?.());

    this.el.play.addEventListener('click', () => this.cb.onPlay?.());
    this.el.speed.innerHTML = SPEEDS.map((x) => `<button data-speed="${x}">${x}×</button>`).join('');
    this.el.speed.addEventListener('click', (e) => {
      const x = Number(e.target.dataset?.speed);
      if (x) this.cb.onSpeed?.(x);
    });
    this.el.cells.addEventListener('click', (e) => {
      const part = e.target.closest('[data-equip]')?.dataset.equip;
      if (part) { this.cb.onFollow?.(part); return; }
      const id = e.target.closest('[data-cell]')?.dataset.cell;
      if (id) this.cb.onSelect?.(id);
    });
    this.el.amrs?.addEventListener('click', (e) => {
      const id = e.target.closest('[data-amr]')?.dataset.amr;
      if (id) this.cb.onFollow?.(id);
    });
    this.el.scenario?.addEventListener('change', () => this.cb.onScenario?.(this.el.scenario.value || null));
    this.el.place?.addEventListener('click', (e) => {
      const id = e.target.dataset?.place;
      if (id) this.cb.onPlace?.(id);
    });
    this.el.dl?.addEventListener('click', () => this.cb.onDownload?.());
    this.el.up?.addEventListener('click', () => this.el.file?.click());
    this.el.file?.addEventListener('change', () => {
      const f = this.el.file.files?.[0];
      this.el.file.value = '';
      if (f) this.cb.onImport?.(f);
    });
    this.el.admin?.addEventListener('click', () => this.cb.onAdmin?.());
    this.el.trace?.addEventListener('click', () => this.cb.onTrace?.());
    this.el.labels?.addEventListener('click', () => {
      const on = !this.el.labels.classList.contains('on');
      this.setLabels(on);
      this.cb.onLabels?.(on);
    });
    this.bindPanels();
    this.bindDetail();
    this.bindTrace();
  }

  // ── 장비 모니터: 상태 문서(data/monitor.js)를 표(모니터)와 원문(JSON)으로 ──
  bindDetail() {
    const D = (this.dt = { box: $('detail'), title: $('dtTitle'), state: $('dtState'), tabs: $('dtTabs'), sub: $('dtSub'), mon: $('dtMon'), json: $('dtJson'), pre: $('dtPre') });
    if (!D.box) return;
    $('dtClose')?.addEventListener('click', () => this.cb.onDetailClose?.());
    D.tabs.addEventListener('click', (e) => {
      const tab = e.target.dataset?.tab;
      if (!tab) return;
      this.detail.tab = tab;
      for (const b of D.tabs.children) b.classList.toggle('on', b.dataset.tab === tab);
      D.mon.hidden = tab !== 'mon';
      D.json.hidden = tab !== 'json';
      this.drawDetail();
    });
    D.json.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      const doc = this.detail.shown;
      if (!act || !doc) return;
      const text = `${pretty(doc)}\n`;
      if (act === 'copy') navigator.clipboard?.writeText(text).then(() => this.flash(e.target, '복사됨'), () => this.flash(e.target, '복사 실패'));
      if (act === 'download') {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = `${doc.id}-status-t${Math.round(doc.t)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      if (act === 'hold') {
        this.detail.hold = !this.detail.hold;
        e.target.classList.toggle('on', this.detail.hold);
        e.target.textContent = this.detail.hold ? '고정 풀기' : '고정';
        this.drawDetail();
      }
    });
  }

  flash(btn, text) {
    const was = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = was; }, 900);
  }

  // doc: equipmentStatus 결과. null 이면 닫는다.
  setDetail(doc) {
    const D = this.dt;
    if (!D?.box) return;
    const prev = this.detail.doc?.id;
    this.detail.doc = doc;
    D.box.hidden = !doc;
    if (!doc) { this.detail.shown = null; return; }
    if (prev !== doc.id && this.detail.hold) {
      this.detail.hold = false;
      const b = D.json.querySelector('[data-act="hold"]');
      if (b) { b.classList.remove('on'); b.textContent = '고정'; }
    }
    this.drawDetail();
  }

  drawDetail() {
    const D = this.dt, doc = this.detail.doc;
    if (!doc) return;
    if (!this.detail.hold || this.detail.shown?.id !== doc.id) this.detail.shown = doc;
    const d = this.detail.shown;
    D.title.textContent = d.id;
    D.state.textContent = d.state;
    D.state.className = `st st-${String(d.state).toLowerCase()}`;
    D.sub.textContent = `${d.name} · ${KIND[d.kind] ?? d.kind} · 시뮬 ${fmtTime(d.t)}${this.detail.hold ? ' · 고정' : ''}`;
    if (this.detail.tab === 'json') {
      const text = pretty(d);
      if (D.pre.textContent !== text) D.pre.textContent = text;
      return;
    }
    D.mon.innerHTML = [processHtml(d), robotsHtml(d.robots), signalsHtml(d.signals)].join('');
  }

  // ── 공정 추적: 키트 하나 타임라인 + JSON 리포트 ──
  bindTrace() {
    const T = (this.tr = { box: $('trace'), title: $('trTitle'), state: $('trState'), tabs: $('trTabs'), sub: $('trSub'), live: $('trLive'), json: $('trJson'), pre: $('trPre') });
    this.trace = { doc: null, tab: 'live', open: false };
    if (!T.box) return;
    $('trClose')?.addEventListener('click', () => this.cb.onTraceClose?.());
    T.tabs.addEventListener('click', (e) => {
      const tab = e.target.dataset?.tab;
      if (!tab) return;
      this.trace.tab = tab;
      for (const b of T.tabs.children) b.classList.toggle('on', b.dataset.tab === tab);
      T.live.hidden = tab !== 'live';
      T.json.hidden = tab !== 'json';
      this.drawTrace();
    });
    T.json.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      const doc = this.trace.doc;
      if (!act || !doc || doc.mode === 'off') return;
      const text = `${pretty(doc)}\n`;
      if (act === 'copy') navigator.clipboard?.writeText(text).then(() => this.flash(e.target, '복사됨'), () => this.flash(e.target, '복사 실패'));
      if (act === 'download') {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = `process-trace-kit${doc.kit ?? 'x'}-t${Math.round(doc.t ?? 0)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    });
  }

  // doc: ProcessTrace.view(). null/off 이면 닫는다. 대기·추적·완료는 연다.
  setTrace(doc) {
    const T = this.tr;
    if (!T?.box) return;
    this.trace.doc = doc;
    const on = !!(doc && doc.mode && doc.mode !== 'off');
    const wasOpen = this.trace.open;
    this.trace.open = on;
    T.box.hidden = !on;
    if (!on) this.drawBanner(null);
    if (on && !wasOpen) {
      const panel = document.getElementById('panelRight');
      panel?.classList.remove('closed');
      panel?.querySelector('.panel-toggle')?.setAttribute('aria-expanded', 'true');
    }
    if (this.el.trace) {
      this.el.trace.classList.toggle('on', doc?.mode === 'wait' || doc?.mode === 'run');
      this.el.trace.classList.toggle('done', doc?.mode === 'done');
      this.el.trace.textContent = doc?.mode === 'wait' ? '추적 대기' : doc?.mode === 'run' ? '추적 중' : doc?.mode === 'done' ? '리포트' : '공정 추적';
    }
    if (!on) return;
    this.drawTrace();
  }

  drawTrace() {
    const T = this.tr, d = this.trace.doc;
    if (!d || !T) return;
    const MODE = { wait: '대기', run: '추적', done: d.ok ? '완료' : '중단' };
    T.title.textContent = d.kit ? `키트 #${d.no ?? d.kit}` : '공정 추적';
    T.state.textContent = MODE[d.mode] ?? d.mode;
    T.state.className = `st st-${d.mode === 'done' ? (d.ok ? 'busy' : 'down') : d.mode === 'run' ? 'job' : 'idle'}`;
    const el = d.elapsed != null ? `${d.elapsed} s` : '—';
    T.sub.textContent = d.mode === 'wait'
      ? '다음 입고 도어트림을 기다리는 중 · 가정 공정'
      : `시뮬 ${fmtTime(d.t)} · 체류 ${el}${d.wait != null ? ` · 대기 ${d.wait} s` : ''}${d.mode === 'done' && d.ok === false ? ` · ${d.why ?? '순서 어긋남'}` : ''}`;
    this.drawBanner(d);
    if (this.trace.tab === 'json') {
      const text = pretty(d);
      if (T.pre.textContent !== text) T.pre.textContent = text;
      return;
    }
    T.live.innerHTML = traceHtml(d);
  }

  // 추적 중(대기·진행)만 화면 중앙 상단. 공정 이름 + 한 줄.
  drawBanner(doc) {
    const B = this.bn ?? (this.bn = { box: $('traceBanner'), title: $('tbTitle'), detail: $('tbDetail') });
    if (!B.box) return;
    const show = doc?.mode === 'wait' || doc?.mode === 'run';
    B.box.hidden = !show;
    if (!show) return;
    const b = doc.banner ?? { title: '공정 추적', detail: '' };
    B.title.textContent = b.title ?? '공정 추적';
    B.detail.textContent = b.detail ?? '';
    B.detail.hidden = !b.detail;
  }

  bindPanels() {
    for (const p of document.querySelectorAll('.panel:not(.preview-tree)')) {
      const btn = p.querySelector(':scope > .panel-head .panel-toggle');
      if (!btn) continue;
      const name = p.classList.contains('left') ? '셀 패널' : '로그 패널';
      const apply = (closed) => {
        p.classList.toggle('closed', closed);
        btn.setAttribute('aria-expanded', String(!closed));
        const title = closed ? `${name} 열기` : `${name} 접기`;
        btn.title = title;
        btn.setAttribute('aria-label', title);
      };
      apply(p.classList.contains('closed'));
      btn.addEventListener('click', () => apply(!p.classList.contains('closed')));
      p.addEventListener('click', (e) => {
        if (!p.classList.contains('closed') || e.target.closest('.panel-toggle')) return;
        apply(false);
      });
    }
  }

  // options: [{key,label}] — key '' 는 시나리오 없음
  setScenarios(options, current) {
    if (!this.el.scenario) return;
    this.el.scenario.innerHTML = options.map((o) => `<option value="${o.key}">${o.label}</option>`).join('');
    this.el.scenario.value = current ?? '';
  }

  setAdmin(on, cells = [], mode = 'cells') {
    this.el.admin?.classList.toggle('on', on);
    if (!this.el.build) return;
    this.el.build.hidden = !on;
    if (!on) return;
    for (const b of this.el.mode?.children ?? []) b.classList.toggle('on', b.dataset.mode === mode);
    const route = mode === 'route' || mode === 'parts';
    this.el.place.hidden = route;
    this.el.place.innerHTML = route ? '' : [
      ...cells.map((c) => `<button type="button" data-place="${c.id}">${c.id}</button>`),
      '<button type="button" data-place="OUT">OUT</button>',
      '<button type="button" data-place="PARTS">PARTS</button>',
      '<button type="button" data-place="STORE">STORE</button>',
      '<button type="button" data-place="RAIL:OUT">레일</button>',
    ].join('');
    if (this.el.hint) {
      const keys = '끌기 = 옮기기 · <b>Shift</b>+바닥 = 노드 추가(선택 노드와 연결) · <b>Shift</b>+노드 = 선택 노드와 간선(없음→양방향→단방향) · <b>Ctrl</b>+바닥 = 충전 자리 · <b>Del</b> = 지우기 · <b>X</b> = 셀 출구';
      this.el.hint.innerHTML = mode === 'parts'
        ? `부품 운송 AMR: 큰 주황 = 도킹 자리(창고 PARTS · SORT 투입 SORT:IN · 라인 도크 PRESS/SCREW:Lnn), 초록 = 입구. SORT 레인 칸은 도어트림과 같은 칸이다. ${keys}`
        : route ? keys : '좌클릭 집기·놓기 · 노란 레일 몸통 = 옮기기 · 끝점 = 늘리기/줄이기 · R 90°';
    }
  }

  reset(state) {
    this.lastLog = 0;
    this.el.log.innerHTML = '';
    this.setTrace(null);
    this.update(state);
  }

  update(state) {
    this.el.clock.textContent = fmtTime(state.time);
    this.el.play.textContent = state.running ? '일시정지' : '재생';
    for (const b of this.el.speed.children) b.classList.toggle('on', Number(b.dataset.speed) === state.speed);

    const units = state.plant?.units;
    const parent = state.equipOf?.(state.followed)?.cell ?? null;
    this.el.cells.innerHTML = state.cells.flatMap((c) => {
      const u = units?.[c.id];
      const extra = u ? (u.role === 'source' ? `키트 ${state.plant.kits.length}` : `재고 ${u.stock}`) : (c.loaded ? '모델' : '—');
      const on = c.id === state.selected || c.id === parent;
      const kids = (state.equip ?? []).filter((e) => e.cell === c.id).map((e) => partRow(state, e));
      return [`
      <li data-cell="${c.id}" class="cell ${on ? 'on' : ''}">
        <b>${c.id}</b><span>${c.label}</span><i class="st st-${c.state.toLowerCase()}">${c.state}</i><em>${extra}</em>
      </li>`, ...kids];
    }).join('');

    if (this.el.fleet) {
      const amrs = state.amrs;
      this.el.fleet.hidden = !state.plant;
      if (state.plant) {
        this.el.fleetSum.textContent = `${amrs.length}대 · 배송 ${state.plant.delivered}`;
        if (this.el.acs && state.acs) {
          const s = state.acs.summary();
          const locks = Object.entries(s.locks).map(([id, L]) => `${id} ${L.inside.length}/${state.acs.locks[id].cap}${L.line.length ? `+${L.line.length}` : ''}`).join(' · ');
          this.el.acs.textContent = `ACS 미션 대기 ${s.queue} · ${locks}${s.issues.length ? ` · 경로 점검 ${s.issues.length}건` : ''}`;
        }
        const robots = robotRows(state);
        this.el.amrs.innerHTML = robots + amrs.map((a) => `
          <li data-amr="${a.id}" class="${a.id === state.followed ? 'on' : ''}">
            <b><span class="dot ${amrDot(a)}"></span>${a.id.replace(/^AMR-/, '').replace(/^P-AMR-/, 'P')}</b>
            <span class="task">${a.off ? '운휴(충전 자리 없음)' : `${a.load ? `<i>#${a.load.id}→${a.load.dest ?? '대기'}</i> ` : ''}${a.task}`}</span>
            <span class="batt ${a.battery < 30 ? 'low' : ''}"><span style="width:${a.battery.toFixed(0)}%"></span><em>${a.battery.toFixed(0)}%</em></span>
          </li>`).join('');
      }
    }

    const fresh = state.logs.filter((l) => l.id > this.lastLog);
    if (fresh.length) {
      this.lastLog = fresh[0].id;
      const rows = fresh.reverse().map((l) => `<li class="lv-${l.level}"><time>${fmtTime(l.t)}</time>${l.title}${l.obs ? ` — ${l.obs}` : ''}</li>`).join('');
      this.el.log.insertAdjacentHTML('afterbegin', rows);
      while (this.el.log.children.length > 80) this.el.log.lastElementChild.remove();
    }
  }

  setStatus(text) { this.el.status.textContent = text; }

  setLabels(on) {
    if (!this.el.labels) return;
    this.el.labels.classList.toggle('on', !!on);
    this.el.labels.title = on ? '셀 머리 위 라벨 숨기기' : '셀 머리 위 라벨 표시';
  }
}

const ROLE = { recover: '견마·복구', inspect: '견마·점검', process: '드론·검사', stock: '드론·실사' };

const KIND = { cell: '셀', amr: 'AMR', hound: '견마', drone: '드론', arm: '로봇', gantry: '직교이송', lift: '리프트', body: '몸통' };
const PART_KIND = { arm: '로봇', gantry: '직교', lift: '리프트', body: '몸통' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;
// 들여쓴 JSON. 숫자·문자열만 든 배열(TCP·관절·공정 순서)은 한 줄로.
const pretty = (doc) => JSON.stringify(doc, null, 2).replace(/\[\s+((?:-?[\d.e+-]+|null|"[^"\n]*")(?:,\s+(?:-?[\d.e+-]+|null|"[^"\n]*"))*)\s+\]/g, (_, xs) => `[${xs.replace(/,\s+/g, ', ')}]`);

function traceHtml(d) {
  const want = d.expected ?? [];
  const seen = d.visits ?? [];
  const now = d.stages?.at(-1)?.key;
  const path = want.length
    ? `<p class="tr-path">${want.map((id, i) => {
      const got = seen[i] === id;
      const cls = d.mode === 'done' ? (got ? 'ok' : 'bad') : (seen[i] === id ? (i === seen.length - 1 ? 'now' : 'ok') : '');
      return `<b class="${cls}">${esc(id)}</b>`;
    }).join(' → ')}</p>`
    : '';
  if (d.mode === 'wait') return `${path}<p class="dt-none">다음 입고가 시작되면 그 공정 단위의 핵심 장비를 따라갑니다</p>`;
  const rows = (d.stages ?? []).map((st, i, all) => {
    const last = i === all.length - 1 && d.mode === 'run';
    const cls = last ? 'now' : 'done';
    const who = st.equip?.label ?? st.holder;
    return `<li class="${cls}"><span class="dot"></span><span><b>${esc(st.label)}</b> <em>${esc(who)}</em></span><time>${st.dur ? `${st.dur}s` : fmtTime(st.t)}</time></li>`;
  }).join('');
  const faults = d.faults?.length ? `<p class="dt-warn">고장 ${d.faults.map((f) => `${esc(f.cell)} ${esc(f.why)}`).join(' · ')}</p>` : '';
  const head = `<div class="dt-sec"><h3>공정 순서 <small>${d.ok === true ? '맞음' : d.ok === false ? '어긋남' : now ?? '—'}</small></h3>${path}</div>`;
  return `${head}<ol class="tr-tl">${rows || '<li class="dt-none">단계 없음</li>'}</ol>${faults}`;
}

function processHtml(d) {
  const P = d.process;
  if (!P) return '<div class="dt-sec"><h3>공정</h3><p class="dt-none">공정 정보 없음</p></div>';
  const rows = [];
  if (P.phaseLabel) rows.push(['리프트', P.phaseLabel]);
  if (P.visit) rows.push(['방문', `${P.visit.pass + 1}/${P.visit.of}`]);
  if (P.visit && P.route && P.visit.route != null) rows.push(['공정 순서', P.route.map((id, i) => (i === P.visit.route ? `<u>${id}</u>` : id)).join(' → ')]);
  if (P.kit) rows.push(['작업물', P.kit]);
  if (P.standard != null && P.kit) rows.push(['남은 표준 시간', `${P.remaining} s / ${P.standard} s`]);
  if (P.onLift != null) rows.push(['리프트 위 경과', `${P.onLift} s`]);
  if (P.total != null) rows.push(['작업 시간', `${P.elapsed} / ${P.total} s`]);
  if (P.rack?.length) rows.push(['랙', P.rack.map((r) => `<span class="dt-slot ${r.kit ? 'on' : ''}">${r.kit ?? '—'}</span>`).join('')]);
  if (P.loaded != null) rows.push(['적재 · 하역 누적', `${P.loaded} · ${P.unloaded}`]);
  if (P.mission) {
    const M = P.mission, tag = M.tag && M.tag !== M.from ? `${M.tag} · ` : '';
    rows.push(['미션', esc(`${tag}${M.from ?? '충전 자리'} → ${M.dest ?? '배정 전'}`)]);
  }
  if (P.load) rows.push(['적재물', `${esc(P.load.id)}${P.load.dest ? ` → ${esc(P.load.dest)}` : ''}`]);
  if (P.at) rows.push(['위치 기준', esc(P.at.kind === 'cell' ? `셀 ${P.at.id}` : P.at.kind === 'home' ? `충전 자리 ${P.at.i + 1}` : P.at.kind)]);
  if (P.job) rows.push(['임무', esc([P.job.kind, P.job.cell ?? P.job.ids?.join(' · ')].filter(Boolean).join(' · '))]);
  if (P.waiting?.length) rows.push(['시작 대기', `<span class="dt-warn">${P.waiting.map(esc).join(' · ')}</span>`]);
  const bar = P.progress != null && (P.kit || P.total != null) ? `<div class="dt-bar"><i style="width:${pct(P.progress)}"></i><em>${pct(P.progress)}</em></div>` : '';
  const steps = P.steps?.length ? `<ol class="dt-steps">${P.steps.map((s) => `<li>${s.ops.map((o) => `<span class="dt-op op-${o.state}" title="${esc(o.robot ?? '')} · ${o.time} s">${o.robot ? `<b>${esc(o.robot)}</b> ` : ''}${esc(o.label)}<em>${o.state === 'done' ? '완료' : o.state === 'wait' ? '대기' : `${o.elapsed}/${o.time}s`}</em></span>`).join('')}</li>`).join('')}</ol>` : '';
  return `<div class="dt-sec"><h3>공정 <small>${esc(P.label ?? '—')}</small></h3>${bar}<div class="dt-grid">${rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>${steps}</div>`;
}

function robotsHtml(list) {
  if (!list?.length) return '';
  const tcp = (p) => (p ? p.join(', ') : '—');
  return `<div class="dt-sec"><h3>로봇 <small>TCP 셀 로컬 mm · 관절 deg</small></h3><table class="dt-tab"><thead><tr><th></th><th>작업</th><th>TCP</th><th>레일</th></tr></thead><tbody>${list.map((r) => `
    <tr class="${r.busy ? 'on' : ''}" title="${r.joints ? `관절 ${r.joints.join(' · ')}` : '기구 미연결(셀 모델 없음)'}"><td><span class="dot ${r.busy ? 'move' : ''}"></span>${esc(r.name)}</td><td>${esc(r.op ?? '대기')}</td><td class="num">${tcp(r.tcp)}</td><td class="num">${r.rail ?? '—'}</td></tr>`).join('')}</tbody></table></div>`;
}

function sigValue(s) {
  if (s.type === 'bool') return `<i class="dt-led ${s.value ? 'on' : ''}"></i>${s.value ? 'ON' : 'OFF'}`;
  if (s.value === null || s.value === '') return '<span class="dt-none">—</span>';
  return `${esc(s.value)}${s.unit ? ` <small>${esc(s.unit)}</small>` : ''}`;
}

function signalsHtml(list) {
  if (!list?.length) return '';
  const groups = [];
  for (const s of list) {
    if (groups.at(-1)?.name !== s.group) groups.push({ name: s.group, items: [] });
    groups.at(-1).items.push(s);
  }
  return `<div class="dt-sec"><h3>신호 <small>${list.length}개</small></h3>${groups.map((g) => `
    <div class="dt-group">${esc(g.name)}</div><table class="dt-sig"><tbody>${g.items.map((s) => `<tr><td>${esc(s.label)}<small>${esc(s.id)}</small></td><td class="num">${sigValue(s)}</td></tr>`).join('')}</tbody></table>`).join('')}</div>`;
}

function partRow(state, e) {
  const down = state.cell(e.cell)?.state === 'DOWN';
  const cw = state.plant?.work?.[e.cell];
  let busy = false, label = PART_KIND[e.kind] ?? e.kind;
  if (e.kind === 'arm') {
    const list = Array.isArray(cw?.robots) ? cw.robots : Object.values(cw?.robots ?? {});
    const r = list.find((x) => x.name === e.name);
    busy = !!(r?.op || (Array.isArray(cw?.robots) && cw?.op));
    label = r?.label ?? '대기';
  } else if (e.kind === 'gantry') {
    const L = cw?.lines?.find((x) => x.id === e.name);
    busy = !!L?.gantry?.op;
    label = L?.part ?? '직교이송';
  } else if (e.kind === 'lift') {
    const ph = cw?.lift?.phase;
    busy = !!(ph && ph !== 'empty');
    label = ({ empty: '빈 리프트', rise: '올림', work: '작업 중', done: '반출 대기', lower: '내림' })[ph] ?? '리프트';
  } else if (e.kind === 'body') {
    busy = !!cw?.op;
    label = '몸통';
  }
  const st = down ? 'DOWN' : busy ? 'BUSY' : 'IDLE';
  return `
      <li data-equip="${e.id}" class="part ${e.id === state.followed ? 'on' : ''}">
        <b>${e.name}</b><span>${label}</span><i class="st st-${st.toLowerCase()}">${st}</i>
      </li>`;
}

function robotDot(r) {
  if (r.mode === 'nudge' || r.job?.kind === 'fault') return 'low';
  if (r.mode === 'charge' || r.mode === 'idle') return 'charge';
  return r.mode === 'patrol' && r.role === 'recover' ? 'charge' : 'move';
}

function robotRows(state) {
  const P = state.plant;
  const list = [P.hound?.view(), P.inspector?.view(), ...(P.drones?.view().drones ?? [])].filter(Boolean);
  return list.map((r) => {
    const extra = r.role === 'recover' ? `<em>감지 ${r.seen} · 해소 ${r.fixed}</em>`
      : `<span style="width:${r.battery.toFixed(0)}%"></span><em>${r.battery.toFixed(0)}%</em>`;
    const job = r.role === 'recover' && r.job ? ` · ${r.job.ids.join(' · ')}` : '';
    return `
          <li data-amr="${r.id}" class="${r.id === state.followed ? 'on' : ''}" title="${ROLE[r.role] ?? ''}">
            <b><span class="dot ${robotDot(r)}"></span>${r.id.replace(/^HOUND-/, 'H').replace(/^DRONE-/, 'D')}</b>
            <span class="task"><i>${ROLE[r.role] ?? ''}</i> ${r.task}${job}</span>
            <span class="batt ${r.role !== 'recover' && r.battery < 30 ? 'low' : ''}">${extra}</span>
          </li>`;
  }).join('');
}
