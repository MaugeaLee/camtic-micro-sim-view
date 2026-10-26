// 셀 공정 정의 JSON(가정값). 읽기만 한다 — 바꾸려면 파일을 고치고 테스트(tests/process.mjs)를 돌린다.
import fs from 'node:fs';
import { ROOT } from './env.mjs';
import { resolveUnderRoot } from './layout.mjs';
import { validateProcess } from '../js/sim/process.js';
import { SCENARIOS, DEFAULT_SCENARIO } from '../js/sim/scenario.js';

export const PROCESS_FILE = 'src/process.default.json';

export function loadProcess(root = ROOT) {
  const file = resolveUnderRoot(PROCESS_FILE, root);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return { ok: false, errors: [`공정 정의 읽기 실패: ${e.code ?? e.message}`] }; }
  const errors = validateProcess(raw, { cycle: SCENARIOS[DEFAULT_SCENARIO].cycle });
  return errors.length ? { ok: false, errors } : { ok: true, doc: raw };
}
