// DOM 패널. 상태를 주기적으로 읽어 그린다(풀 방식). 입력은 콜백으로 main 에 넘긴다.
import { SPEEDS } from '../core/env.js';
import { labelEquip } from '../sim/equip.js';

const $ = (id) => document.getElementById(id);

const fmtTime = (t) => {
  const s = Math.floor(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const amrDot = (a) => (a.halt ? 'low' : a.battery < 30 ? 'low' : a.charging ? 'charge' : a.mode === 'park' && !a.steps.length ? '' : a.moving ? 'move' : 'wait');

export class UI {
  constructor({ onPlay, onSpeed, onSelect, onFollow, onScenario, onPlace, onDownload, onImport, onSave, onReset, onBuildMode, onDetailClose, onTrace, onTraceClose, onLabels, onInject, onClearIncident, onFleetSpeed, onFleetHalt, onCctv } = {}) {
    this.cb = { onPlay, onSpeed, onSelect, onFollow, onScenario, onPlace, onDownload, onImport, onSave, onReset, onBuildMode, onDetailClose, onTrace, onTraceClose, onLabels, onInject, onClearIncident, onFleetSpeed, onFleetHalt, onCctv };
    this.lastLog = 0;
    this.liveOff = false;
    this.detail = { doc: null, tab: 'mon', hold: false };
    this.el = {
      play: $('btnPlay'), speed: $('speedSeg'), clock: $('clock'), cells: $('cellList'), log: $('logList'),
      status: $('statusLine'), build: $('buildBar'), place: $('placeSeg'), mode: $('buildMode'), hint: $('buildHint'),
      dl: $('btnLayoutDl'), up: $('btnLayoutUp'), save: $('btnLayoutSave'), reset: $('btnPlantReset'), file: $('layoutFile'),
      scenario: $('scenarioSel'), fleet: $('fleetBox'), amrs: $('amrList'), fleetSum: $('fleetSum'), acs: $('acsLine'),
      trace: $('btnTrace'), labels: $('btnLabels'),
    };
    this.el.mode?.addEventListener('click', (e) => {
      const m = e.target.dataset?.mode;
      if (m) this.cb.onBuildMode?.(m);
    });
    this.el.save?.addEventListener('click', () => this.cb.onSave?.());
    this.el.reset?.addEventListener('click', () => this.cb.onReset?.());

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
    this.el.trace?.addEventListener('click', () => this.cb.onTrace?.());
    this.el.labels?.addEventListener('click', () => {
      const on = !this.el.labels.classList.contains('on');
      this.setLabels(on);
      this.cb.onLabels?.(on);
    });
    this.bindPanels();
    this.bindDetail();
    this.bindTrace();
    this.bindFoot();
  }

  // ── 하단 패널: 설비 고장 주입 · 자재 공급 차질 · 현장 이벤트 · AMR · CCTV · 리셋 ──
  // 카탈로그(사유·시간·배율)는 main 이 sim/incidents.js 에서 넘긴다(setCatalog). 입력 칸은 열 때만 그리고 목록만 주기적으로 다시 그린다.
  bindFoot() {
    const F = (this.ft = { tools: $('footTools'), box: $('footPanel'), title: $('fpTitle'), sub: $('fpSub'), icon: $('fpIcon'), form: $('fpForm'), list: $('fpList'), hint: $('fpHint'), coach: $('dockCoach'), hide: $('btnDockHide'), show: $('btnDockShow') });
    this.foot = { open: null, sig: '', dur: {}, mode: 'stop', cat: null, cctv: true, state: null, help: false, hidden: false };
    if (!F.tools || !F.box) return;
    F.tools.addEventListener('click', (e) => {
      if (e.target.closest('.dk')) this.setHelp(false);
      const k = e.target.closest('[data-foot]')?.dataset.foot;
      if (k) this.openFoot(this.foot.open === k ? null : k);
    });
    $('btnFootReset')?.addEventListener('click', () => this.cb.onReset?.());
    $('fpClose')?.addEventListener('click', () => this.openFoot(null));
    $('btnDockHelp')?.addEventListener('click', () => this.setHelp(!this.foot.help));
    $('dockCoachClose')?.addEventListener('click', () => this.setHelp(false));
    F.hide?.addEventListener('click', () => this.setDock(false));
    F.show?.addEventListener('click', () => this.setDock(true));
    addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.foot.open) this.openFoot(null);
      this.setHelp(false);
    });
    F.form.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.dur) {
        this.foot.dur[this.foot.open] = Number(b.dataset.dur);
        for (const x of b.parentElement.children) x.classList.toggle('on', x === b);
      } else if (b.dataset.mode) {
        this.foot.mode = b.dataset.mode;
        for (const x of b.parentElement.children) x.classList.toggle('on', x === b);
      } else if (b.dataset.act === 'inject') this.submitFoot();
    });
    F.form.addEventListener('change', (e) => {
      if (e.target.name === 'target' && this.foot.open === 'fault') this.fillWhy();
      if (e.target.name === 'type' && this.foot.open === 'event') this.syncEventCell();
    });
    F.list.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.clear) this.cb.onClearIncident?.(Number(b.dataset.clear));
      if (b.dataset.fleet && b.dataset.speed) this.cb.onFleetSpeed?.(b.dataset.fleet, Number(b.dataset.speed));
      if (b.dataset.fleet && b.dataset.halt) this.cb.onFleetHalt?.(b.dataset.fleet, b.dataset.halt === '1');
      if (b.dataset.cctv) this.cb.onCctv?.(b.dataset.cctv);
    });
  }

  setCatalog(cat) { this.foot.cat = cat; this.foot.sig = ''; }

  setCctv(on) {
    this.foot.cctv = !!on;
    this.ft?.tools?.querySelector('[data-foot="cctv"]')?.classList.toggle('on', !!on);
    if (this.foot.open === 'cctv' && this.foot.state) this.drawFoot(this.foot.state);
  }

  openFoot(kind) {
    const F = this.ft;
    if (!F?.box) return;
    this.foot.open = kind;
    this.foot.sig = '';
    F.box.hidden = !kind;
    for (const b of F.tools.querySelectorAll('[data-foot]')) b.classList.toggle('open', b.dataset.foot === kind);
    if (!kind) return;
    F.box.className = `foot-panel fp-${kind}`;
    F.icon.innerHTML = F.tools.querySelector(`[data-foot="${kind}"] .ic`)?.innerHTML ?? '';
    F.sub.textContent = FOOT_SUB[kind] ?? '';
    if (this.foot.state) this.drawFoot(this.foot.state);
  }

  setDock(on) {
    const F = this.ft;
    const hidden = !on;
    if (!F?.tools || this.foot.hidden === hidden) return;
    this.foot.hidden = hidden;
    if (hidden) {
      this.openFoot(null);
      this.setHelp(false);
    }
    F.tools.classList.toggle('closed', hidden);
    F.tools.setAttribute('aria-hidden', String(hidden));
    F.hide?.setAttribute('aria-expanded', String(!hidden));
    document.documentElement.classList.toggle('dock-closed', hidden);
    if (F.show) F.show.hidden = !hidden;
  }

  // 독 오른쪽 「?」로만 여는 사용 안내 말풍선. 열려 있는 동안 「설비 고장」 버튼에 물결. 독 버튼·닫기·Esc 로 닫힘.
  setHelp(on) {
    const F = this.ft;
    if (!F?.coach || this.foot.help === !!on) return;
    this.foot.help = !!on;
    F.coach.hidden = !on;
    const btn = $('btnDockHelp');
    btn?.classList.toggle('on', !!on);
    btn?.setAttribute('aria-expanded', String(!!on));
    F.tools.querySelector('[data-foot="fault"]')?.classList.toggle('hint-me', !!on);
  }

  // 대상 목록: 셀 · 셀 안 장비 · AMR(운휴 제외)
  footTargets(state) {
    const P = state.plant;
    if (!P) return { cells: [], equip: [], amrs: [] };
    return {
      cells: state.cells.filter((c) => P.units[c.id]).map((c) => ({ id: c.id, label: c.label })),
      equip: (state.equip ?? []).filter((e) => P.units[e.cell]),
      amrs: state.amrs.filter((a) => !a.off).map((a) => ({ id: a.id, fleet: a.id.startsWith('P-') ? 'parts' : 'trim' })),
    };
  }

  drawFoot(state) {
    const F = this.ft, k = this.foot.open, C = this.foot.cat;
    if (!F?.box || !k || !C) return;
    const T = this.footTargets(state);
    const sig = `${k}|${T.cells.map((c) => c.id)}|${T.equip.length}|${T.amrs.map((a) => a.id)}|${!!state.plant?.store}|${!!state.plant?.supply}`;
    if (sig !== this.foot.sig) {
      this.foot.sig = sig;
      F.title.textContent = FOOT_TITLE[k];
      F.form.innerHTML = this.footForm(k, T, state);
      F.hint.textContent = FOOT_HINT[k];
      if (k === 'fault') this.fillWhy();
      if (k === 'event') this.syncEventCell();
    }
    F.list.innerHTML = this.footList(k, state);
  }

  durSeg(kind) {
    const C = this.foot.cat, list = C.durations[kind];
    const cur = this.foot.dur[kind] ?? list[1];
    this.foot.dur[kind] = cur;
    return `<div class="seg">${list.map((s) => `<button type="button" data-dur="${s}" class="${s === cur ? 'on' : ''}">${s >= 60 ? `${s / 60}분` : `${s}초`}</button>`).join('')}</div>`;
  }

  footForm(k, T, state) {
    const C = this.foot.cat;
    if (!state.plant && k !== 'cctv') return '';
    if (k === 'fault') {
      const opt = (id, label, kind) => `<option value="${esc(id)}" data-kind="${kind}">${esc(label)}</option>`;
      const byCell = T.cells.map((c) => `<optgroup label="${esc(c.id)} 장비">${T.equip.filter((e) => e.cell === c.id).map((e) => opt(e.id, `${e.id} · ${PART_KIND[e.kind] ?? e.kind}`, e.kind)).join('')}</optgroup>`).join('');
      const amr = (f, label) => {
        const xs = T.amrs.filter((a) => a.fleet === f);
        return xs.length ? `<optgroup label="${label}">${xs.map((a) => opt(a.id, a.id, 'amr')).join('')}</optgroup>` : '';
      };
      return `<span>대상</span><select name="target"><optgroup label="셀 전체">${T.cells.map((c) => opt(c.id, `${c.id} · ${c.label}`, 'cell')).join('')}</optgroup>${byCell}${amr('trim', '메인 AMR')}${amr('parts', '서브 AMR')}</select>
        <span>사유</span><select name="why"></select>
        <span>시간</span>${this.durSeg('fault')}
        <button type="button" class="go" data-act="inject">고장 주입</button>`;
    }
    if (k === 'supply') {
      const has = { raw: !!state.plant.store, parts: !!state.plant.supply };
      const mode = this.foot.mode;
      return `<span>대상</span><select name="target">${Object.entries(C.supply).map(([id, s]) => `<option value="${id}" ${has[id] ? '' : 'disabled'}>${esc(s.label)}${has[id] ? '' : ' (없음)'}</option>`).join('')}</select>
        <span>방식</span><div class="seg">${Object.entries(C.supplyMode).map(([id, label]) => `<button type="button" data-mode="${id}" class="${id === mode ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>
        <span>시간</span>${this.durSeg('supply')}
        <button type="button" class="go" data-act="inject">공급 차질 적용</button>`;
    }
    if (k === 'event') {
      return `<span>종류</span><select name="type">${Object.entries(C.events).map(([id, ev]) => `<option value="${id}">${esc(ev.label)}</option>`).join('')}</select>
        <span>셀</span><select name="cell">${T.cells.map((c) => `<option value="${c.id}">${c.id} · ${esc(c.label)}</option>`).join('')}</select>
        <span>시간</span>${this.durSeg('event')}
        <button type="button" class="go" data-act="inject">이벤트 발생</button>`;
    }
    return '';
  }

  fillWhy() {
    const F = this.ft, sel = F.form.querySelector('select[name="target"]'), why = F.form.querySelector('select[name="why"]');
    if (!sel || !why) return;
    const kind = sel.selectedOptions[0]?.dataset.kind ?? 'cell';
    why.innerHTML = (this.foot.cat.faultWhy[kind] ?? this.foot.cat.faultWhy.cell).map((w) => `<option>${esc(w)}</option>`).join('');
  }

  syncEventCell() {
    const F = this.ft, type = F.form.querySelector('select[name="type"]')?.value, cell = F.form.querySelector('select[name="cell"]');
    if (cell) cell.disabled = !this.foot.cat.events[type]?.cell;
  }

  submitFoot() {
    const F = this.ft, k = this.foot.open, val = (n) => F.form.querySelector(`[name="${n}"]`);
    const dur = this.foot.dur[k];
    if (k === 'fault') {
      const opt = val('target')?.selectedOptions[0];
      if (!opt) return;
      const name = opt.dataset.kind === 'cell' || opt.dataset.kind === 'amr' ? '' : `${opt.value.split(':')[1]} `;
      this.cb.onInject?.({ kind: 'fault', target: opt.value, why: `${name}${val('why')?.value ?? ''}`, dur });
    }
    if (k === 'supply') this.cb.onInject?.({ kind: 'supply', target: val('target')?.value, mode: this.foot.mode, dur });
    if (k === 'event') {
      const type = val('type')?.value;
      this.cb.onInject?.({ kind: 'event', type, target: this.foot.cat.events[type]?.cell ? val('cell')?.value : null, dur });
    }
  }

  footList(k, state) {
    const C = this.foot.cat;
    if (k === 'cctv') {
      const on = this.foot.cctv;
      return `<div class="foot-fleet"><b>뒷벽 관제 모니터</b> <span class="stat">${on ? '켜짐 · 카메라 6대' : '꺼짐'}</span>
        <div class="row foot-cctv"><button type="button" class="primary" data-cctv="view">모니터 앞으로 이동</button><button type="button" data-cctv="toggle">${on ? '모니터 끄기' : '모니터 켜기'}</button></div></div>`;
    }
    if (!state.plant) return '<p class="none">시나리오 없음 — 공장이 돌 때만 쓸 수 있다</p>';
    const I = state.incidents, t = state.time;
    if (k === 'amr') {
      const rows = C.fleets.map((f) => {
        const amrs = state.fleet(f).amrs.filter((a) => !a.off);
        if (!amrs.length) return '';
        const sp = I.fleetSpeed(f, t), halted = I.fleetHalted(f, t), scale = I.fleetScale(f, t);
        const n = (fn) => amrs.filter(fn).length;
        const stopped = n((a) => a.halt);
        const stat = `<span class="pill">주행 ${n((a) => a.moving && !a.halt)}</span><span class="pill">대기 ${n((a) => !a.moving && !a.halt && !(a.mode === 'park' && a.idle))}</span><span class="pill">충전 자리 ${n((a) => a.mode === 'park' && a.idle && !a.halt)}</span><span class="pill ${stopped ? 'bad' : ''}">정지 ${stopped}</span>`;
        return `<div class="foot-fleet"><b>${esc(C.fleetLabel[f])}</b> <span class="stat">${amrs.length}대${scale !== sp ? ` · 실효 ×${scale}` : ''}</span>
          <div class="row stat">${stat}</div>
          <div class="row"><span>속도</span><div class="seg">${C.fleetSpeeds.map((x) => `<button type="button" data-fleet="${f}" data-speed="${x}" class="${x === sp ? 'on' : ''}">×${x}</button>`).join('')}</div>
          <button type="button" class="halt ${halted ? 'on' : ''}" data-fleet="${f}" data-halt="${halted ? '0' : '1'}">${halted ? '운행 재개' : '전체 정지'}</button></div></div>`;
      }).join('');
      const left = (x) => (x.end != null ? `${Math.max(0, Math.round(x.end - t))} s` : '');
      const aisle = I.active(t).filter((x) => x.kind === 'event' && x.type === 'aisle');
      const down = state.amrs.filter((a) => a.halt?.kind === 'fault');
      const list = aisle.length || down.length
        ? `<h3>정지</h3><ul>${aisle.map((x) => `<li><span><b>통로 통제 · 두 플릿 전체</b><small>${esc(x.why)}</small></span><time>${left(x)}</time><span></span></li>`).join('')}${down.map((a) => `<li><span><b>${a.id}</b><small>${esc(a.halt.why)}</small></span><time>${left(a.halt)}</time><span></span></li>`).join('')}</ul>`
        : '';
      return `${rows}${list}`;
    }
    const xs = I.view(t).filter((x) => x.kind === k);
    if (!xs.length) return `<h3>진행 중</h3><p class="none">${FOOT_EMPTY[k]}</p>`;
    const name = (x) => (k === 'supply' ? C.supply[x.target].label : k === 'event' ? `${C.events[x.type].label}${x.target ? ` ${x.target}` : ''}` : x.target);
    const verb = k === 'fault' ? '복구' : '해제';
    return `<h3>진행 중 ${xs.length}건</h3><ul>${xs.map((x) => `<li><span><b>${esc(name(x))}</b><small>${esc(x.why)}</small></span><time>${x.left != null ? `${Math.round(x.left)} s` : ''}</time><button type="button" data-clear="${x.no}">${verb}</button></li>`).join('')}</ul>`;
  }

  // 하단 버튼 뱃지(진행 중 건수)·사용 가능 여부
  drawFootTools(state) {
    const F = this.ft;
    if (!F?.tools) return;
    const live = state.incidents?.view(state.time) ?? [];
    const count = { fault: 0, supply: 0, event: 0, amr: 0 };
    for (const x of live) if (x.kind in count) count[x.kind]++;
    count.amr = state.amrs.filter((a) => a.halt).length;
    for (const b of F.tools.querySelectorAll('[data-foot]')) {
      const k = b.dataset.foot;
      if (k !== 'cctv') b.disabled = !state.plant;
      const i = b.querySelector('i');
      if (i) i.textContent = count[k] ? String(count[k]) : '';
      b.classList.toggle('live', !!count[k]);
    }
  }

  // ── 장비 모니터: 상태 문서(data/monitor.js)를 표(모니터)와 원문(JSON)으로 ──
  bindDetail() {
    const D = (this.dt = { box: $('detail'), title: $('dtTitle'), state: $('dtState'), tabs: $('dtTabs'), sub: $('dtSub'), live: $('dtLiveWrap'), cap: $('dtLiveCap'), wait: $('dtLiveWait'), mon: $('dtMon'), json: $('dtJson'), pre: $('dtPre') });
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
    if (!doc) { this.detail.shown = null; this.drawLive(null); return; }
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
    this.drawLive(d);
    if (this.detail.tab === 'json') {
      const text = pretty(d);
      if (D.pre.textContent !== text) D.pre.textContent = text;
      return;
    }
    D.mon.innerHTML = [processHtml(d), robotsHtml(d.robots), signalsHtml(d.signals)].join('');
  }

  // 온보드 캠이 있는 장비만 라이브 칸을 연다. 픽셀은 main 이 렌더 타깃에서 붙인다.
  drawLive(doc) {
    const D = this.dt;
    if (!D?.live) return;
    const cam = doc?.cam;
    D.live.hidden = !cam || this.liveOff;
    if (D.cap) D.cap.textContent = cam ? `라이브 · ${cam.label}` : '';
    if (D.live.hidden && D.wait) D.wait.hidden = true;
  }

  liveId() {
    if (!this.detail.doc?.cam || this.dt?.box?.hidden) return null;
    return this.detail.doc.id;
  }

  setLiveReady(ok) {
    const D = this.dt;
    if (!D?.wait || D.live?.hidden) return;
    D.wait.hidden = !!ok;
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
      const [title, sub] = TRACE_LABEL[doc?.mode] ?? TRACE_LABEL.off;
      const b = this.el.trace.querySelector('.tx b'), s = this.el.trace.querySelector('.tx small');
      const hint = doc?.mode === 'wait' && doc.waitWhy ? doc.waitWhy : sub;
      if (b) { b.textContent = title; if (s) s.textContent = hint; }
      else this.el.trace.textContent = title;
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
      ? `${d.waitWhy ?? '다음 입고 도어트림을 기다리는 중'} · 가정 공정`
      : `시뮬 ${fmtTime(d.t)} · 체류 ${el}${d.wait != null ? ` · 대기 ${d.wait} s` : ''}${d.waitWhy ? ` · ${d.waitWhy}` : ''}${d.mode === 'done' && d.ok === false ? ` · ${d.why ?? '순서 어긋남'}` : ''}`;
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
        if (p.classList.contains('left')) {
          document.documentElement.classList.toggle('cell-closed', closed);
          const d = document.getElementById('detail');
          if (d) d.style.left = closed ? 'calc(var(--panel-gutter) + var(--panel-tab) + var(--panel-gutter))' : '';
        }
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
    this.foot.state = state;
    this.drawFootTools(state);
    if (this.foot.open) this.drawFoot(state);
    this.el.clock.textContent = fmtTime(state.time);
    this.el.play.textContent = state.running ? '일시정지' : '재생';
    for (const b of this.el.speed.children) b.classList.toggle('on', Number(b.dataset.speed) === state.speed);

    const units = state.plant?.units;
    const parent = state.equipOf?.(state.followed)?.cell ?? null;
    this.el.cells.innerHTML = state.cells.flatMap((c) => {
      const u = units?.[c.id];
      const extra = u ? (u.role === 'source' ? `키트 ${state.plant.kits.length}` : `재고 ${u.stock}`) : (c.loaded ? '모델' : '—');
      const on = c.id === state.selected || c.id === parent;
      const kids = labelEquip(state.equip).filter((e) => e.cell === c.id).map((e) => partRow(state, e));
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
            <span class="task">${a.off ? '운휴(충전 자리 없음)' : a.halt ? `<i class="halt">정지</i> ${esc(a.halt.why)}` : `${a.load ? `<i>#${a.load.id}→${a.load.dest ?? '대기'}</i> ` : ''}${a.task}`}</span>
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
    const title = on ? '라벨 숨기기' : '라벨 보이기';
    this.el.labels.title = on ? '머리 위 라벨 숨기기' : '머리 위 라벨 보이기';
    const b = this.el.labels.querySelector('.tx b');
    if (b) b.textContent = title;
    else this.el.labels.textContent = title;
  }
}

const FOOT_TITLE = { fault: '설비 고장 주입', supply: '자재 공급 차질', event: '현장 이벤트', amr: 'AMR 플릿', cctv: 'CCTV · 관제 모니터' };
const FOOT_SUB = {
  fault: '멈출 대상을 고르면 그 자리에서 정지합니다',
  supply: '창고 입고·출고를 끊거나 늦춥니다',
  event: '현장에서 생기는 돌발 상황을 일으킵니다',
  amr: '플릿 속도를 바꾸거나 전체를 세웁니다',
  cctv: '내부 카메라 6대를 뒷벽 화면으로 봅니다',
};
const FOOT_EMPTY = {
  fault: '아직 없어요. 대상을 골라 「고장 주입」을 눌러 보세요 — 드론이 출동하고 AMR 이 기다립니다',
  supply: '아직 없어요. 「원재료 입고 · 중단」을 걸면 SORT 랙이 비어 가는 모습을 볼 수 있어요',
  event: '아직 없어요. 「통로 통제」를 걸면 모든 AMR 이 그 자리에 섭니다',
};
const TRACE_LABEL = {
  wait: ['추적 대기', '다음 입고를 기다림'],
  run: ['추적 중', '누르면 해제'],
  done: ['리포트', '오른쪽 로그 칸'],
  off: ['공정 추적', '입고→적재 따라가기'],
};
const FOOT_HINT = {
  fault: '셀·셀 안 장비 고장은 그 셀을 DOWN 으로 세운다(장비 하나만 멈추는 모델은 없음). AMR 고장은 그 자리에 서고, 뒤차는 우회하지 않고 기다린다. 사유·시간은 가정값',
  supply: '중단 = 원재료 창고 재보충 · 부품 창고 토트 적재를 멈춤(요청은 쌓임). 지연 = 그 시간이 늘어남. 창고 밖 물류는 그리지 않는다',
  event: '작업자 진입 = 그 셀 안전 정지. 통로 통제 = 두 플릿 AMR 전체 정지. 바닥 이상 = 두 플릿 감속. 실제 안전 PLC 연동이 아니다',
  amr: '속도 배율은 주행 상한에만 곱한다(후진·도크 서행은 그대로). 정지는 그 자리에 서고 잠금·티켓은 유지 — 재개하면 이어 간다',
  cctv: '뒷벽 관제 모니터 = 같은 씬을 가상 카메라 6대로 다시 그린 것. 녹화·감지 없음. 끄면 렌더 부하가 준다',
};

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
  if (d.mode === 'wait') {
    const hold = d.waitWhy
      ? `<p class="dt-warn">${esc(d.waitWhy)}</p><p class="dt-none">밀린 Cell 작업이 끝나면 다음 입고를 따라갑니다</p>`
      : '<p class="dt-none">다음 입고가 시작되면 그 공정 단위의 핵심 장비를 따라갑니다</p>';
    return `${path}${hold}`;
  }
  const rows = (d.stages ?? []).map((st, i, all) => {
    const last = i === all.length - 1 && d.mode === 'run';
    const cls = last ? 'now' : 'done';
    const who = st.equip?.label ?? st.holder;
    const why = st.why || (last ? d.waitWhy : null);
    return `<li class="${cls}"><span class="dot"></span><span><b>${esc(st.label)}</b> <em>${esc(who)}</em>${why ? `<small>${esc(why)}</small>` : ''}</span><time>${st.dur ? `${st.dur}s` : fmtTime(st.t)}</time></li>`;
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
    const list = Array.isArray(cw?.robots) ? cw.robots : Object.values(cw?.robots ?? {});
    busy = !!(cw?.op || list.some((r) => r.op));
    label = list[0]?.label ?? '양팔';
  }
  const st = down ? 'DOWN' : busy ? 'BUSY' : 'IDLE';
  return `
      <li data-equip="${e.id}" class="part ${e.id === state.followed ? 'on' : ''}">
        <b>${e.kind === 'body' ? e.name.replace(/_robot$/i, '') : e.name}</b><span>${label}</span><i class="st st-${st.toLowerCase()}">${st}</i>
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
