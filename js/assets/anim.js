// 관절 포즈 파형. GLB 클립이 아니라 코드로 관절각을 만든다(meta-factory anim()과 같은 방식). Three·DOM 없음.

// 카메라 포커스 기본값일 뿐. 재생은 검출된 로봇 전부.
export const BENCH = Object.freeze({
  PRESS: Object.freeze({ name: 'R8', rate: 1.25 }),
  SCREW: Object.freeze({ name: 'R1', rate: 1.25 }),
  SORT: Object.freeze({ name: 'Dual_arm_L', rate: 1.25 }),
});

export function recipeFor(assetKey, extra = {}) {
  const base = BENCH[assetKey] ?? { name: '', rate: 1.25 };
  const patch = {};
  for (const [k, v] of Object.entries(extra)) {
    if (v != null && v !== '') patch[k] = v;
  }
  return { ...base, ...patch };
}

const AMP = Object.freeze([0.35, 0.25, 0.3, 0.3, 0.6, 0.5]);

export function jointWave(t, n, { rate = 1.25, phase = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => Math.sin((t + phase) * rate * (1 - i * 0.08) + i * 0.9) * (AMP[i] ?? 0.3));
}

export function travelWave(t, { amp = 0.35, rate = 0.7, phase = 0 } = {}) {
  return Math.sin((t + phase) * rate) * amp;
}

export function spinWave(t, { rate = 2.4, phase = 0 } = {}) {
  return (t + phase) * rate;
}

export function gantryWave(t, { ampX = 0.28, ampZ = 0.08, rate = 0.7, phase = 0 } = {}) {
  return {
    x: travelWave(t, { amp: ampX, rate, phase }),
    z: travelWave(t, { amp: ampZ, rate: rate * 0.85, phase: phase + 0.9 }),
  };
}
