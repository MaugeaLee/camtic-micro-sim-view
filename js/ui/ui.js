// DOM 패널. 상태를 주기적으로 읽어 그린다(풀 방식). 입력은 콜백으로 main 에 넘긴다.
import { SPEEDS } from '../core/env.js';

const $ = (id) => document.getElementById(id);

const fmtTime = (t) => {
  const s = Math.floor(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export class UI {
  constructor({ onPlay, onSpeed, onSelect } = {}) {
    this.cb = { onPlay, onSpeed, onSelect };
    this.lastLog = 0;
    this.el = { play: $('btnPlay'), speed: $('speedSeg'), clock: $('clock'), cells: $('cellList'), log: $('logList'), status: $('statusLine') };

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

    this.el.cells.innerHTML = state.cells.map((c) => `
      <li data-cell="${c.id}" class="${c.id === state.selected ? 'on' : ''}">
        <b>${c.id}</b><span>${c.label}</span><i class="st st-${c.state.toLowerCase()}">${c.state}</i><em>${c.loaded ? '모델' : '—'}</em>
      </li>`).join('');

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
