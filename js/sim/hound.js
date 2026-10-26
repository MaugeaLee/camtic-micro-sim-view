// 견마(사족보행) 순찰·리커버리(가정). AMR 겹침·맞물림·장시간 정지를 이상(Event)으로 보고,
// 로그·emit 으로 전파한 뒤 현장으로 가서 차체를 밀어 간격을 연다. DOM·three 없음.
// 이 모듈은 시뮬 안의 순찰 배우이다. 실제 셀 PLC 모션·OCS 실시간 제어가 아니다.
// 순찰 보고를 오케스트레이터 제안으로만 올리는 장 B 에이전트 경로(docx/04)와 섞지 않는다.
import { AMR } from './fleet.js';

export const HOUND = Object.freeze({
  id: 'HOUND-01',
  speed: 2.4,           // m/s. AMR 보다 빨라 출동한다
  yaw: 2.8,
  reach: 1.2,           // 다가가서 접촉을 시작하는 거리
  nudge: 0.16,          // 스텝당 밀기(≤ 0.25 m — 엔티티 순간이동 게이트)
  stuck: 8,             // 막힘 이상(초). 줄서기(queued)는 blockT 가 안 쌓인다
  jam: 2.5,             // 서로 막힘
  overlap: 0,           // 차체 원 간격 < 0 이면 겹침
  cool: 18,             // 같은 쌍 재출동 간격
});

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const mid = (amrs) => {
  const n = amrs.length || 1;
  return { x: amrs.reduce((s, a) => s + a.x, 0) / n, z: amrs.reduce((s, a) => s + a.z, 0) / n };
};
export const eventKey = (e) => `${e.kind}:${[...e.ids].sort().join('+')}`;

// 차체 원(반경 AMR.radius) 사이 간격. 음수 = 겹침.
export function circleGap(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z) - 2 * AMR.radius;
}

function waiting(a) {
  const st = a.steps[0];
  return !!(a.ticket || st?.until || ('wait' in (st ?? {})) || a.waitFor);
}

// 이상 목록. 줄서기·하역 대기는 정상이라 넣지 않는다(겹침은 예외).
export function findAnomalies(amrs) {
  const live = (amrs ?? []).filter((a) => a && !a.off);
  const out = [], seen = new Set();
  const add = (kind, list) => {
    const ids = list.map((a) => a.id);
    const k = eventKey({ kind, ids });
    if (seen.has(k)) return;
    seen.add(k);
    const p = mid(list);
    out.push({ kind, ids, amrs: list, x: p.x, z: p.z });
  };
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      if (circleGap(live[i], live[j]) < HOUND.overlap) add('overlap', [live[i], live[j]]);
    }
  }
  for (const a of live) {
    const o = a.blockedOn;
    if (o && !o.off && o.blockedOn === a && a.blockT >= HOUND.jam && o.blockT >= HOUND.jam) add('jam', [a, o]);
  }
  for (const a of live) {
    if (a.idle || waiting(a) || a.moving || a.blockT < HOUND.stuck) continue;
    add('stuck', [a]);
  }
  return out;
}

const RANK = { overlap: 3, jam: 2, stuck: 1 };

// 순찰 사각형(필드 통로, 가정). 셀 안을 가로지르지 않게 바깥 통로만.
export const PATROL = Object.freeze([
  { x: -14, z: 12 }, { x: 22, z: 12 }, { x: 22, z: -10.4 }, { x: -14, z: -10.4 },
]);

export class Hound {
  constructor({ home = PATROL[0] } = {}) {
    this.id = HOUND.id;
    this.home = { x: home.x, z: home.z };
    this.x = home.x;
    this.z = home.z;
    this.heading = 0;
    this.mode = 'patrol';     // patrol | goto | nudge | return
    this.task = '순찰';
    this.job = null;
    this.queue = [];
    this.phase = 0;
    this.cool = new Map();
    this.fixed = 0;
    this.seen = 0;
    this.events = [];
    this.gait = 0;
    this.nudgeT = 0;
  }

  reset() {
    this.x = this.home.x;
    this.z = this.home.z;
    this.heading = 0;
    this.mode = 'patrol';
    this.task = '순찰';
    this.job = null;
    this.queue = [];
    this.phase = 0;
    this.cool.clear();
    this.nudgeT = 0;
  }

  step(h, amrs, host) {
    this.gait += h;
    for (const [k, t] of this.cool) {
      const n = t - h;
      if (n <= 0) this.cool.delete(k);
      else this.cool.set(k, n);
    }
    this.notice(findAnomalies(amrs), host);
    this.act(h, host);
  }

  notice(hits, host) {
    for (const ev of hits) {
      const k = eventKey(ev);
      if (this.cool.has(k)) continue;
      if (this.job && eventKey(this.job) === k) continue;
      if (this.queue.some((q) => eventKey(q) === k)) continue;
      this.seen++;
      this.events.push({ kind: ev.kind, ids: ev.ids, x: ev.x, z: ev.z });
      if (this.events.length > 24) this.events.shift();
      host?.log('warn', `견마 이상: ${label(ev.kind)}`, { obs: ev.ids.join(' · ') });
      host?.emit('hound:event', { kind: ev.kind, ids: ev.ids, x: ev.x, z: ev.z });
      if (!this.job) this.take(ev);
      else this.queue.push(ev);
    }
    if (this.job && RANK[hits.find((h) => eventKey(h) === eventKey(this.job))?.kind] == null && this.mode === 'goto') {
      // 대상이 이미 풀렸으면 다음 일로
      this.job = null;
      this.next();
    }
  }

  take(ev) {
    this.job = ev;
    this.mode = 'goto';
    this.task = `출동(${label(ev.kind)})`;
    this.nudgeT = 0;
  }

  next() {
    const n = this.queue.shift();
    if (n) this.take(n);
    else {
      this.mode = 'return';
      this.task = '복귀';
    }
  }

  act(h, host) {
    if (this.mode === 'goto' && this.job) {
      const t = mid(this.job.amrs);
      if (this.walk(h, t.x, t.z) <= HOUND.reach) {
        this.mode = 'nudge';
        this.nudgeT = 0;
        this.task = '접촉 리커버리';
      }
      return;
    }
    if (this.mode === 'nudge' && this.job) {
      this.nudgeT += h;
      const open = nudge(this.job.amrs, h);
      if (this.nudgeT >= 2 || open) {
        this.cool.set(eventKey(this.job), HOUND.cool);
        this.fixed++;
        host?.log('info', '견마 리커버리', { obs: `${this.job.ids.join(' · ')} · ${label(this.job.kind)}` });
        host?.emit('hound:recover', { kind: this.job.kind, ids: this.job.ids });
        this.job = null;
        this.next();
      }
      return;
    }
    if (this.mode === 'return') {
      if (this.walk(h, this.home.x, this.home.z) < 0.45) {
        this.mode = 'patrol';
        this.task = '순찰';
      }
      return;
    }
    const p = PATROL[this.phase % PATROL.length];
    if (this.walk(h, p.x, p.z) < 0.55) this.phase++;
    this.task = '순찰';
  }

  walk(h, x, z) {
    const dx = x - this.x, dz = z - this.z, d = Math.hypot(dx, dz);
    if (d < 1e-4) return 0;
    const want = Math.atan2(dx, dz);
    const err = wrap(want - this.heading);
    this.heading = wrap(this.heading + Math.sign(err) * Math.min(Math.abs(err), HOUND.yaw * h));
    if (Math.abs(err) > 0.6) return d;
    const step = Math.min(d, HOUND.speed * h);
    this.x += Math.sin(this.heading) * step;
    this.z += Math.cos(this.heading) * step;
    return Math.hypot(x - this.x, z - this.z);
  }

  view() {
    return {
      id: this.id, x: this.x, z: this.z, heading: this.heading,
      mode: this.mode, task: this.task, gait: this.gait,
      job: this.job ? { kind: this.job.kind, ids: this.job.ids, x: this.job.x, z: this.job.z } : null,
      fixed: this.fixed, seen: this.seen,
    };
  }
}

function label(kind) {
  return kind === 'overlap' ? '겹침' : kind === 'jam' ? '맞물림' : '끼임';
}

// 차체를 밀어 간격을 연다. 하역 티켓이 있으면 조금만(핸드셰이크를 깨지 않게).
function nudge(amrs, h) {
  const live = (amrs ?? []).filter((a) => a && !a.off);
  const busy = live.some((a) => a.ticket);
  const step = Math.min(HOUND.nudge, 0.22) * (busy ? 0.25 : 1) * (h / 0.1);
  let open = false;
  if (live.length >= 2) {
    const [a, b] = live;
    open = circleGap(a, b) > 0.35;
    if (!open) {
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1;
      const ux = dx / d, uz = dz / d;
      a.x -= ux * step * 0.5; a.z -= uz * step * 0.5;
      b.x += ux * step * 0.5; b.z += uz * step * 0.5;
      open = circleGap(a, b) > 0.35;
    }
  } else if (live[0] && !open) {
    const a = live[0];
    const back = a.wantDir ?? { x: Math.sin(a.heading), z: Math.cos(a.heading) };
    a.x -= back.x * step; a.z -= back.z * step;
  }
  for (const a of live) {
    a.blockedOn = null;
    a.blockT = 0;
    a.holdFor = null;
    a.holdT = 0;
    a.passT = Math.max(a.passT ?? 0, 3);
    a.detours = 0;
  }
  return open;
}
