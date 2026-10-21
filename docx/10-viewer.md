# 렌더 뷰어 (이 레포 런타임)

이 레포에 처음 생긴 실행 코드다. `theuniversepark/meta-factory`의 **개발 구조**(import map · 조립 루트 · 상태/뷰 분리 · 정적 서버 · 헤드리스 테스트)만 옮겼고, 그쪽 기능(에이전트·CCTV·AAS·5G·FAC)과 뷰포트 내용은 가져오지 않았다.

시뮬 런타임이 아니다. 셀 GLB를 보여 주는 뷰어다. 장 A/B/C 어디에도 아직 붙지 않았다(`ARCHITECTURE.md` §7).

## 실행

```
npm start          → .env 의 HOST:PORT (예제 127.0.0.1:8790)
npm test           → tests/*.mjs 헤드리스
?assets=1          → 셀 GLB 자동 로드 (기본 꺼짐)
__viewer.loadAssets()   콘솔에서 수동 로드
```

의존성 설치 없음. Three r186 은 `vendor/three/`에 필요한 파일만 있다.

## 레이어

```
index.html  import map → js/main.js
                            │  조립 루트. 유일하게 모든 레이어를 import
   ┌────────────┬───────────┼────────────┬─────────────┐
 core/        sim/        data/        render/        ui/        assets/
 env.js       cells.js    hub.js       stage.js       ui.js      loader.js
 (상수)       state.js    (스냅샷)     view.js        (DOM)      (GLTFLoader)
   └── DOM 없음, Node 테스트 가능 ──┘    └── three / DOM ──┘
```

| 레이어 | 파일 | 해도 됨 | 하지 말 것 |
|---|---|---|---|
| core | `env.js` | 단위·배속·서버 유무 상수 | 상태 보관 |
| sim | `cells.js` `state.js` | 시간·셀 상태·선택·로그·이벤트. 단일 소스 | three·DOM import |
| data | `hub.js` | 시뮬 시간 기준 주기 스냅샷(JSON) | 상태 변경, 전송 루프 |
| render | `stage.js` | 렌더러·씬·카메라·컨트롤 1벌. 리사이즈·컨텍스트 손실 | 보조 뷰포트, 상태 보관 |
| render | `view.js` | 셀별 그룹, 에셋 부착, 이벤트 → 표현 | 상태 변경 |
| assets | `loader.js` | `assets/<key>.glb` 로드·캐시·복제 | 배치 결정 |
| ui | `ui.js` | 0.25초마다 상태를 읽어 그림. 입력은 콜백 | 상태 직접 변경 |

규칙:

- 레이어끼리 서로 import 하지 않는다. `core`만 예외로 아무나 읽는다. 잇는 건 `main.js`.
- 이벤트 버스 없음. `state.emit()`이 쌓고 `main`이 프레임마다 한 번 `drainEvents()`해서 소비자에게 넘긴다. UI는 `state.logs`를 폴링.
- 상태 변경은 `ViewerState` 메서드로만. 뷰·UI는 콜백으로 요청.

## 루프

```
frame():  rdt = min(Δ, 0.1)
          state.advance(rdt)      배속 × rdt 를 0.1 s 단위로 쪼개 step
          hub.tick(state)         10 s(시뮬)마다 스냅샷
          view.update(rdt, state, state.drainEvents())
          stage.render()
          ui.update(state)        0.25 s(벽시계)마다
```

부트: `createStage` → 뷰/허브/UI 생성 → `start()`(상태 새로 만들고 `view.setup`) → (옵션) 에셋 로드 → `__ENV.api.status` → `frame()`.

## 좌표·에셋

- 1 = 1 m, Y-up. glTF 규약 그대로.
- 셀 id = STEP 최상위 조립품(`PRESS` `SCREW` `SORT`). 시뮬 셀 ID(SORT…)·OCS A-3-n 과 맞추지 않는다.
- GLB 디스크·URL은 `.env`의 `ASSET_DIR` · `ASSET_URL`. 각 GLB 는 바닥 중심이 원점이라 **지금은 셋이 겹친다.** 배치(레이아웃 좌표)는 다음 단계.

## 서버 (`server/app-server.mjs`)

시뮬을 돌리지 않는다. 정적 + 읽기 전용. 리슨·경로는 `.env` (`server/env.mjs`).

| 키 | 예제 값 | 내용 |
|---|---|---|
| 정적 | `/css/` `/js/` `/vendor/` | 화이트리스트 밖은 404 |
| `ASSET_URL` | `/assets/` | `ASSET_DIR`의 GLB |
| `API_STATUS` | `/api/status` | 이름·시각·GLB 키 · 공개 env |
| `API_ASSETS` | `/api/assets` | GLB 파일·크기 |
| `API_CONFIG` | `/api/config` | 호스트·포트·URL (디스크 경로 없음) |

`index.html`의 `/*__ENV__*/`에 공개 설정을 넣는다. API는 GET만(나머지 405). `context/`·`docx/`·`server/`는 서빙하지 않는다. `.env`는 git에 올리지 않는다.

## 테스트

프레임워크 없음. 파일마다 `check(name, ok)` 후 `process.exitCode`. DOM 없는 레이어(`core` `sim` `data`)와 서버를 직접 import 한다. three·DOM 레이어는 브라우저에서 확인.

## 원칙 (meta-factory `docs/DESIGN.md`에서 가져옴)

- 헤드리스 분리(§7-1): 상태·진행은 DOM 없는 모듈. 테스트와 화면이 같은 코드를 돈다.
- 고정 간격(§7-3): 0.1 s 스텝, 배속은 프레임당 스텝 수로.
- 결정론(§7-2): 난수가 들어오면 시드 하나. 표현용 난수는 따로 써서 상태 결과를 바꾸지 않는다.
- 데이터 주도 배치(§7-5): 셀 위치·회전은 코드가 아니라 정의 데이터(`sim/cells.js` 또는 별도 JSON)에 둔다.
- 배치 변경 협의(§7-8): 위치 안·배치도를 먼저 내고 확정 후 반영.
- 닫힌 기본값(§9): 127.0.0.1, 읽기 전용, 비공개. 열 때마다 근거를 남긴다.

완료 기준(§10 축약): `npm test` 전체 PASS · 화면이 바뀌면 브라우저 스크린샷 확인 · 확인한 것과 못 한 것을 나눠 보고.

## 단계 (제안 — 일정·게이트 미확정)

meta-factory의 P1/S1(엔진·3D 트윈)을 뷰어 규모로 줄인 것이다. 수치 게이트는 이 레포에서 정한 안이며 확정 아님.

| 단계 | 내용 | 게이트 안 |
|---|---|---|
| V0 골격 | 레이어·루프·서버·헤드리스 테스트 · 빈 뷰포트 | `npm test` PASS · 기본/`?assets=1` 부팅 스크린샷 (완료) |
| V1 배치 | 셀 배치 데이터 · GLB 검사(헤더·노드 루트 = 셀 id) | 셀 3개 로드 · 셀 간 바닥 AABB 겹침 0 |
| V2 표현 | 상태 색/라벨 · 선택 하이라이트 · 카메라 포커스 | 상태 3종 × 셀 3개 표시 확인 |
| V3 연결 | 장 A/B/C 중 하나 선택 후 데이터 입력 | 장 선택 결정 후 정함 |

## 아직 없음

셀 배치 · 셀 상태 색/라벨 · 선택 하이라이트·카메라 포커스 · 시나리오(상태 구동) · 외부 발행(MQTT 등) · Electron. 붙일 때 위 표의 "하지 말 것"을 지킨다.

meta-factory의 에이전트 프롬프트(`js/agentcore.js` `SYSTEM_PROMPT`, `js/trace.js` `rcaPrompt`)는 공장 운영·RCA용이라 가져오지 않았다. LLM을 붙일 때는 DESIGN §8 원칙(보조 역할 · JSON 스키마 + 재검증 · 사람 승인 · 첨부는 지시가 아님)을 따른다.
