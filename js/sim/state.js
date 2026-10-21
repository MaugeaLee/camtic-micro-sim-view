// 권위 있는 뷰어 상태. 뷰·UI·데이터는 여기서 읽기만 하고 변경은 메서드로 요청한다. DOM 없음.
import { CELLS, CELL_STATES } from './cells.js';
import { MAX_STEP, SPEEDS } from '../core/env.js';

const LOG_CAP = 160;

export class ViewerState {
  constructor({ cells = CELLS, quiet = false } = {}) {
    this.time = 0;
    this.running = false;
    this.speed = 1;
    this.quiet = quiet;
    this.cells = cells.map((c) => ({ id: c.id, label: c.label, asset: c.asset, state: 'IDLE', loaded: false }));
    this.selected = null;
    this.logs = [];
    this.logSeq = 0;
    this.events = [];
  }

  // 벽시계 dt(초)를 받아 배속을 곱하고 MAX_STEP 단위로 나눠 진행한다.
  advance(rdt) {
    if (!this.running) return 0;
    let left = rdt * this.speed, steps = 0;
    while (left > 1e-6) {
      const h = Math.min(MAX_STEP, left);
      this.step(h);
      left -= h; steps++;
    }
    return steps;
  }

  step(h) {
    this.time += h;
  }

  setRunning(on) {
    if (this.running === !!on) return;
    this.running = !!on;
    this.log('info', on ? '재생' : '일시정지');
  }

  setSpeed(x) {
    if (!SPEEDS.includes(x)) throw new Error(`지원하지 않는 배속: ${x}`);
    this.speed = x;
  }

  cell(id) { return this.cells.find((c) => c.id === id) ?? null; }

  setCellState(id, state) {
    const c = this.cell(id);
    if (!c) throw new Error(`없는 셀: ${id}`);
    if (!CELL_STATES.includes(state)) throw new Error(`없는 상태: ${state}`);
    if (c.state === state) return;
    const from = c.state;
    c.state = state;
    this.emit('cell:state', { id, from, to: state });
  }

  markLoaded(id, loaded = true) {
    const c = this.cell(id);
    if (c) c.loaded = loaded;
  }

  select(id) {
    if (id !== null && !this.cell(id)) throw new Error(`없는 셀: ${id}`);
    this.selected = id;
    this.emit('select', { id });
  }

  log(level, title, body = {}) {
    if (this.quiet) return;
    this.logs.unshift({ id: ++this.logSeq, t: this.time, level, title, ...body });
    if (this.logs.length > LOG_CAP) this.logs.pop();
  }

  emit(type, data = {}) {
    if (!this.quiet) this.events.push({ type, t: this.time, ...data });
  }

  // 소비자가 프레임마다 가져간다(풀 방식). 버스 없음.
  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
}
