// 견마(사족보행) 순찰·리커버리(가정). 팩토리 통로를 돌다 실제 이상만 보고하고,
// 자체로 열 수 있으면 차체를 밀어 간격을 연다. 도크·충전 자리 정박은 정상이라 Event 를 내지 않는다.
// 관제 보행: AMR 레일에 묶지 않는다. 셀·창고 발자국을 피해 통로 격자로만 가고, 앞차에는 선다.
// 이 모듈은 시뮬 안의 순찰 배우이다. 실제 셀 PLC 모션·OCS 실시간 제어가 아니다.
import { AMR, isDocked } from './fleet.js';
import { FIELD_SIZE, FOOTPRINT, bounds, placeOf } from './layout.js';

export const HOUND = Object.freeze({
  id: 'HOUND-01',
  radius: 0.5,          // 차체 반경(가정). 폭 0.5 · 길이 1.1 의 외접에 가깝게
  speed: 0.85,          // m/s 순찰. AMR 빈 차(1.5)보다 느린 관제 보행
  sprint: 1.15,         // m/s 출동. 제품 상한(1.6)보다 낮고 AMR 보다 빠르지 않게
  accel: 0.6,
  decel: 0.9,
  yaw: 1.6,             // rad/s. 0.35 rad 넘게 틀어지면 제자리 회전
  reach: 1.2,           // 다가가서 접촉을 시작하는 거리(통로에서 닿을 때)
  approach: 3.2,        // 셀 안 이상은 경계까지만 가서 이 거리 안이면 접촉
  nudge: 0.16,          // 스텝당 밀기(≤ 0.25 m — 엔티티 순간이동 게이트)
  gap: 0.28,            // AMR 과 최소 여유
  pad: 0.78,            // 발자국 밖 통로 여유(반경+여백)
  stuck: 8,
  jam: 2.5,
  overlap: 0,
  cool: 18,
});

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const hypot = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const mid = (amrs) => {
  const n = amrs.length || 1;
  return { x: amrs.reduce((s, a) => s + a.x, 0) / n, z: amrs.reduce((s, a) => s + a.z, 0) / n };
};
export const eventKey = (e) => `${e.kind}:${[...e.ids].sort().join('+')}`;

export function circleGap(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z) - 2 * AMR.radius;
}

function waiting(a) {
  const st = a.steps[0];
  return !!(a.ticket || st?.until || ('wait' in (st ?? {})) || a.waitFor);
}

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
      if (isDocked(live[i]) || isDocked(live[j])) continue;
      if (circleGap(live[i], live[j]) < HOUND.overlap) add('overlap', [live[i], live[j]]);
    }
  }
  for (const a of live) {
    const o = a.blockedOn;
    if (!o || o.off || isDocked(a) || isDocked(o)) continue;
    if (o.blockedOn === a && a.blockT >= HOUND.jam && o.blockT >= HOUND.jam) add('jam', [a, o]);
  }
  for (const a of live) {
    if (isDocked(a) || a.idle || waiting(a) || a.moving || a.blockT < HOUND.stuck) continue;
    add('stuck', [a]);
  }
  return out;
}

const RANK = { overlap: 3, jam: 2, stuck: 1 };

// 레이아웃 없을 때 쓰는 바깥 통로 사각형(테스트·폴백).
export const PATROL = Object.freeze([
  { x: -14, z: 12 }, { x: 22, z: 12 }, { x: 22, z: -10.4 }, { x: -14, z: -10.4 },
]);

const hits = (x, z, box) => x > box.x0 && x < box.x1 && z > box.z0 && z < box.z1;

export function keepouts(layout, pad = HOUND.pad) {
  if (!layout) return [];
  const out = [];
  for (const id of Object.keys(FOOTPRINT)) {
    const pose = placeOf(layout, id);
    const b = pose ? bounds(id, pose) : null;
    if (!b) continue;
    out.push({ id, x0: b.x0 - pad, x1: b.x1 + pad, z0: b.z0 - pad, z1: b.z1 + pad });
  }
  return out;
}

export function insideKeepout(x, z, layout, pad = HOUND.pad) {
  return keepouts(layout, pad).some((b) => hits(x, z, b));
}

function inField(x, z, r = HOUND.radius) {
  const hw = FIELD_SIZE.w / 2 - r, hd = FIELD_SIZE.d / 2 - r;
  return x >= -hw && x <= hw && z >= -hd && z <= hd;
}

// 축정렬 선분이 부푼 발자국 안을 지나는지.
function segHits(a, b, box) {
  const dx = b.x - a.x, dz = b.z - a.z;
  let t0 = 0, t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, a.x - box.x0) && clip(dx, box.x1 - a.x) && clip(-dz, a.z - box.z0) && clip(dz, box.z1 - a.z);
}

function clearSeg(a, b, boxes) {
  return boxes.every((box) => !segHits(a, b, box));
}

function nearestOnBox(p, box) {
  const x = Math.min(box.x1, Math.max(box.x0, p.x));
  const z = Math.min(box.z1, Math.max(box.z0, p.z));
  const dx = [p.x - box.x0, box.x1 - p.x, p.z - box.z0, box.z1 - p.z];
  const k = dx.indexOf(Math.min(...dx));
  if (k === 0) return { x: box.x0, z };
  if (k === 1) return { x: box.x1, z };
  if (k === 2) return { x, z: box.z0 };
  return { x, z: box.z1 };
}

export function approachOf(p, boxes) {
  const hit = boxes.find((b) => hits(p.x, p.z, b));
  if (!hit) return { x: p.x, z: p.z };
  const q = nearestOnBox(p, hit);
  const ux = q.x === hit.x0 ? -1 : q.x === hit.x1 ? 1 : 0;
  const uz = q.z === hit.z0 ? -1 : q.z === hit.z1 ? 1 : 0;
  return { x: q.x + ux * 0.15, z: q.z + uz * 0.15 };
}

function aisles(boxes) {
  const hw = FIELD_SIZE.w / 2, hd = FIELD_SIZE.d / 2;
  // PARTS 는 남쪽이라 셀 사이 세로 통로를 가리지 않는다. 충전 자리(z≈9.6)·필드 끝은 순찰에 안 쓴다.
  const row = boxes.filter((b) => b.id !== 'PARTS');
  const z1 = row.length ? Math.max(...row.map((b) => b.z1)) : 4;
  const z0 = row.length ? Math.min(...row.map((b) => b.z0)) : -8;
  const north = Math.min(hd - 1.3, z1 + 1.5);
  const south = Math.max(-hd + 1.3, z0 - 1.5);
  const west = row.length ? Math.min(...row.map((b) => b.x0)) - 1.5 : -hw + 1.4;
  const east = row.length ? Math.max(...row.map((b) => b.x1)) + 1.5 : hw - 1.4;
  const gapMin = HOUND.radius * 2 + 0.35;
  const xs = [west];
  const byX = [...row].sort((a, b) => a.x0 - b.x0);
  let cur = row.length ? Math.min(...row.map((b) => b.x0)) : -hw;
  for (const b of byX) {
    if (b.x0 - cur > gapMin) xs.push((cur + b.x0) / 2);
    cur = Math.max(cur, b.x1);
  }
  xs.push(east);
  return { north, south, xs: [...new Set(xs.map((x) => Math.round(x * 100) / 100))] };
}

// 셀 사이 세로 통로를 북↔남으로 지그재그. 직선으로 셀을 뚫지 않게 act 가 route 로 잇는다.
function weave(xs, north, south, boxes) {
  const ok = (p) => inField(p.x, p.z) && boxes.every((b) => !hits(p.x, p.z, b));
  const pts = [];
  xs.forEach((x, i) => {
    const a = { x, z: i % 2 === 0 ? north : south };
    const b = { x, z: i % 2 === 0 ? south : north };
    if (ok(a)) pts.push(a);
    if (ok(b)) pts.push(b);
  });
  return pts;
}

function corridor(layout) {
  const boxes = keepouts(layout);
  if (!boxes.length) return { boxes, nodes: [...PATROL], patrol: [...PATROL] };
  const { north, south, xs } = aisles(boxes);
  const zs = [south, north];
  const nodes = [];
  for (const x of xs) {
    for (const z of zs) {
      if (inField(x, z) && boxes.every((b) => !hits(x, z, b))) nodes.push({ x, z });
    }
  }
  const patrol = weave(xs, north, south, boxes);
  return {
    boxes,
    nodes: nodes.length ? nodes : [...PATROL],
    patrol: patrol.length >= 4 ? patrol : [...PATROL],
  };
}

function nearest(p, nodes) {
  let best = nodes[0], d = Infinity;
  for (const n of nodes) {
    const t = hypot(p, n);
    if (t < d) { d = t; best = n; }
  }
  return best;
}

function aligned(a, b) {
  return Math.abs(a.x - b.x) < 0.08 || Math.abs(a.z - b.z) < 0.08;
}

export function worldOf(layout) {
  return corridor(layout);
}

export function routeTo(from, to, layout) {
  return routeToWorld(from, to, worldOf(layout));
}

export class Hound {
  constructor({ home, layout } = {}) {
    this.id = HOUND.id;
    this.world = worldOf(layout);
    this.home = home ?? this.world.patrol[0];
    this.x = this.home.x;
    this.z = this.home.z;
    this.heading = 0;
    this.v = 0;
    this.mode = 'patrol';
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
    this.way = [];
    this.wi = 0;
  }

  bind(layout) {
    this.world = worldOf(layout);
    this.home = this.world.patrol[0];
  }

  reset() {
    this.x = this.home.x;
    this.z = this.home.z;
    this.heading = 0;
    this.v = 0;
    this.mode = 'patrol';
    this.task = '순찰';
    this.job = null;
    this.queue = [];
    this.phase = 0;
    this.cool.clear();
    this.nudgeT = 0;
    this.way = [];
    this.wi = 0;
  }

  step(h, amrs, host, layout) {
    if (layout) this.world = worldOf(layout);
    this.gait += h;
    for (const [k, t] of this.cool) {
      const n = t - h;
      if (n <= 0) this.cool.delete(k);
      else this.cool.set(k, n);
    }
    this.notice(findAnomalies(amrs), host);
    this.act(h, amrs, host);
  }

  notice(hitsEv, host) {
    for (const ev of hitsEv) {
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
    if (this.job && RANK[hitsEv.find((h) => eventKey(h) === eventKey(this.job))?.kind] == null && this.mode === 'goto') {
      this.job = null;
      this.next();
    }
  }

  take(ev) {
    this.job = ev;
    this.mode = 'goto';
    this.task = `출동(${label(ev.kind)})`;
    this.nudgeT = 0;
    this.plan(approachOf({ x: ev.x, z: ev.z }, this.world.boxes));
  }

  next() {
    const n = this.queue.shift();
    if (n) this.take(n);
    else {
      this.mode = 'return';
      this.task = '복귀';
      this.plan(this.home);
    }
  }

  plan(goal) {
    this.way = routeToWorld({ x: this.x, z: this.z }, goal, this.world);
    this.wi = 0;
  }

  act(h, amrs, host) {
    const ignore = new Set(this.job?.ids ?? []);
    if (this.mode === 'goto' && this.job) {
      const t = mid(this.job.amrs);
      const edge = approachOf(t, this.world.boxes);
      if (!this.way.length) this.plan(edge);
      this.follow(h, amrs, ignore);
      const atEdge = hypot(this, edge) <= 0.6;
      const near = hypot(this, t) <= HOUND.reach || (atEdge && hypot(this, t) <= HOUND.approach);
      if (near) {
        this.mode = 'nudge';
        this.v = 0;
        this.nudgeT = 0;
        this.task = '접촉 리커버리';
      }
      return;
    }
    if (this.mode === 'nudge' && this.job) {
      this.nudgeT += h;
      this.v = 0;
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
      if (!this.way.length) this.plan(this.home);
      this.follow(h, amrs, ignore);
      if (hypot(this, this.home) < 0.45) {
        this.mode = 'patrol';
        this.task = '순찰';
        this.way = [];
      }
      return;
    }
    const loop = this.world.patrol;
    const p = loop[this.phase % loop.length];
    if (!this.way.length) this.plan(p);
    this.follow(h, amrs, ignore);
    if (hypot(this, p) < 0.55) {
      this.phase++;
      this.plan(loop[this.phase % loop.length]);
    }
    if (this.v > 0.05) this.task = '순찰';
  }

  follow(h, amrs, ignore) {
    if (this.wi >= this.way.length) return;
    const p = this.way[this.wi];
    const left = this.walk(h, p.x, p.z, amrs, ignore);
    if (left < 0.4) this.wi++;
  }

  walk(h, x, z, amrs, ignore) {
    const dx = x - this.x, dz = z - this.z, d = Math.hypot(dx, dz);
    if (d < 1e-4) { this.v = 0; return 0; }
    const want = Math.atan2(dx, dz);
    const err = wrap(want - this.heading);
    this.heading = wrap(this.heading + Math.sign(err) * Math.min(Math.abs(err), HOUND.yaw * h));
    if (Math.abs(err) > 0.35) {
      this.v = Math.max(0, this.v - HOUND.decel * h);
      return d;
    }
    const cruise = this.mode === 'goto' ? HOUND.sprint : HOUND.speed;
    this.v = Math.min(cruise, this.v + HOUND.accel * h);
    this.v = Math.min(this.v, Math.sqrt(Math.max(0, 2 * HOUND.decel * d)));
    const step = Math.min(d, this.v * h, 0.22);
    const nx = this.x + Math.sin(this.heading) * step;
    const nz = this.z + Math.cos(this.heading) * step;
    if (!inField(nx, nz) || this.world.boxes.some((b) => hits(nx, nz, b))) {
      this.v = 0;
      return d;
    }
    const other = (amrs ?? []).find((a) => a && !a.off && !isDocked(a) && !ignore?.has(a.id)
      && Math.hypot(a.x - nx, a.z - nz) < HOUND.radius + AMR.radius + HOUND.gap);
    if (other) {
      this.v = 0;
      if (this.mode === 'patrol') this.task = '순찰 양보';
      else if (this.mode === 'goto') this.task = '출동 양보';
      else if (this.mode === 'return') this.task = '복귀 양보';
      return d;
    }
    this.x = nx;
    this.z = nz;
    return Math.hypot(x - this.x, z - this.z);
  }

  view() {
    return {
      id: this.id, x: this.x, z: this.z, heading: this.heading, v: this.v,
      mode: this.mode, task: this.task, gait: this.gait,
      moving: this.v > 0.08,
      job: this.job ? { kind: this.job.kind, ids: this.job.ids, x: this.job.x, z: this.job.z } : null,
      fixed: this.fixed, seen: this.seen,
    };
  }
}

export function routeToWorld(from, to, world) {
  const boxes = world.boxes, nodes = world.nodes;
  const goal = approachOf(to, boxes);
  if (!boxes.length || !nodes.length) return [goal];
  const s = nearest(from, nodes), t = nearest(goal, nodes);
  const n = nodes.length;
  const adj = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!aligned(nodes[i], nodes[j])) continue;
      if (!clearSeg(nodes[i], nodes[j], boxes)) continue;
      adj[i].push(j); adj[j].push(i);
    }
  }
  const si = nodes.indexOf(s), ti = nodes.indexOf(t);
  const prev = new Array(n).fill(-1), dist = new Array(n).fill(Infinity);
  dist[si] = 0;
  const q = [si];
  while (q.length) {
    const i = q.shift();
    for (const j of adj[i]) {
      const d = dist[i] + hypot(nodes[i], nodes[j]);
      if (d < dist[j]) { dist[j] = d; prev[j] = i; q.push(j); }
    }
  }
  const via = [];
  if (Number.isFinite(dist[ti])) {
    for (let i = ti; i >= 0; i = prev[i]) via.push(nodes[i]);
    via.reverse();
  } else via.push(t);
  const path = [];
  const push = (p) => {
    const last = path[path.length - 1];
    if (!last || hypot(last, p) > 0.2) path.push({ x: p.x, z: p.z });
  };
  if (clearSeg(from, s, boxes)) push(s);
  for (const p of via) push(p);
  push(goal);
  return path.length ? path : [goal];
}

function label(kind) {
  return kind === 'overlap' ? '겹침' : kind === 'jam' ? '맞물림' : '끼임';
}

function nudge(amrs, h) {
  const live = (amrs ?? []).filter((a) => a && !a.off && !isDocked(a));
  if (!live.length) return true;
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
