// 권위 있는 뷰어 상태. 뷰·UI·데이터는 여기서 읽기만 하고 변경은 메서드로 요청한다. DOM 없음.
import { CELLS, CELL_STATES } from './cells.js';
import { MAX_STEP, SPEEDS } from '../core/env.js';
import { defaultLayout } from './layout.js';
import { Plant, SCENARIOS } from './scenario.js';

const LOG_CAP = 160;

export class ViewerState {
  // scenario: SCENARIOS 키. 없으면 셀 상태는 setCellState 로만 바뀐다.
  constructor({ cells = CELLS, quiet = false, scenario = null, layout = defaultLayout(), amr = null } = {}) {
    this.time = 0;
    this.running = false;
    this.speed = 1;
    this.quiet = quiet;
    this.cells = cells.map((c) => ({ id: c.id, label: c.label, asset: c.asset, state: 'IDLE', loaded: false }));
    this.selected = null;
    this.followed = null;
    this.logs = [];
    this.logSeq = 0;
    this.events = [];
    this.scenario = scenario;
    if (scenario && !SCENARIOS[scenario]) throw new Error(`없는 시나리오: ${scenario}`);
    this.plant = scenario ? new Plant(SCENARIOS[scenario], { layout, cells: this.cells, amr }) : null;
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
    this.plant?.step(h, this);
  }

  get amrs() { return this.plant?.fleet.amrs ?? []; }

  setLayout(doc) { this.plant?.setLayout(doc); }

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
    if (id !== null) this.followed = null;
    this.emit('select', { id });
  }

  // 카메라가 따라갈 AMR. 셀 선택과 함께 쓰지 않는다.
  follow(id) {
    if (id !== null && !this.amrs.some((a) => a.id === id)) throw new Error(`없는 AMR: ${id}`);
    this.followed = id;
    if (id !== null) { this.selected = null; this.emit('select', { id: null }); }
    this.emit('follow', { id });
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
