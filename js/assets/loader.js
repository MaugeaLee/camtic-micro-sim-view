// GLB 에셋 로딩·캐시. URL은 호출측이 넘긴 assetUrl.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const RENDER = { loaded: new Map(), errors: new Map(), loading: null };

const loader = new GLTFLoader();

// base 는 서버가 내려 준 assetUrl (끝 /). 없으면 받지 않는다.
export function loadAssets(keys, { base } = {}) {
  if (RENDER.loading) return RENDER.loading;
  if (!base) return Promise.resolve();
  RENDER.loading = Promise.all(keys.map(async (key) => {
    if (RENDER.loaded.has(key)) return;
    try {
      const gltf = await loader.loadAsync(`${base}${encodeURIComponent(key)}.glb`);
      RENDER.loaded.set(key, gltf.scene);
    } catch (e) {
      RENDER.errors.set(key, e?.message ?? String(e));
    }
  })).finally(() => { RENDER.loading = null; });
  return RENDER.loading;
}

export function cloneAsset(key) {
  const src = RENDER.loaded.get(key);
  return src ? src.clone(true) : null;
}
