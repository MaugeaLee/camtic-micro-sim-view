// 카메라 포커스: 선택한 셀·AMR 쪽으로 궤도 중심과 거리를 부드럽게 옮긴다. 따라가기면 대상이 움직이는 만큼 같이 옮긴다.
// 사용자가 궤도를 돌리거나 확대하면 그 시점부터는 손대지 않는다(따라가기의 평행 이동만 유지).

const EASE = 0.9;      // 초. 포커스 이동 시간
const DIST_K = 1.8;    // 대상 크기 × K = 카메라 거리
const MIN_DIST = 6;

export class CameraRig {
  constructor(stage) {
    this.stage = stage;
    this.tween = null;
    this.track = null;
    this.home = { target: stage.controls.target.clone(), position: stage.camera.position.clone() };
    stage.controls.addEventListener('start', () => { this.tween = null; });
  }

  // focus: {center: Vector3, size}
  focus(f) {
    if (!f) return;
    const { camera, controls } = this.stage;
    const dir = camera.position.clone().sub(controls.target).normalize();
    if (dir.y < 0.35) dir.setY(0.35).normalize();
    const dist = Math.max(MIN_DIST, f.size * DIST_K);
    this.start(f.center.clone(), f.center.clone().add(dir.multiplyScalar(dist)));
  }

  // get(): 매 프레임 대상 중심(Vector3) 또는 null
  follow(get) {
    this.track = get ? { get, last: null } : null;
  }

  reset() {
    this.track = null;
    this.start(this.home.target.clone(), this.home.position.clone());
  }

  start(target, position) {
    const { camera, controls } = this.stage;
    this.tween = { t: 0, t0: controls.target.clone(), p0: camera.position.clone(), t1: target, p1: position };
  }

  update(dt) {
    const { camera, controls } = this.stage;
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / EASE);
      const k = 1 - Math.pow(1 - tw.t, 3);
      controls.target.lerpVectors(tw.t0, tw.t1, k);
      camera.position.lerpVectors(tw.p0, tw.p1, k);
      if (tw.t >= 1) this.tween = null;
    }
    if (this.track) {
      const p = this.track.get();
      if (!p) { this.track = null; return; }
      if (this.track.last) {
        const d = p.clone().sub(this.track.last);
        controls.target.add(d);
        camera.position.add(d);
        if (this.tween) { this.tween.t1.add(d); this.tween.p1.add(d); }
      }
      this.track.last = p.clone();
    }
  }
}