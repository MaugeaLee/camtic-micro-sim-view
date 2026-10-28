# camtic-micro-sim-view

총괄5-세부1 로컬 OCS·시뮬레이션 Cell 작업 공간 + 셀 GLB 렌더 뷰어.

에이전트용 도메인 콘텍스트는 [`context/`](context/README.md). 뷰어 아키텍처는 [`docx/10-viewer.md`](docx/10-viewer.md). 기능 체크리스트는 [`기능개발목표.md`](기능개발목표.md). 원문: [로컬 OCS 구성](https://theuniversepark.github.io/micro-cell/).

---

## 프론트 서버 실행

프레임워크·번들러 없음. `npm install` 하지 않는다. Node가 정적 파일과 읽기 전용 API만 연다. 브라우저가 뷰어다.

### 1. 준비

- [Node.js](https://nodejs.org/) **20 이상** (이 레포 확인: 24.x)
- 저장소를 받은 뒤 터미널에서 루트로 이동

```powershell
cd d:\Workspace\codebase\camtic-micro-sim-view
node --version
```

`node`를 못 찾으면 Windows에서 설치 경로를 PATH에 넣는다.

```powershell
$env:Path = "C:\Program Files\nodejs;$env:Path"
node --version
```

### 2. 환경 파일

포트·바인드·에셋 경로는 `.env`가 기준이다. API 라우트는 `server/env.mjs` 상수다. git에는 `.env.example`만 올린다.

```powershell
copy .env.example .env
```

| 키 | 예 | 의미 |
|---|---|---|
| `HOST` | `127.0.0.1` | 리슨 주소. LAN이면 `0.0.0.0` |
| `PORT` | `8790` | 리슨 포트 |
| `APP_NAME` | `micro-cell-viewer` | `/api/status` 이름 |
| `ASSET_DIR` | `src/render_asset` | GLB 디스크 경로 |
| `ASSET_URL` | `/assets` | 브라우저가 GLB를 받는 URL |
| `LAYOUT_FILE` | `data/layout.json` | 쓰는 자리. 없으면 `src/layout.default.json`만 읽는다. PUT은 여기만 씀 |

이미 있는 환경변수가 `.env`보다 우선한다. 브라우저는 `.env`를 읽지 않고, 서버가 `index.html`에 `window.__ENV`로 공개 값만 넣는다. API 경로는 `/api/status` `/api/assets` `/api/config` `/api/asset-viewer` `/api/layout` `/api/process` `/api/docs` `/api/openapi.json`. PUT은 `/api/layout`만(127.0.0.1).

### 3. 서버 시작

```powershell
npm start
```

또는 `node server.mjs`. 콘솔의 `Micro-Cell Viewer → http://<HOST>:<PORT>`가 접속 주소다.

micro-assembly 없이 장 B 구독 화면(`/dashboard`)을 돌려 보려면 데모 소스와 같이 띄운다:

```powershell
npm run demo
```

`node server.mjs --b-demo`와 같다. 서버 안에서 이 뷰어 시뮬(고장 시나리오, 기본 4배속, `B_DEMO_SPEED`로 바꿈)을 돌려 OPC UA PubSub JSON을 프로세스 안 MQTT 브로커로, 생산·출고 기록을 가짜 FAC API로 내보낸다. 포트는 127.0.0.1 임시 포트다. `.env`의 `B_MQTT_URL`·`B_FAC_URL` 대신 쓴다. 화면에 「데모 소스」 배지가 붙는다. 값은 시뮬 가정값이다.

조인 브리지(장 B MQTT → ZeroMQ, V3-3)는 뷰어와 따로 띄운다. 메시지 형식은 **가정**이다. 장 C의 실제 형식과 대조한 적이 없다(`docx/09-limits-and-join.md` 「조인」).

```powershell
npm run bridge            # B_MQTT_URL 구독 → tcp://127.0.0.1:5558 PUB
npm run bridge -- --b-demo  # 데모 소스를 구독
```

### 4. 브라우저

`.env`가 예제 그대로면:

| URL | 내용 |
|---|---|
| http://127.0.0.1:8790/ | 빈 뷰포트 + 셀 목록 (GLB 안 받음) |
| http://127.0.0.1:8790/?assets=1 | `PRESS` `SCREW` `SORT` GLB 로드 |
| http://127.0.0.1:8790/?build=1 | Admin 모드로 시작 (타이틀 옆 버튼과 같음) |
| http://127.0.0.1:8790/api/layout | 셀 자리 JSON |
| http://127.0.0.1:8790/api/layout?download=1 | 같은 JSON을 파일로 |
| http://127.0.0.1:8790/api/process | 셀 공정 정의(가정값, 읽기 전용) |
| http://127.0.0.1:8790/api/docs | Swagger UI (엔드포인트 조회·GET 실행) |
| http://127.0.0.1:8790/api/openapi.json | OpenAPI 3 스펙 |
| http://127.0.0.1:8790/api/asset-viewer | 테스트 뷰포트 (브라우저) |
| http://127.0.0.1:8790/api/asset-viewer?key=PRESS | 해당 셀만 미리보기 |
| http://127.0.0.1:8790/api/asset-viewer?format=json | Three.js가 읽는 GLB/GLTF 목록 |
| http://127.0.0.1:8790/dashboard | 장 B 구독(MQTT·FAC) + 수신 점검. 3D 뷰어 상단 「구독·점검」 링크와 같다 |
| http://127.0.0.1:8790/api/b/inspect | 수신 점검 JSON(토픽별 건수·속도·seq 누락·해석 오류, 최근 원문 50건) |
| http://127.0.0.1:8790/?scenario=faults&focus=DRONE-01 | 고장 시나리오. 셀이 멈추면 드론이 위에서 중계 |
| http://127.0.0.1:8790/?focus=HOUND-02 | 설비 점검 견마 따라가기 |
| http://127.0.0.1:8790/?drones=0&inspect=0 | 드론·점검 견마 끄기(드론은 `0`~`3`대) |

재생·배속은 상단. 셀 목록에서 선택. 개발자 도구 콘솔에서 수동 로드:

```js
__viewer.loadAssets()
```

자리는 `.env`의 `LAYOUT_FILE`(기본 `data/layout.json`)이다. 파일이 없으면 `src/layout.default.json`을 읽기만 한다. 레이아웃(v2)에는 셀 자리와 AMR 경로(루트·충전 자리·셀 안 지점)가 같이 들어 있다. Admin(`?build=1`, 경로 편집은 `?build=route`)에서 고친 뒤 「저장」하거나 올리면 `LAYOUT_FILE`에만 쓴다. 이전 v1 파일은 기본 AMR 경로를 붙여 읽는다.

서버를 띄운 채 코드를 받아오면(`git pull`) 서버도 다시 띄운다. 서버가 시작할 때 읽은 레이아웃 검증 코드로 응답하기 때문이다.

### 5. 확인

```powershell
npm test
```

서버가 켜진 뒤 상태 URL은 `/api/status`다.

```powershell
curl http://127.0.0.1:8790/api/status
curl http://127.0.0.1:8790/api/config
curl http://127.0.0.1:8790/api/openapi.json
```

### 6. 멈추기

서버를 띄운 터미널에서 `Ctrl+C`.

---

## 공정 순서 · 카메라

도어트림은 지그 위에 얹힌 채로 움직인다. 메인 AMR = 지그·도어트림 운반. 서브 AMR = 조립 부품 운반. 2번은 1·3과 동시에 돌아갈 수 있다. 공정 추적 카메라는 도어트림이 아니라 아래 **보기** 장비를 본다.

| 단계 | 하는 일 | 카메라 |
| --- | --- | --- |
| 0 | 메인 AMR이 정박(충전) 자리에서 출발. 선반 지그를 실으러 간다. | **메인 AMR** 뒤-위. 출발·방향이 보이게. 창고로 자르지 않음. |
| 1-1 | 원재료 창고. 선반에 지그째 대기. 메인 AMR이 싣고 SORT 뒤쪽으로 간다. | **메인 AMR 유지.** 창고 선반이 한 화면에 들어오게 옆-앞에서 보되, 시점은 AMR. |
| 1-2 | SORT 입고. 양팔이 AMR에서 받아 랙에 올린다. | **SORT 양팔 + 뒤쪽 입고 칸.** 셀 남쪽(랙 뒤)에서 양팔·AMR이 같이 보이게. |
| 2-1 | 서브 AMR 출발. 조립 부품 창고로 가서 싣고 SORT로 향한다. | **서브 AMR** 뒤-위. 창고 쪽으로 가는 길이 보이게. |
| 2-2 | 조립 부품을 SORT에 입고. 레일로 목적 레인에 분류된다. | **SORT 투입·분류 레인.** 서쪽에서 약간 높게. 투입 이송기·컨베이어·레인 갈림이 한 화면에. 토트를 내린 뒤 서브 AMR을 따라가지 않음. |
| 3-1 | SORT 출고. 양팔이 랙에서 집어 메인 AMR 위에 올린다. | **SORT 양팔 + 북쪽 출고 칸.** 메인 AMR 적재면과 양팔이 같이 보이게. |
| 3-2 | SORT 조립 부품 출고. 이송기가 조립 부품을 서브 AMR 위에 올린다. | **그 레인 끝 이송기 + 대기 중인 서브 AMR.** 레인 한 줄이 보이게. |
| 3-3 | 서브 AMR이 필요한 셀 라인으로 부품을 가져간다. | **그 서브 AMR** 뒤-위. 도착 라인 도크가 앞에 들어오게. |
| 4 | 메인 AMR이 SCREW로 간다. | **메인 AMR** 뒤-위. 경로와 다음 셀이 보이게. |
| 5 | SCREW 1차 체결. 리프트가 지그를 들고 AMR은 밑으로 빠진다. 벨트라인 몰딩·스피커 그릴을 붙인 뒤 스크류 체결. 빈 AMR이 받아 나간다. | **SCREW 셀.** 리프트와 작업 팔을 중심에. 빠지는 AMR을 따라가지 않음. 작업이 끝날 때까지 셀에 고정. |
| 6 | 메인 AMR이 PRESS로 간다. | **메인 AMR** 뒤-위. |
| 7 | PRESS 압입. 손잡이·스위치 베젤·클립·파워 스위치 압입, 그리스, 검사. 빈 AMR이 받아 나간다. | **PRESS 셀.** 리프트와 작업 팔을 중심에. 작업 끝날 때까지 고정. |
| 8 | 메인 AMR이 SCREW로 다시 간다. | **메인 AMR** 뒤-위. |
| 9 | SCREW 2차 체결. 인서트·컵홀더 포켓, 스크류, 토크 검사. 완료품 구역으로 나간다. | **SCREW 셀.** 1차와 같은 셀이지만 동쪽 작업(인서트·포켓)이 보이게. |
| 10 | 완료품 적재. 협동로봇이 지그에서 도어트림만 집어 책장에 세운다. 빈 지그는 AMR이 가져간다. | **완료품 구역.** 협동로봇과 책장. 빈 지그 싣고 떠나는 AMR을 따라가지 않음. |

상단 「공정 추적」은 이 순서의 다음 입고를 잡아 타임라인을 남긴다. 추적 중에는 화면을 눌러도 카메라가 유지되고, 좌·우 패널은 그대로 쓴다. 해제는 상단 「추적 중」. 끝나면 카메라는 추적 전 화면으로 돌아간다. `?trace=1`.

---

## 디렉터리 (실행에 쓰는 것)

```
index.html          셸 · import map
css/                스타일
js/                 브라우저 모듈 (진입 js/main.js)
vendor/three/       Three r186 (레포에 포함)
.env.example        배포용 키 목록 (복사해서 .env)
server.mjs          npm start
server/             정적 화이트리스트 + API
src/render_asset/   PRESS.glb SCREW.glb SORT.glb quadruped.glb drone.glb doortrim.glb (견마·드론 출처: vendor/)
src/layout.default.json  기본 자리 + AMR 경로 (읽기 전용 fallback)
src/process.default.json 셀 공정 정의(가정값): PRESS 스테이션 흐름·작업 지점·부품 치수, SORT 랙·SCREW 지그 칸
data/layout.json         쓰는 자리 (LAYOUT_FILE, git 제외)
tests/              Node 헤드리스
```

`context/` `docx/` `src/origin_asset/`는 서버가 열지 않는다.

---

## 장 B 데이터가 제대로 들어오는지 보기 (수신 점검)

`/dashboard` 맨 위 「수신 점검」 카드. 서버가 받은 것과 화면에 그린 것을 나란히 본다.

- **요약 줄**: 받은 메시지 수 · 토픽 수 · 풀린 항목 수(서버 / 화면, 같으면 「일치」) · seq 누락 · 해석 오류 · 자산 상한으로 버린 건수.
- **토픽 표**: 토픽별 건수, 초당 건수(지수 평균), 누적 크기, seq 누락, 해석 오류, 마지막 수신. 누락은 노란색, 오류는 빨간색으로 칠한다.
  - seq 누락은 (PublisherId, DataSetWriter)별 `SequenceNumber`가 1보다 크게 뛴 만큼이다.
  - 번호가 줄어들면 누락이 아니라 재시작으로 센다.
- **최근 메시지 50건**: 하나를 고르면 세 가지를 같이 보여 준다.
  - 원문 JSON(4 KB에서 자름);
  - 서버가 풀어낸 항목;
  - 「화면 반영」: 그 값이 지금 자산 표와 같은지, 아니면 그 뒤에 더 새 값이 왔는지(seq 비교).

원문은 SSE로 흘리지 않는다. 카드가 펼쳐져 있고 탭이 보일 때만 1초마다 `/api/b/inspect`로 가져온다. 데모 소스는 일부러 45초마다 AMR 값 한 건을 빠뜨리고 60초마다 JSON이 아닌 메시지를 한 건 섞는다. 점검이 그걸 잡는지 보려는 것이다.

---

## 데이터 누적 오버헤드

장 B 구독은 켜 둘수록 메시지가 쌓인다. 어디에 쌓이는지, 지금 무엇으로 막는지, 숫자가 어떤지, 더 커지면 무엇을 할지를 적는다. 수치는 `tests/b-load.mjs`로 쟀다(Node 24, 이 개발 PC). 다른 장비에서는 다르다.

### 쌓이는 곳과 지금 막는 방법

| 쌓이는 곳 | 그대로 두면 | 지금 |
|---|---|---|
| 자산 표(`BStore.assets`) | 자산·필드가 새로 올 때마다 늘어남 | 자산 500 · 자산당 필드 200 상한, 넘친 것은 `dropped`로 셈 |
| 이벤트·명령 목록 | 끝없이 늚 | 최신 300 · 200건만 (명령은 CommandId별 최신 1건) |
| 0.5 s SSE 배치 | 메시지 수에 비례 | 같은 자산 값은 한 건으로 합침(`coalesce`). 배치 ≤ 자산 수 + 이벤트 수 |
| 플러시 전 대기열 | 폭주 시 0.5 s 동안 무한정 | 2000 항목 넘으면 미리 합침 |
| 느린 브라우저(SSE 소켓 버퍼) | 서버 메모리에 쌓임 | 버퍼 1 MB 넘으면 그 클라이언트는 건너뜀 → 따라잡으면 스냅샷 한 번으로 다시 맞춤 |
| 수신 점검 통계 | 토픽마다 늘어남 | 토픽 300 상한(넘친 건 따로 셈), 원문 링 50건 · 건당 4 KB |
| 화면 다시 그리기 | 배치마다 표 전체 | 바뀐 구역만(자산 / 이벤트 / 명령 / FAC / 점검) 0.5 s마다. 목록은 앞 150행만 |
| FAC 이벤트(브라우저) | 운전 내내 늚 | 최신 300건, 운전(run)이 바뀌면 비움. 업스트림 FAC도 20000건 상한 |

### 잰 값

- **20만 건 부하**(자산 50개 × 필드 20, 이벤트 1 %):
  - 처리 1.4 s(건당 약 7 µs);
  - 힙 증가 0 MB 근처;
  - 스냅샷 61 KB, 점검 응답 97 KB;
  - 0.5 s 배치 최대 100 항목.
- **배치 합치기 효과**(자산 50개, 필드 20개 기준, 0.5 s 배치 한 번의 크기):

| 초당 메시지 | 합치기 전 | 합친 뒤 | 1시간 SSE (전 → 후) |
|---|---|---|---|
| 100 | 51 KB | 52 KB | 361 MB → 363 MB |
| 1000 | 514 KB | 52 KB | 3.6 GB → 364 MB |
| 5000 | 2.5 MB | 52 KB | 18 GB → 365 MB |

자산마다 0.5 s에 한 번 이하로 오면 합칠 것이 없어서 효과가 없다(첫 줄). 이득은 고빈도 텔레메트리에서 난다. 메모리는 상한 덕에 시간에 비례하지 않고, 대역은 자산 수 × 필드 수에 비례한다.

### 남은 문제와 다음 대책

1. **값이 안 바뀌어도 매번 보냄.** 배치에 필드 전체가 실린다(위 표의 52 KB 바닥).
   - 대책: 직전 배치 대비 바뀐 필드만 보내는 델타 전송. 스냅샷은 그대로 둔다.
   - 같은 원리로 숫자는 소수 자릿수를 줄인다.
2. **이력이 없다.** 화면은 최신 값과 최근 이벤트만 들고 있다. 추세·감사 기록이 필요하면 브라우저나 이 서버 메모리에 쌓지 않는다.
   - 시계열 DB(예: TimescaleDB, InfluxDB 계열)나 파일로 분리한다.
   - 보존 기간과 다운샘플링(1 s → 1 min 평균)을 둔다.
   - 보관 기간은 미확정이다(`context/07-open-issues.md`). 정해지기 전에 값을 박지 않는다.
3. **자산·이벤트가 수천 개가 되면 표 그리기가 무거워진다.**
   - 가상 스크롤(보이는 행만 DOM);
   - 자산 검색·필터;
   - 이벤트 등급별 상한.
4. **클라이언트가 많아지면** 배치 JSON을 클라이언트마다 다시 만들지 않는다. 지금도 배치당 한 번만 직렬화한다.
   - 그 위로는 브로커(MQTT over WebSocket)를 브라우저가 직접 구독하게 하거나, 앞단에 SSE 팬아웃 프록시를 둔다.
5. **브로커 쪽 폭주** (retained 남발, 큰 AAS 환경 메시지):
   - 구독 토픽(`B_MQTT_TOPICS`)을 좁힌다.
   - 패킷 상한(32 MB)을 운영값으로 낮춘다.
   - AAS 환경은 크기만 센다(지금도 본문을 쌓지 않는다).
6. **FAC 이벤트 폴링**: `since` 커서로 증분만 받는다.
   - 지금은 run이 바뀔 때만 비운다.
   - 업스트림이 20000건 상한으로 앞부분을 버리면 그 구간은 화면에 없다. 업스트림이 돌려준 `next`가 커서보다 앞이면 처음부터 다시 받는 처리가 다음 할 일이다.
   - 장시간 운전 기록은 FAC 쪽 DB에서 조회하게 한다.

---

## 자주 막히는 곳

| 증상 | 확인 |
|---|---|
| `'node' 명령을 찾을 수 없습니다` | Node 설치, PATH (`C:\Program Files\nodejs`) |
| 포트 사용 중 | 다른 `node server.mjs` 종료, 또는 `.env`의 `PORT` 변경 |
| 화면은 뜨는데 모델이 없음 | 기본은 에셋을 안 받는다. `?assets=1` 또는 `__viewer.loadAssets()` |
| `npm install` 실패 | 의존성 없다. 설치할 패키지 없음 |
| `file://`로 index.html을 연 경우 | 모듈·API가 막힌다. 반드시 `npm start` 후 http로 연다 |
| `/dashboard`가 비어 있음 · MQTT 재시도 | micro-assembly(브로커 1883·FAC 8765)가 안 떠 있다. `npm run demo`로 데모 소스를 쓰거나 `.env`의 `B_MQTT_URL`·`B_FAC_URL` 확인 |
