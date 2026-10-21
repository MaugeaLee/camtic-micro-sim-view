// 실행 환경 플래그. DOM 없음 — Node 테스트에서도 import 된다.
const g = typeof window !== 'undefined' ? window : globalThis;
const host = g.location?.hostname ?? '';

// 정적 호스팅(*.github.io)이나 file:// 에서는 서버 API를 부르지 않는다.
export const NO_SERVER = !!g.MICROSIM_NO_SERVER || /\.github\.io$/.test(host) || g.location?.protocol === 'file:';

// 단위: 1 = 1 m, Y-up (glTF 규약). STEP→GLB 변환 산출물과 같다.
export const UNITS = Object.freeze({ length: 'm', up: 'Y' });

export const SPEEDS = Object.freeze([1, 3, 10, 30]);

// 시뮬 한 스텝 상한(초). 배속이 커도 이 단위로 쪼개 진행한다.
export const MAX_STEP = 0.1;
