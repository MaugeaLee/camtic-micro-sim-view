// 운영 오퍼레이터. 물리 셀이 아니다. 시뮬레이터 최상위에서 셀·AMR 이동 순서를 정한다.
// 리프트 셀의 서쪽 입구는 한 대만 쓴다. 실은 차가 들어와 빠지기 전에는 빈 차(픽업)를 보내지 않고,
// 빈 차가 지그를 받으러 가는 동안에는 다음 실은 차를 출발시키지 않는다.
// 두 대를 셀이 비는 순간에 같이 보내면, 실은 차가 통로(화면 아래, 6시)에서 작업이 끝날 때까지 선다.

export class Ops {
  constructor(plant) {
    this.plant = plant;
    this.pulls = 0;   // 투입 차가 빠진 뒤 보낸 픽업(빈 AMR)
    this.pushes = 0;  // 셀이 비기 전에 실은 차를 출발시킨 횟수. 서쪽 입구를 같이 쓰면 0으로 둔다.
  }

  view() {
    return { pulls: this.pulls, pushes: this.pushes };
  }

  // 픽업(빈 차)은 실은 차가 리프트를 올리고 셀을 빠진 뒤에만 보낸다.
  // 셀이 빈 순간에 실은 차와 같이 출발시키지 않는다.
  due(id) {
    const cw = this.plant.work[id];
    if (!cw || cw.outM || !cw.lift.kit || cw.ticket) return false;
    if (cw.reserved) return false;
    if (this.inbound(id)) return false;
    const phase = cw.lift.phase;
    return phase === 'work' || phase === 'done';
  }

  // 이 셀로 도어트림을 싣고 오는 차가 이미 잡혔거나 움직이는 중인지.
  inbound(id) {
    return this.plant.acs.amrs.some((a) => a.load && (a.load.dest === id || (a.mission && a.bound === id) || a.waitFor === id));
  }

  // 실은 차는 리프트가 비었을 때만 출발한다. 픽업 차와 동시에 서쪽 입구로 보내지 않는다.
  approach() {
    return false;
  }

  // 지그를 아직 든 리프트에는 실은 차를 들이지 않는다. 빈 차(반출)는 들어간다.
  blockEntry(id, a) {
    if (!a?.load) return false;
    const cw = this.plant.work[id];
    const Lf = cw?.lift;
    if (!Lf) return false;
    return Lf.phase !== 'empty' || !!Lf.kit || !!cw.out || !!cw.ticket;
  }
}
