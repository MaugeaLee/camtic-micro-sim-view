# 구현 방식

프레임워크 없는 **vanilla ES module + Three.js r186 + 선택적 Node 서버**. React/Vue 없음. 브라우저가 시뮬·렌더·에이전트의 단일 런타임이다.

## 부트

`index.html` import map → `js/main.js`.

1. WebGLRenderer + CSS2D + OrbitControls + Bloom. GPU 컨텍스트 손실 시 렌더러 재생성.
2. `Simulation` + `FactoryView` + `UI` + DataHub/에이전트/녹화 모듈 배선.
3. Blender glTF를 먼저 로드한 뒤 공장을 한 번만 그림. 실패하면 three.js 도형 + 운영 로그 경고.
4. `*.github.io`면 `window.JIN3D_NO_SERVER = true`.

카메라: 원점 근처 `(-5.5, 0, 1)`, 초기 위치 `(-10.5, 45, 58)`, 거리 8–120m. 방향키는 타깃을 바닥에서 이동(Shift 2.5×).

## 디렉터리

```
index.html          셸 UI + import map 캐시버스트
js/                 브라우저 모듈 (아래)
css/                스타일
assets/blender/     glb · 미리보기
vendor/three/       Three r186
server.mjs          npm start → :8765
server/             MQTT · FAC · LLM · 영상 · 에피소드
electron/           맥 앱
tests/              헤드리스·UI 스크롤
docs/               AAS_SCHEMA · KPI_IMPACT_REPORT
blender/            자산 생성 파이썬 (앱 미포함)
```

## 모듈 역할 · 대략 크기

| 파일 | KB | 역할 |
|---|---:|---|
| `factory.js` | 225 | 3D 메시·건물·디스플레이·배치 |
| `main.js` | 176 | 부트·루프·이벤트 배선 |
| `sim.js` | 127 | 틱, 경로, 충돌, 배터리, ID, MODES |
| `impact.js` | 49 | KPI 손실 분해·제안·트윈 검증 |
| `robotcam.js` | 43 | 로봇 비전 전광판 |
| `orchview.js` | 35 | 오케스트레이터 UI |
| `telemetry.js` | 31 | 클릭 패널·관절/센서 |
| `datahub.js` | 30 | 자산 필드·수집·발행 페이로드 |
| `vla.js` | 29 | 에피소드·가상 학습 |
| `net5g.js` | 29 | 기지국 배치·UE·지연 |
| `aas.js` | 26 | AAS 모델·직렬화 |
| `ui.js` | 26 | 패널·차트·팝업 |
| `line.js` | 24 | 라인 카탈로그·Zone 상수 |
| 나머지 | <21 | 기능 단위 (에이전트, CCTV, FAC, 게이트…) |

`line.js`는 DOM 없음. 브라우저와 `server/line-designer.mjs`가 같이 쓴다.

## 루프

시뮬 시간은 배속(1×/3×/10×/30×)으로 흐른다. 일시정지·비상정지·“응답 대기 시 일시정지”가 틱을 멈춘다. 에이전트 주기는 **시뮬 1초**(벽시계 아님). 렌더는 requestAnimationFrame.

## 렌더

- 기본: Blender 5.2 → glTF. AMR 16 · AGV/지게차 · 드론 3 · 휴머노이드 · 사족 · 6축 팔 · AMMR · 트럭 · 갠트리 · e-axle · 도어트림 · 정비실.
- 나머지 상자/원기둥 284종은 `primitives.glb`로 치환(피지컬AI 약 1,800 메시).
- 코드가 쓰는 노드/재질 이름 고정(`LED`, `Rotor_0~3`, `ForkCarriage`, `Seg_*` …).
- 관절 자리는 도형 모델과 같음 → 텔레메트리·VLA·클릭이 렌더 모드와 무관.
- 개발 토글: `window.__twin.setRender('3d'|'blender')`.

## 서버 (`server/app-server.mjs`)

정적 파일 + 아래 API. Electron은 고정 포트 **47615**를 먼저 연다(AAS 영상 링크 유지).

| Method | Path | 역할 |
|---|---|---|
| GET | `/api/status` | llm/ffmpeg/저장 경로 |
| POST | `/api/agent` | Claude 지시 해석 |
| POST | `/api/line` | Claude 공정 설계 |
| POST | `/api/mqtt/publish` | 브라우저 NetworkMessage → aedes |
| GET | `/api/mqtt/status` | 브로커 상태 |
| POST/GET | `/api/fac…` | FAC 푸시·조회 (`fac-api.mjs`) |
| POST/GET | `/api/episodes` | VLA zip |
| POST/GET | `/api/aios` | 운영 데이터셋 zip |
| POST/GET | `/api/cctv` · `/api/robotcam` | 5분 구간 WebM+색인 |
| GET | `/videos/{cctv\|robotcam}/…` | 영상. 파일명 검사, 경로 탈출 차단 |
| GET | `/api/convert` | ffmpeg 구간 → MP4 |
| POST | `/api/clip-mp4` · `/api/frames-mp4` | 개별/프레임 zip → MP4 |

보관 한도(환경변수): CCTV/로봇캠 원본 각 576구간, MP4 144, 용량 CCTV 4GB · 로봇캠 8GB. 에피소드 로봇당 500 · 3GB. AIOS 1008묶음 · 1GB.

## Electron

`electron/main.mjs`. 번들 ID `kr.or.camtic.jinmicro`. API 키는 렌더러로 안 넘김. 내장 서버는 127.0.0.1만.

## 테스트

`npm test`가 estop · commands · logistics · drone · cctv · battery · net5g · pcap · fac · integration · blender · forklift · tools · paths · hazard · impact · priority · ctlflow · vla · aasvideo · mp4 · latency5g · multiagent · aasbasyx · episodekeep · security · fleet 를 순서대로 실행. `npm run test:ui`는 Electron 스크롤.
