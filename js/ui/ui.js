// DOM 패널. 상태를 주기적으로 읽어 그린다(풀 방식). 입력은 콜백으로 main 에 넘긴다.
import { SPEEDS } from '../core/env.js';

const $ = (id) => document.getElementById(id);

const fmtTime = (t) => {
  const s = Math.floor(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const amrDot = (a) => (a.battery < 30 ? 'low' : a.charging ? 'charge' : a.mode === 'park' && !a.steps.length ? '' : a.moving ? 'move' : 'wait');

export class UI {
  constructor({ onPlay, onSpeed, onSelect, onFollow, onScenario, onPlace, onDownload, onImport, onAdmin } = {}) {
    this.cb = { onPlay, onSpeed, onSelect, onFollow, onScenario, onPlace, onDownload, onImport, onAdmin };
    this.lastLog = 0;
    this.el = {
      play: $('btnPlay'), speed: $('speedSeg'), clock: $('clock'), cells: $('cellList'), log: $('logList'),
      status: $('statusLine'), build: $('buildBar'), place: $('placeSeg'),
      dl: $('btnLayoutDl'), up: $('btnLayoutUp'), file: $('layoutFile'), admin: $('btnAdmin'),
      scenario: $('scenarioSel'), fleet: $('fleetBox'), amrs: $('amrList'), fleetSum: $('fleetSum'),
    };

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
  }

  // options: [{key,label}] — key '' 는 시나리오 없음
  setScenarios(options, current) {
    if (!this.el.scenario) return;
    this.el.scenario.innerHTML = options.map((o) => `<option value="${o.key}">${o.label}</option>`).join('');
    this.el.scenario.value = current ?? '';
  }

  setAdmin(on, cells = []) {
    this.el.admin?.classList.toggle('on', on);
    if (!this.el.build) return;
    this.el.build.hidden = !on;
    if (on) this.el.place.innerHTML = cells.map((c) => `<button type="button" data-place="${c.id}">${c.id}</button>`).join('');
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
        this.el.amrs.innerHTML = amrs.map((a) => `
          <li data-amr="${a.id}" class="${a.id === state.followed ? 'on' : ''}">
            <b><span class="dot ${amrDot(a)}"></span>${a.id.slice(4)}</b>
            <span class="task">${a.load ? `<i>#${a.load.id}→${a.load.dest}</i> ` : ''}${a.task}</span>
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
