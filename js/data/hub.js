// 상태 스냅샷·발행. DOM 없음. 지금은 직렬화만 하고 외부 전송은 붙이지 않았다.
export const SNAPSHOT_PERIOD = 10;

export function snapshot(state) {
  return {
    t: Number(state.time.toFixed(3)),
    running: state.running,
    speed: state.speed,
    cells: state.cells.map(({ id, state: s, loaded }) => ({ id, state: s, loaded })),
    ...(state.plant ? {
      scenario: state.scenario,
      amrs: state.amrs.map((a) => ({ id: a.id, x: r2(a.x), z: r2(a.z), mode: a.mode, load: a.load?.dest ?? null, battery: r2(a.battery) })),
    } : {}),
  };
}

const r2 = (v) => Math.round(v * 100) / 100;

export class DataHub {
  constructor({ period = SNAPSHOT_PERIOD } = {}) {
    this.period = period;
    this.last = -Infinity;
    this.latest = null;
  }

  reset() {
    this.last = -Infinity;
    this.latest = null;
  }

  // 시뮬 시간 기준 period 초마다 스냅샷을 만든다.
  tick(state) {
    if (state.time - this.last < this.period - 1e-6) return null;
    this.last = state.time;
    this.latest = snapshot(state);
    return this.latest;
  }
}
