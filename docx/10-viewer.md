# 렌더 뷰어 (이 레포 런타임)

이 레포에 처음 생긴 실행 코드다. `theuniversepark/meta-factory`의 **개발 구조**(import map · 조립 루트 · 상태/뷰 분리 · 정적 서버 · 헤드리스 테스트)만 옮겼고, 그쪽 기능(에이전트·CCTV·AAS·5G·FAC)과 뷰포트 내용은 가져오지 않았다.

시뮬 런타임이 아니다. 셀 GLB를 보여 주는 뷰어다. 장 A/B/C 어디에도 아직 붙지 않았다(`ARCHITECTURE.md` §7).

## 실행

```
npm start          → .env 의 HOST:PORT (예제 127.0.0.1:8790)
npm test           → tests/*.mjs 헤드리스
/api/docs          → Swagger UI
?assets=1          → 셀 GLB 자동 로드 (기본 꺼짐)
Admin 버튼         → 타이틀 오른쪽. 짓기(집기·놓기) 켜고 끔. `?build=1` 이면 켠 채로 시작
?scenario=faults   → 시나리오(기본 faults · supply · none). 상단 드롭다운으로도 바꿈
?amr=2             → 공급 AMR 대수 1~5 (기본 = 시나리오 값 2, 견적 A08)
?play=1            → 재생 상태로 시작
?warp=130          → 점검용. 시뮬을 그만큼 미리 진행
?focus=SORT        → 점검용. 셀 id 또는 AMR id(AMR-01)에 카메라 포커스
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
              layout.js                fleet.js                  scan.js
              scenario.js              camera.js pick.js
              fleet.js                 field.js place.js
   └── DOM 없음, Node 테스트 가능 ──┘    └── three / DOM ──┘
 server/glb.mjs — GLB 헤더·루트 검사 (Node, three 없음)
```

| 레이어 | 파일 | 해도 됨 | 하지 말 것 |
|---|---|---|---|
| core | `env.js` | 단위·배속·서버 유무 상수 | 상태 보관 |
| sim | `cells.js` `state.js` | 시간·셀 상태·선택·로그·이벤트. 단일 소스 | three·DOM import |
| sim | `layout.js` | 셀 자리·스냅·겹침 검증. three·DOM 없음 | 서버 파일 I/O |
| sim | `scenario.js` | 시나리오 정의(가정값)·`Plant`: 셀 상태 구동, 키트, 배차, 도크 FIFO | 셀 id↔A-3-n 대응, 확정 공정처럼 쓰기 |
| sim | `fleet.js` | 통로 차로·도크 동선·`Amr` 단계 실행·감지·양보 | three·DOM, 렌더 좌표 직접 읽기 |
| data | `hub.js` | 시뮬 시간 기준 주기 스냅샷(JSON) | 상태 변경, 전송 루프 |
| render | `stage.js` | 렌더러·씬·카메라·컨트롤 1벌. 리사이즈·컨텍스트 손실 | 보조 뷰포트, 상태 보관 |
| render | `view.js` | 셀별 그룹, 에셋 부착, 이벤트 → 상태 테두리·바닥 틴트·라벨, 선택 강조 | 상태 변경 |
| render | `fleet.js` | AMR 차체·바퀴·상태등·토트, 남은 경로선, 도크·대기 칸 바닥 표시 | sim import (main이 칸 좌표를 넘김) |
| render | `camera.js` `pick.js` | 포커스 이동·따라가기 · 클릭(끌기 아님) 선택 | 상태 변경 (콜백으로 요청) |
| render | `field-def.js` | 필드 치수 정의(가정)·검증. three·DOM 없음 | 셀 배치 |
| render | `field.js` | 바닥·통로 표시·벽·기둥 메시. 재질은 meta-factory 바닥·벽 톤 | 로봇·설비 |
| render | `place.js` | 짓기 제스처(레이캐스트·고스트). 판정 함수는 main이 넘김 | 레이아웃 파일 저장 |
| assets | `loader.js` | `assets/<key>.glb` 로드·캐시·복제 | 배치 결정 |
| assets | `rig.js` | CAD 그룹 → 관절 추정. 점군·접촉만. 이름 표 없음 | three·DOM, 부품 수동 매핑 |
| assets | `movers.js` | 팔·AMR·롤러·직교·레일 분류. 형상만. `inferRig`를 레일/바퀴/직교에 재사용하지 않음 | three·DOM, 종류 섞기 |
| assets | `anim.js` | 관절각 `jointWave` · 이동 `travelWave` · 자전 `spinWave` · 직교 `gantryWave`. 셀마다 카메라 기본만 둠(PRESS `R8` · SCREW `R1` · SORT `Dual_arm_L`) | 축·원점 결정 |
| assets | `scan.js` | 씬 그래프 → 운동 그룹 목록(점 추출 + `classifyMover`). 에셋 뷰어·메인 공용 | 판정 규칙 추가 (`movers.js`에서) |
| assets | `preview.js` | `/api/asset-viewer` 테스트 뷰포트. 추정 결과를 피벗으로 조립 | 메인 시뮬 상태 |
| ui | `ui.js` | 0.25초마다 상태를 읽어 그림. 입력은 콜백 | 상태 직접 변경 |

규칙:

- 레이어끼리 서로 import 하지 않는다. `core`만 예외로 아무나 읽는다. 잇는 건 `main.js`.
- 이벤트 버스 없음. `state.emit()`이 쌓고 `main`이 프레임마다 한 번 `drainEvents()`해서 소비자에게 넘긴다. UI는 `state.logs`를 폴링.
- 상태 변경은 `ViewerState` 메서드로만. 뷰·UI는 콜백으로 요청.

## 루프

```
frame():  rdt = min(Δ, 0.1)
          state.advance(rdt)      배속 × rdt 를 0.1 s 단위로 쪼개 step (시나리오가 있으면 plant.step)
          hub.tick(state)         10 s(시뮬)마다 스냅샷 (AMR 위치 포함)
          events = state.drainEvents()
          view.update · fleetView.update(rdt, state, events)
          select/follow 이벤트 → rig.focus · rig.follow → rig.update(rdt)
          stage.render()
          ui.update(state)        0.25 s(벽시계)마다
```

부트: `createStage` → 뷰/허브/UI 생성 → `start()`(상태 새로 만들고 `view.setup`) → (옵션) 에셋 로드 → `__ENV.api.status` → `frame()`.

## 좌표·에셋

- 1 = 1 m, Y-up. glTF 규약 그대로.
- 셀 id = STEP 최상위 조립품(`PRESS` `SCREW` `SORT`). 시뮬 셀 ID(SORT…)·OCS A-3-n 과 맞추지 않는다. 견적 코드(S/P/K/A)↔그룹은 `context/08-precision-y1-equip.md`. `PRESS`는 압입 체결구역이다.
- GLB 디스크·URL은 `.env`의 `ASSET_DIR` · `ASSET_URL`. 쓰는 자리는 `LAYOUT_FILE`(기본 `data/layout.json`). 없거나 깨지면 `src/layout.default.json`만 읽는다. PUT은 `LAYOUT_FILE`에만 쓰고 기본 파일은 덮지 않는다. 메인은 GET `/api/layout`만 읽고, Admin 모드에서 집기·놓기한다. 보기 화면은 2초마다 GET해서 따라간다.
- 필드(`field-def.js`): 48 × 30 m, 벽 높이 8 m, 뒷벽·좌우 벽, 앞면 열림, 앞쪽 통로 1줄. **실측 아님** — 셀 3개가 통로와 함께 들어갈 크기로 잡은 가정이다. 바닥 텍스처는 캔버스로 생성(고정 시드, 한 장 4 m · 격자 1 m)하고 이미지 파일은 없다.

## 서버 (`server/app-server.mjs`)

시뮬을 돌리지 않는다. 정적 + 읽기 전용(레이아웃 PUT만 예외, 루프백). 리슨·에셋은 `.env`. API 경로는 `server/env.mjs`의 `API` 상수. 버전은 `package.json`.

| 경로 | 내용 |
|---|---|
| 정적 | `/css/` `/js/` `/vendor/` — 화이트리스트 밖은 404 |
| `ASSET_URL` | `.env`. 기본 `/assets/` — `ASSET_DIR`의 GLB |
| `/api/status` | 이름·시각·GLB 키 · 공개 env |
| `/api/assets` | GLB 파일·크기 |
| `/api/config` | 이름·버전·호스트·포트·URL (디스크 경로 없음) |
| `/api/asset-viewer` | Three.js 가 읽는 GLB/GLTF 조회. 브라우저면 테스트 뷰포트(`preview.js`), `?format=json` 이면 목록. 재생은 아래 운동 분류. `?key=` `?target=` `?play=0` |
| `/api/docs` | Swagger UI. OpenAPI 스펙을 읽어 GET 실행 |
| `/api/openapi.json` | OpenAPI 3 JSON |
| `/api/layout` | 셀 자리 JSON. GET은 `LAYOUT_FILE` → 기본 파일 순. `?download=1` 이면 첨부. PUT은 127.0.0.1만 · `LAYOUT_FILE`에만 기록 |

`index.html`의 `/*__ENV__*/`에 공개 설정을 넣는다. API는 GET만(레이아웃 PUT 제외, 나머지 405). `context/`·`docx/`·`server/`는 서빙하지 않는다. `.env`는 git에 올리지 않는다. 공개 설정에 `LAYOUT_FILE` 디스크 경로는 없다.

## 관절 추정 (`js/assets/rig.js`)

이 셀 GLB에는 `J1`–`J6` 피벗·`extras.axis`·스키·클립이 없다. 메시는 조립품 아래 **형제**이고 TRS는 거의 identity다. 루트 Object3D를 돌리면 강체 요(yaw)가 되어 기구학이 아니다.

참조 레포(meta-factory)는 빈 피벗 체인 아래 링크 메시를 두고 `pose()`만 한다. 이쪽은 그 피벗을 **로드 시 형상으로 만들고**, 같은 구조로 조립한다. 부품 이름표·로봇별 JSON·사람이 고른 축은 쓰지 않는다. `TUNE`은 전역 임계값 한 벌이다.

대상 목록도 이름(`R\d+`)이 아니라 `inferRig().robot === true` 인 그룹이다. PRESS·SCREW·SORT를 열면 검출된 팔을 **전부** 같은 규칙으로 묶고 같이 재생한다. `BENCH.*.name`은 카메라 포커스 기본값일 뿐 관절 매핑이 아니다.

### 하지 말 것

- 루트 그룹을 통째로 회전
- `ShoulderHousing → J2` 같은 이름 규칙
- 로봇마다 다른 축·원점 표
- GLB에 없는 6축을 있는 것처럼 쓰기

### 절차

1. 씬을 순회한다. 자식이 4개 이상인 그룹마다, 자식 메시 점을 월드로 모아(최대 4000점) `inferRig(parts, { up: [0,1,0] })`에 넣는다. 부품 수 3 미만 또는 120 초과는 빈 결과.
2. 부품마다 AABB와 `roundAxis`(회전 대칭)를 구한다.
3. AABB 틈 ≤ `max(0.003, 전체대각선 × 0.01)` 이면 맞닿은 것으로 잇는다. 떨어진 덩어리는 최근접 틈 + 같은 허용치 안의 쌍을 한꺼번에 잇는다.
4. `up` 방향으로 가장 낮은 부품을 고정 베이스(루트)로 둔다.
5. 베이스에서 멀어지는 순으로 대칭 부품을 관절 후보로 본다. 직렬 깊이 ≥ 3 이면 로봇.

### 하우징·축 (`roundAxis`)

회전 대칭 부품(원판·짧은 원통)을 관절 하우징으로 본다. 자기 축으로 돌아도 모양이 같아서, 하우징이 관절 앞·뒤 어느 링크에 붙어도 결과가 같다. 대칭축 = 회전축, 중심 = 원점.

- 점 공분산 고유값 3개. 두 축 분산이 비슷하고(`≥ 0.8`) 나머지 한 축이 뚜렷하면(`≤ 0.75`) 그 한 축이 후보.
- 세 분산이 비슷하면(길이 ≈ 지름 × 0.7 원통) 고유벡터와 ±X/Y/Z를 돌려 보고, 바깥 둘레 점 비율이 가장 큰 축을 쓴다.
- 바깥 둘레(반지름의 90% 이상) 점이 16칸 중 9칸 이상을 채워야 원이다. 사각 판·모서리만 있는 형상은 탈락.
- 축 방향 길이 > 지름 × 1.6 이면 링크·롤러·레일이다. 하우징이 아니다.
- 앞선 관절과 축 내적 ≥ 0.97 이고 축–점 거리 ≤ 전체대각선 × 0.04 이면 **새 관절이 아니라** 그 관절의 베어링·캡. 같은 링크에 묶는다.

### 관절이 아닌 접촉 (`isCut`)

관절이면 먼 쪽 덩어리가 몸통에 닿는 자리는 하우징 근처여야 한다. 닿는 점이 하우징 중심에서 `max(2.5 × 반지름, 3 × 틈허용)` 밖이면 후보를 버린다. 흡착 패드·컨베이어 롤러가 이 조건으로 빠진다.

### 조립·재생

추정한 관절마다 빈 그룹 `J1`… 을 원점에 두고, 링크 부품을 `attach`로 그 아래로 옮긴다. 축은 그룹 로컬로 변환해 `quaternion.setFromAxisAngle`에 쓴다. 가동 범위는 `±π`로만 두고, 재생 진폭은 `anim.js`의 `sin(t)` (대략 0.25–0.6 rad)다. 간섭 검사는 없다.

### 확인한 것 · 한계

2026-10-21, 현재 GLB 기준. 확정 제원이 아니다.

| 맞음 | 아님 |
|---|---|
| PRESS R6–R10, SCREW R1–R5·R11, SORT Dual_arm_L/R — 각 5관절 직렬 | 경계 레일, 롤러 컨베이어, 실러 펌프 |
| 직교 2축(S04/P04/K02) — 문형+Z기둥+패드 → `gantry` | 로봇 주행레일·양팔 슬라이드(`track`) |
| R8: 선회 Y → 어깨 X → 팔꿈치 X → 손목 X → 툴 Y | 6축째 손목. 이 CAD에 해당 원통이 없음 |
| `tests/rig.mjs` 합성 팔·컨베이어·패드 | 회전 부호·리밋·실측 원점. 하우징 중심이라 mm 단위 어긋날 수 있음 |

임계값을 바꾸면 `tests/rig.mjs`와 위 세 GLB(로봇만 잡히고 설비는 안 잡히는지)를 같이 본다.

## 운동 종류 (`js/assets/movers.js`)

팔 추정(`inferRig`)을 레일·AMR·롤러에 다시 쓰지 않는다. 짧은 원통은 관절 하우징, 가로 짧은 원통 묶음은 바퀴, 가로 긴 원통은 롤러, 가로로 긴 가이드는 레일이다. 한 규칙으로 섞으면 패드·레일·바퀴가 가짜 팔 관절이 된다.

`classifyMover` 순서: 팔 → 바퀴 → 롤러 → 직교 → 레일. 조상 그룹이 자식과 같이 잡히면 자식만 남긴다. 부품 이름표·종류별 JSON은 쓰지 않는다.

| kind | 형상 | 동작 |
|---|---|---|
| `arm` | `inferRig().robot` | 내부 메시를 `J1`… 피벗 아래로. `jointWave` |
| `amr` | 가로 짧은 원통 3–8개, 반지름·높이 비슷. 큰 지그 상판+다리는 제외 | 차체 `travelWave`. 바퀴는 이동/반지름으로 자전 |
| `rollers` | 가로 긴 원통 4개 이상 | 제자리 `spinWave`. 베드 자체는 고정 |
| `gantry` | 문형 기둥 3–6 + 문 위 Z기둥 + 흡착 공구. Cross가 긴 Side 레일을 탐 | `gantryWave`: 캐리지(Cross+헤드)는 레일 방향, 흡착만 수직. Side·프레임 고정 |
| `track` | 가로 긴 AABB 가이드 2–4개, 길이 비슷, 나란히(경로 조각 제외) | 레일은 고정. 레일 위 팔 그룹을 축으로 슬라이드 |

재생은 검출된 대상 전부. `BENCH.*.name`·드롭다운은 카메라 포커스다. 메인 뷰는 이 판정으로 `amr` 그룹만 숨기고(공급 AMR 플릿으로 대체), 팔·롤러·직교 재생은 아직 안 붙인다.

합성 점군은 `tests/movers.mjs`. 실제 GLB에서 팔 15대가 그대로인지, 직교 2축이 `gantry`인지, MAIN JIG 도킹이 AMR로 안 움직이는지, 레일/롤러가 팔로 안 잡히는지를 같이 본다.

## 시나리오·공급 AMR (`js/sim/scenario.js` `fleet.js`)

**가정 흐름.** 확정 공정이 아니다. SORT가 서브부품 키트를 만들고(사이클 14 s, 버퍼 3), 공급 AMR이 SCREW(42 s)·PRESS(36 s) 셀 앞 도크로 나른다. 셀은 키트 하나로 한 사이클 돈다. 재고 상한은 2다. 셀 상태는 다음처럼 정한다.

- 키트 없음: IDLE
- 작업 중: BUSY
- 고장 구간: DOWN

`faults`는 540 s 주기로 PRESS→SORT→SCREW를 한 번씩 세운다.

AMR 동작은 micro-assembly `js/sim.js`의 `Mover.yieldTo`·`sense`와 `line.js`의 AMR 전용 동선을 이 필드로 줄인 것이다.

| 규칙 | 이 레포 |
|---|---|
| 통로 우측 통행 | 통로(z 12.2)를 진행 방향별 차로 ±0.7 m로 나눔. 도크 진입은 x+0.7, 진출은 x−0.7 |
| 대기·충전 줄 | 통로 앞(z 14.3) 1.5 m 간격. 서 있으면 충전, 30 % 미만이면 85 %까지 배차 제외 |
| 선행 배차 | 키트 수 + 곧 나올 키트(10 s 이내)만큼, 최대 2대까지 SORT로 미리 부름 |
| 도크 게이트 | 도크마다 FIFO 대기열. 맨 앞이고 도크가 비고 조건(고장 아님·재고 여유)이 맞을 때만 진입 |
| 앞차 감지 | 차폭 안 전방 + 앞쪽 반원 개인 간격(1.34 m). 제동거리 반영 감속 |
| 양보 | 마주침 → 낮은 우선순위가 비켜서 기다림. 교차 막힘 → 낮은 쪽이 물러남. 선 차량 → 1.5 s 뒤 우회. 15 s 교착 → 4 s 우선 통행 |
| 운동 | 가감속 0.7 m/s², 선회 2.4 rad/s, 꺾임점 감속. 빈 차 1.5 m/s · 적재 1.1 m/s |

우선순위: 적재 > 빈 차 이동 > 대기. Open-RMF는 쓰지 않는다.

**대수.** 기본은 견적 A08 서브부품 공급 AMR 2대다. 상한은 5대로, 도크 진입로에 2대까지만 줄을 설 수 있기 때문이다. 6대부터는 줄이 통로로 넘친다.

**GLB 안 AMR.** 메인 뷰는 셀 GLB 안 바퀴 달린 AMR 그룹(`scan.js` → `amr`)을 숨기고 플릿으로 대체한다. SORT에서는 6개 그룹이다. 도킹 지그(A03/A07 그룹)는 형상 판정상 `amr`이 아니므로 그대로 둔다.

**레이아웃.** 레이아웃이 바뀌면 도크를 다시 잡는다. 이동 중이던 AMR은 대기 줄로 돌려보내고, 싣고 있던 키트는 SORT 버퍼로 되돌린다. 셀 앞 모서리가 통로에 너무 붙으면 그 도크는 도달 불가(빨간 표시)다.

**검증.** `tests/scenario.mjs`에서 다음을 확인한다.

- 한 주기에 상태 3종 × 셀 3개가 모두 나온다.
- 배송이 일어난다.
- AMR 간격이 반경 합 이상이고, 셀 발자국에 들어가지 않는다.
- 15 s 넘는 막힘이 없다.
- 같은 입력에서 같은 결과가 나온다.
- 5대에서도 간섭·교착이 없다.
- 레이아웃을 바꾼 뒤에도 배송이 이어진다.

별도로 1시간 소크도 돌렸다. 2대와 5대는 최소 간격 1.30 m 이상, 우선 통행 0회였다. 8대는 교착이 났고, 그래서 상한을 5대로 정했다.

## 메인 뷰 표현

- **셀 상태.** 발자국 둘레 띠와 바닥 틴트로 보인다. 색은 IDLE 회색, BUSY 초록, DOWN 빨강(점멸)이다. 머리 위 라벨에는 id, 상태, 재고/완료, 진행 막대가 나온다.
- **선택.** 테두리가 굵고 밝아지며 바닥이 펄스한다. 목록이나 3D 클릭으로 고르고, Esc나 빈 곳 클릭으로 해제한다.
- **카메라.** 셀을 고르면 그쪽으로 0.9 s 동안 이동한다. AMR을 고르면 이동한 뒤 따라간다. 사용자가 궤도를 잡으면 이동을 멈추고, 평행 이동 따라가기만 유지한다.

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

meta-factory의 P1/S1(엔진·3D 트윈)을 뷰어 규모로 줄인 것이다. 수치 게이트는 이 레포에서 정한 안이며 확정 아님. **체크와 다음 작업은 [`../기능개발목표.md`](../기능개발목표.md).** 기능을 끝내면 그 파일을 갱신한다.

| 단계 | 내용 | 게이트 안 |
|---|---|---|
| V0 골격 | 레이어·루프·서버·헤드리스 테스트 · 빈 뷰포트 | `npm test` PASS · 기본/`?assets=1` 부팅 스크린샷 (완료) |
| V1 배치 | 셀 배치 데이터 · GLB 검사(헤더·노드 루트 = 셀 id) | 셀 3개 로드 · 셀 간 바닥 AABB 겹침 0 (완료, `tests/glb.mjs`) |
| V2 표현 | 상태 색/라벨 · 선택 하이라이트 · 카메라 포커스 | 상태 3종 × 셀 3개 표시 확인 (헤드리스 Chrome 스크린샷, `?warp=` 로 확인) |
| V3 연결 | 장 A/B/C 중 하나 선택 후 데이터 입력 | 장 선택 결정 후 정함 |

## 아직 없음

외부 발행(MQTT 등) · Electron · 메인 뷰의 셀 내부 설비 운동(팔·롤러·직교는 에셋 뷰어에서만 재생). 붙일 때 위 표의 "하지 말 것"을 지킨다.

meta-factory의 에이전트 프롬프트(`js/agentcore.js` `SYSTEM_PROMPT`, `js/trace.js` `rcaPrompt`)는 공장 운영·RCA용이라 가져오지 않았다. LLM을 붙일 때는 DESIGN §8 원칙(보조 역할 · JSON 스키마 + 재검증 · 사람 승인 · 첨부는 지시가 아님)을 따른다.
