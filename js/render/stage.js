// 렌더 그래프: 렌더러·씬·카메라·컨트롤. 한 번만 만든다. 보조 뷰포트(CCTV·로봇캠 등)는 두지 않는다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CAMERA = Object.freeze({ fov: 50, near: 0.1, far: 500, position: [18, 16, 22], target: [0, 0, 0], minDistance: 2, maxDistance: 120 });

export function createStage(host) {
  const renderer = makeRenderer(host);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1116);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect(host), CAMERA.near, CAMERA.far);
  camera.position.set(...CAMERA.position);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...CAMERA.target);
  controls.enableDamping = true;
  controls.minDistance = CAMERA.minDistance;
  controls.maxDistance = CAMERA.maxDistance;
  controls.maxPolarAngle = Math.PI * 0.49;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x30343a, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(20, 30, 10);
  scene.add(sun);

  const stage = { host, renderer, scene, camera, controls, lost: false };

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
  host.appendChild(renderer.domElement);
  return renderer;
}

const aspect = (host) => (host.clientWidth || 1) / (host.clientHeight || 1);
