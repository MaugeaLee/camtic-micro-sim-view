// GLB 에셋 로딩·캐시. URL은 호출측이 넘긴 assetUrl.
// 바이트를 한 번 받아 (1) glb.js 로 셀 프레임(바닥·중심 오프셋)과 기구(rigdata.js, 셀 로컬 평범한 데이터)를 계산하고 (2) PRESS 북쪽 짧은 레일은 rail-fit.js 로 남쪽 행정에 맞춘 뒤 (3) 그 바이트를 GLTFLoader 에 넘긴다. GLB 파일은 그대로.
// 로더가 노드 이름을 바꾸므로(점 제거 등) 객체마다 GLB 노드 index 를 userData.node 에 남긴다 — 기구 데이터는 index 로 가리킨다.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cellFrame, glbBuffer, readGlb, writeGlb } from './glb.js';
import { fitRails } from './rail-fit.js';
import { cellRig } from './rigdata.js';

export const RENDER = { loaded: new Map(), frames: new Map(), rigs: new Map(), models: new Map(), errors: new Map(), loading: null };

const loader = new GLTFLoader();

// base 는 서버가 내려 준 assetUrl (끝 /). 없으면 받지 않는다.
export function loadAssets(keys, { base } = {}) {
  if (RENDER.loading) return RENDER.loading;
  if (!base) return Promise.resolve();
  RENDER.loading = Promise.all(keys.map(async (key) => {
    if (RENDER.loaded.has(key)) return;
    try {
      const res = await fetch(`${base}${encodeURIComponent(key)}.glb`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      let packed = buf;
      let parsed = readGlb(buf);
      try {
        if (key === 'PRESS' && parsed.json && fitRails(parsed.json, parsed.bin)) packed = writeGlb(parsed.json, parsed.bin);
      } catch (e) {
        RENDER.errors.set(`${key}:rail-fit`, e?.message ?? String(e));
        packed = buf;
        parsed = readGlb(buf);
      }
      let gltf;
      try {
        gltf = await loader.parseAsync(glbBuffer(packed), base);
      } catch (e) {
        if (packed === buf) throw e;
        RENDER.errors.set(`${key}:rail-fit-parse`, e?.message ?? String(e));
        packed = buf;
        parsed = readGlb(buf);
        gltf = await loader.parseAsync(glbBuffer(buf), base);
      }
      const frame = cellFrame(parsed.json);
      tagNodes(gltf);
      RENDER.frames.set(key, frame);
      try { RENDER.rigs.set(key, cellRig(parsed.json, parsed.bin, { frame })); }
      catch (e) { RENDER.errors.set(`${key}:rig`, e?.message ?? String(e)); }
      RENDER.loaded.set(key, gltf.scene);
    } catch (e) {
      RENDER.errors.set(key, e?.message ?? String(e));
    }
  })).finally(() => { RENDER.loading = null; });
  return RENDER.loading;
}

function tagNodes(gltf) {
  const assoc = gltf.parser?.associations;
  if (!assoc) return;
  gltf.scene.traverse((o) => {
    const a = assoc.get(o);
    if (a && a.nodes !== undefined) o.userData.node = a.nodes;
  });
}

// 작업물 모델(셀이 아닌 GLB, 예: doortrim). 프레임·기구 계산 없이 씬만 캐시한다. 실패하면 null — 그리는 쪽이 상자로 대신한다.
export async function loadModel(key, { base } = {}) {
  if (RENDER.models.has(key)) return RENDER.models.get(key);
  if (!base) return null;
  try {
    const res = await fetch(`${base}${encodeURIComponent(key)}.glb`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const gltf = await loader.parseAsync(await res.arrayBuffer(), base);
    RENDER.models.set(key, gltf.scene);
    return gltf.scene;
  } catch (e) {
    RENDER.errors.set(`model:${key}`, e?.message ?? String(e));
    RENDER.models.set(key, null);
    return null;
  }
}

export function cloneAsset(key) {
  const src = RENDER.loaded.get(key);
  return src ? src.clone(true) : null;
}

export const assetFrame = (key) => RENDER.frames.get(key) ?? null;
export const assetRig = (key) => RENDER.rigs.get(key) ?? null;
