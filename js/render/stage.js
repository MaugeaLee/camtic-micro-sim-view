// 렌더 그래프: 렌더러·씬·카메라·컨트롤. 한 번만 만든다. 보조 뷰포트(CCTV·로봇캠 등)는 두지 않는다.
// 조명 톤은 meta-factory main.js LOOK.smart(배경·반구광·주광·보조광·노출)와 blender.js applyRenderEnv(실내 환경광)를 따른다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const CAMERA = Object.freeze({ fov: 50, near: 0.1, far: 500, position: [12, 40, 56], target: [0, 0, -1], minDistance: 2, maxDistance: 120 });
const LOOK = Object.freeze({ bg: 0x16202c, hemi: [0xf2f8ff, 0x37424f, 1.3], sun: [0xffffff, 1.8], fill: [0x9ec9ff, 0.5], exposure: 1.05, env: 0.22 });

export function createStage(host) {
  const renderer = makeRenderer(host);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LOOK.bg);
  scene.environment = roomEnvironment(renderer);
  scene.environmentIntensity = LOOK.env;

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect(host), CAMERA.near, CAMERA.far);
  camera.position.set(...CAMERA.position);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...CAMERA.target);
  controls.enableDamping = true;
  controls.minDistance = CAMERA.minDistance;
  controls.maxDistance = CAMERA.maxDistance;
  controls.maxPolarAngle = Math.PI * 0.49;

  scene.add(new THREE.HemisphereLight(...LOOK.hemi));
  const sun = new THREE.DirectionalLight(...LOOK.sun);
  sun.position.set(-20, 40, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(...LOOK.fill);
  fill.position.set(30, 20, -20);
  scene.add(fill);

  const stage = { host, renderer, scene, camera, controls, lost: false };

  // 그림자 범위를 바닥(w×d, 원점 중심)에 맞춘다.
  stage.fitShadow = (w, d) => {
    const r = Math.hypot(w, d) / 2 + 2;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: sun.position.length() + r * 2 });
    sun.shadow.camera.updateProjectionMatrix();
  };

  const resize = () => {
    camera.aspect = aspect(host);
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight, false);
  };
  new ResizeObserver(resize).observe(host);
  resize();

  // GPU 컨텍스트 손실 시 렌더를 건너뛰고 복구되면 재개한다.
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stage.lost = true; });
  renderer.domElement.addEventListener('webglcontextrestored', () => { stage.lost = false; resize(); });

  stage.render = () => {
    if (stage.lost) return;
    controls.update();
    renderer.render(scene, camera);
  };
  return stage;
}

function makeRenderer(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  host.appendChild(renderer.domElement);
  return renderer;
}

function roomEnvironment(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  return tex;
}

const aspect = (host) => (host.clientWidth || 1) / (host.clientHeight || 1);
