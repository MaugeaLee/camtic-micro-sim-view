// 셀 GLB 기구를 시뮬 값으로 움직인다: 로봇 팔(레일 + 관절각), 갠트리(가로 이동 + 공구 승강), 롤러 회전. 그리기만 한다.
// 기구 데이터(assets/rigdata.js cellRig)는 셀 로컬 좌표·GLB 노드 index. 움직이는 노드는 셀 그룹 아래 rig 루트로 옮겨
// (월드 자세 유지) 영점 행렬 M0 를 기억하고, 매 프레임 M = P · M0 로 둔다. P 는 시뮬 기구학(sim/kin.js)과 같은 공간 좌표 POE.
// 양팔 로봇(SORT): 팔은 P = 대차 이동 · 몸통 회전 · POE, 몸통 그룹(이름으로 찾음)은 대차 이동 · 몸통 회전.
import * as THREE from 'three';

const baseName = (n) => String(n ?? '').replace(/\.\d+$/, '');
const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _t = new THREE.Matrix4(), _v = new THREE.Vector3(), _a = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);

// 대차 이동 s(축 axis) · 수직축(o 지나는) 회전 w 를 m 에 곱한다
function carriage(m, axis, s, turn) {
  if (axis && s) m.multiply(_t.makeTranslation(axis.x * s, axis.y * s, axis.z * s));
  if (turn?.w) {
    const o = turn.o;
    m.multiply(_t.makeTranslation(o[0], o[1], o[2]));
    m.multiply(_r.makeRotationAxis(_y, turn.w));
    m.multiply(_t.makeTranslation(-o[0], -o[1], -o[2]));
  }
  return m;
}

export class RigView {
  constructor() { this.cells = new Map(); }

  // group: 셀 그룹(레이아웃 자리), obj: 그 안에 붙은 에셋 루트, rig: 셀 로컬 기구 데이터
  attach(cellId, group, obj, rig) {
    this.detach(cellId);
    if (!rig) return null;
    const byNode = new Map();
    obj.traverse((o) => { if (o.userData.node !== undefined && !byNode.has(o.userData.node)) byNode.set(o.userData.node, o); });
    const root = new THREE.Group();
    root.name = 'rig';
    group.add(root);
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const take = (node) => grab(byNode.get(node));
    const grab = (o) => {
      if (!o) return null;
      const m0 = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      root.add(o);
      o.matrixAutoUpdate = false;
      o.matrix.copy(m0);
      o.matrixWorldNeedsUpdate = true;
      return { o, m0 };
    };
    const arms = new Map();
    for (const a of rig.arms) {
      const links = [];
      for (const L of a.links) {
        if (L.node === a.node) continue;
        const t = take(L.node);
        if (t) links.push({ ...t, joint: L.joint });
      }
      const track = rig.tracks[a.track] ?? null;
      arms.set(baseName(a.name), { arm: a, links, axis: track ? new THREE.Vector3(...track.axis) : null });
    }
    const gantries = [];
    for (const g of rig.gantries) {
      if (g.work?.node !== undefined) { const w = byNode.get(g.work.node); if (w) w.visible = false; }
      const tool = new Set(g.tool);
      const lift = g.lift.filter((n) => !tool.has(n)).map(take).filter(Boolean);
      const head = g.tool.filter((n) => n !== g.work?.node).map(take).filter(Boolean);
      gantries.push({ g, lift, head, horiz: new THREE.Vector3(...g.horiz), up: new THREE.Vector3(...g.up) });
    }
    const rollers = new Map();
    for (const R of rig.rollers) {
      const rods = R.rods.map((w) => {
        const t = take(w.node);
        return t ? { ...t, c: new THREE.Vector3(...w.center), axis: new THREE.Vector3(...w.axis).normalize(), radius: w.radius } : null;
      }).filter(Boolean);
      rollers.set(R.node, { R, rods });
    }
    const cell = { root, arms, gantries, rollers, obj, grab, body: null };
    this.cells.set(cellId, cell);
    return { arms: arms.size, gantries: gantries.length, rollers: rollers.size };
  }

  detach(cellId) {
    const c = this.cells.get(cellId);
    if (c) { c.root.parent?.remove(c.root); this.cells.delete(cellId); }
  }

  // view: 시뮬 셀 공정 그리기 값 { robots:[{name,pose:{q,s},index}], lines:[{gantry:{z,y}, travel, rig}] }
  update(cellId, view) {
    const c = this.cells.get(cellId);
    if (!c || !view) return;
    for (const r of view.robots) {
      const A = c.arms.get(r.name);
      if (!A || !r.pose || !r.index) continue;
      const q = new Map(r.index.map((j, i) => [j, r.pose.q[i] ?? 0]));
      const J = A.arm.joints;
      for (const L of A.links) {
        carriage(_m.identity(), A.axis, r.pose.s, r.turn);
        const chain = [];
        for (let j = L.joint; j >= 0; j = J[j].parent) chain.unshift(j);
        for (const j of chain) {
          const t = q.get(j);
          if (!t) continue;
          const o = J[j].origin;
          _a.set(...J[j].axis).normalize();
          _t.makeTranslation(o[0], o[1], o[2]);
          _m.multiply(_t);
          _m.multiply(_r.makeRotationAxis(_a, t));
          _m.multiply(_t.makeTranslation(-o[0], -o[1], -o[2]));
        }
        L.o.matrix.multiplyMatrices(_m, L.m0);
        L.o.matrixWorldNeedsUpdate = true;
      }
    }
    if (view.body) {
      if (!c.body || c.body.name !== view.body.name) {
        let o = null;
        c.obj.traverse((x) => { if (!o && baseName(x.name) === view.body.name) o = x; });
        c.body = { name: view.body.name, t: c.grab(o) };
      }
      const B = view.body, t = c.body.t;
      if (t) {
        _v.set(...B.axis);
        carriage(_m.identity(), _v, B.s, { o: B.o, w: B.w });
        t.o.matrix.multiplyMatrices(_m, t.m0);
        t.o.matrixWorldNeedsUpdate = true;
      }
    }
    for (const L of view.lines) {
      const G = L.rig?.gantry && c.gantries.find((g) => g.g.node === L.rig.gantry.node);
      if (G) {
        const dh = (L.gantry.z - L.rig.gantry.home) * (G.horiz.z || 1);
        const dv = L.gantry.y - L.rig.gantry.padHome;
        _v.copy(G.horiz).multiplyScalar(dh);
        _m.makeTranslation(_v.x, _v.y, _v.z);
        for (const x of G.lift) { x.o.matrix.multiplyMatrices(_m, x.m0); x.o.matrixWorldNeedsUpdate = true; }
        _v.addScaledVector(G.up, dv);
        _m.makeTranslation(_v.x, _v.y, _v.z);
        for (const x of G.head) { x.o.matrix.multiplyMatrices(_m, x.m0); x.o.matrixWorldNeedsUpdate = true; }
      }
      const R = L.rig?.rollers && c.rollers.get(L.rig.rollers.node);
      if (R) {
        for (const w of R.rods) {
          const ang = (L.travel / w.radius) * L.dir * Math.sign(w.axis.x || 1);
          _t.makeTranslation(w.c.x, w.c.y, w.c.z);
          _m.copy(_t).multiply(_r.makeRotationAxis(w.axis, ang)).multiply(_t.makeTranslation(-w.c.x, -w.c.y, -w.c.z));
          w.o.matrix.multiplyMatrices(_m, w.m0);
          w.o.matrixWorldNeedsUpdate = true;
        }
      }
    }
  }
}
