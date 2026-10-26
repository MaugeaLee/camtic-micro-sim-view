// DOM 패널. 상태를 주기적으로 읽어 그린다(풀 방식). 입력은 콜백으로 main 에 넘긴다.
import { SPEEDS } from '../core/env.js';

const $ = (id) => document.getElementById(id);

const fmtTime = (t) => {
  const s = Math.floor(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const amrDot = (a) => (a.battery < 30 ? 'low' : a.charging ? 'charge' : a.mode === 'park' && !a.steps.length ? '' : a.moving ? 'move' : 'wait');

export class UI {
  constructor({ onPlay, onSpeed, onSelect, onFollow, onScenario, onPlace, onDownload, onImport, onSave, onAdmin, onBuildMode } = {}) {
    this.cb = { onPlay, onSpeed, onSelect, onFollow, onScenario, onPlace, onDownload, onImport, onSave, onAdmin, onBuildMode };
    this.lastLog = 0;
    this.el = {
      play: $('btnPlay'), speed: $('speedSeg'), clock: $('clock'), cells: $('cellList'), log: $('logList'),
      status: $('statusLine'), build: $('buildBar'), place: $('placeSeg'), mode: $('buildMode'), hint: $('buildHint'),
      dl: $('btnLayoutDl'), up: $('btnLayoutUp'), save: $('btnLayoutSave'), file: $('layoutFile'), admin: $('btnAdmin'),
      scenario: $('scenarioSel'), fleet: $('fleetBox'), amrs: $('amrList'), fleetSum: $('fleetSum'), acs: $('acsLine'),
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
    this.bindPanels();
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
    this.el.place.innerHTML = route ? '' : cells.map((c) => `<button type="button" data-place="${c.id}">${c.id}</button>`).join('');
    if (this.el.hint) {
      const keys = '끌기 = 옮기기 · <b>Shift</b>+바닥 = 노드 추가(선택 노드와 연결) · <b>Shift</b>+노드 = 선택 노드와 간선(없음→양방향→단방향) · <b>Ctrl</b>+바닥 = 충전 자리 · <b>Del</b> = 지우기 · <b>X</b> = 셀 출구';
      this.el.hint.innerHTML = mode === 'parts'
        ? `부품 운송 AMR: 큰 주황 = 도킹 자리(창고 PARTS · SORT 투입 SORT:IN · 라인 도크 PRESS/SCREW:Lnn), 초록 = 입구. SORT 레인 칸은 도어트림과 같은 칸이다. ${keys}`
        : route ? keys : '좌클릭 집기·놓기 · 우클릭 회전 · R 90°';
    }
  }

  reset(state) {
    this.lastLog = 0;
    this.el.log.innerHTML = '';
    this.update(state);
  }

  update(state) {
    this.el.clock.textContent = fmtTime(state.time);
    this.el.play.textContent = state.running ? '일시정지' : '재생';
    for (const b of this.el.speed.children) b.classList.toggle('on', Number(b.dataset.speed) === state.speed);

    const units = state.plant?.units;
    this.el.cells.innerHTML = state.cells.map((c) => {
      const u = units?.[c.id];
      const extra = u ? (u.role === 'source' ? `키트 ${state.plant.kits.length}` : `재고 ${u.stock}`) : (c.loaded ? '모델' : '—');
      return `
      <li data-cell="${c.id}" class="${c.id === state.selected ? 'on' : ''}">
        <b>${c.id}</b><span>${c.label}</span><i class="st st-${c.state.toLowerCase()}">${c.state}</i><em>${extra}</em>
      </li>`;
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
        const h = state.plant.hound;
        const hound = h ? `
          <li data-amr="${h.id}" class="${h.id === state.followed ? 'on' : ''}">
            <b><span class="dot ${h.mode === 'nudge' ? 'low' : h.mode === 'goto' ? 'move' : 'charge'}"></span>견마</b>
            <span class="task">${h.task}${h.job ? ` · ${h.job.ids.join(' · ')}` : ''}</span>
            <span class="batt"><em>감지 ${h.seen} · 해소 ${h.fixed}</em></span>
          </li>` : '';
        this.el.amrs.innerHTML = hound + amrs.map((a) => `
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
}
