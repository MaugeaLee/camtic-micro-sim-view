# 개발 주요 아키텍처

코드를 어디에 둘지, 무엇을 붙일지 결정할 때 이 파일을 먼저 본다. 세부 스펙은 번호 문서로 내려간다.

세 장을 **같은 시스템처럼 그리지 말 것.**

| 장 | 상태 | 지식 |
|---|---|---|
| A. 목표 OCS (실증 존) | 설계 추정. Sparkplug·Machbase·Airflow 미구현 | `../context/02-architecture.md` |
| B. Jin-micro 시뮬 | 동작 중. 브라우저가 공장 | `02`–`07` |
| C. CAMTIC 현장 수집 | 동작 중. ZMQ → 세션 OPC UA | `08` |
| 조인 | 브리지 있음(V3-3, DTO 가정). 장 C 연결 미확인 | `09` |

---

## 1. 전체 맵

```
                    ┌─ 설계만 ─────────────────────────────────────────┐
                    │  Enterprise AAS / Data Lake                      │
                    │       ↕ MQTT Sparkplug B / REST   (코드 없음)     │
                    │  Local Server (OCS Cell)                         │
                    └──────────────────────────────────────────────────┘

장 B 시뮬 (theuniversepark/micro-assembly)          장 C 현장
┌─────────────────────────────────────┐            ┌──────────────────────────┐
│  Browser = 시뮬 + 3D + 에이전트      │            │ PLC / 로봇 컨트롤러        │
│    sim.js ──► factory.js / UI        │            │   Modbus / MC / XGT       │
│    agent / orchestrator / gate       │            └──────────┬───────────────┘
│    datahub.js ── AAS · PubSub JSON   │                       │ ZeroMQ
│         │ POST /api/mqtt/publish     │            collector-plc :5556
│         ▼  (Pages면 여기서 끝)        │            collector_robot :5557
│  Node server :8765                   │                       │
│    aedes MQTT :1883                  │            ┌──────────┴──────────┐
│    FAC / VLA / AIOS / 영상           │            │ edge_forwarder      │
│    Claude (키는 서버만)               │            │ opc.tcp://:4840/edge│
└──────────┬──────────────────────────┘            │ ingest :8000        │
           │ AASX 파일                              └─────────────────────┘
           ▼
  aas-backend-viewer :8000     ← 트리만. 라이브 값 없음
  (camtic-aas-web-viewer = 빈 폴더)

  MQTT ──bridge.mjs──► ZMQ PUB collector.sim.*   (V3-3, DTO 가정 · edge_forwarder 수신 미확인)
```

이 레포(`camtic-micro-sim-view`)는 산정(`context/`) + 스펙(`docx/`) 작업 공간이고, 셀 GLB 렌더 뷰어 골격(`10-viewer.md`)이 하나 있다. 뷰어는 시뮬 런타임이 아니며 위 어느 장에도 아직 붙지 않았다.

---

## 2. 장 B — 시뮬 런타임

프레임워크 없음. **브라우저 한 프로세스**가 틱·렌더·의사결정·메시지 생성을 한다. Node는 선택 부가물이다.

```
index.html
    │ import map
    ▼
js/main.js          부트 · rAF 루프 · 모듈 배선
    │
    ├─ sim.js           권위 있는 공장 상태 (틱, MODES, 경로, ID)
    ├─ line.js          라인/Zone 상수 (서버 line-designer와 공유, DOM 없음)
    ├─ factory.js       Three.js 뷰. 상태만 그림
    ├─ ui.js            패널 · 팝업
    │
    ├─ 결정
    │    agent.js / multiagent.js    1초(시뮬) 운영
    │    orchestrator.js             인시던트 P1–P5
    │    commands.js                 셀 ACK → 실행 → 완료
    │    gate.js + dialog.js         운영자 지시
    │    impact.js / aios.js / vla.js
    │
    └─ 데이터
         datahub.js ──► aas.js / aasx.js
                    ──► POST /api/mqtt/publish   (서버 있을 때)
                    ──► 파일 저장 (Pages에서도)
```

규칙:

- `sim.js`가 상태의 단일 소스. 뷰·에이전트는 읽고 명령을 되돌린다.
- 에이전트 주기 = **시뮬 1초**. 렌더 = `requestAnimationFrame`. 배속 1/3/10/30×.
- `*.github.io` → `JIN3D_NO_SERVER`. Claude·MQTT·FAC GET 없음. 3D·KPI·AAS 파일은 됨.
- 로컬: `npm start` → `:8765`. Electron은 영상 포트 **47615**를 고정.

서버는 시뮬을 돌리지 않는다. 브라우저가 만든 페이로드를 브로커/디스크/Claude로 넘길 뿐이다.

| 서버 모듈 | 역할 |
|---|---|
| `app-server.mjs` | 정적 + API 라우트 |
| `mqtt-gateway.mjs` | aedes. 기본 `127.0.0.1:1883` |
| `fac-api.mjs` | 메모리 전표. GET 읽기 전용 |
| `llm-agent.mjs` | 지시 해석 도구 루프. 운전 루프에 안 들어감 |
| `video-convert.mjs` | ffmpeg WebM→MP4 |

---

## 3. 결정 경로 (시뮬 안)

```
현장 이벤트 / KPI / 순찰
        │
        ▼
 반사 계층 ─────────────── 즉시 실행 (배차·절전·충전·투입 보류)
 도메인 에이전트 ─┐
 순찰 보고 ──────┤ 제안 큐
                 ▼
            메인 조정자     안전 → 중복 → 충돌 → 승인
                 │
                 ▼
            오케스트레이터  P1 인명 … P5 효율
                 │
                 ▼
            commands.js    셀 컨트롤러 (ACK/실행/완료)
                 │
                 ├─ 3D · 라벨 · 텔레메트리
                 ├─ MQTT …/Commands
                 └─ FAC 전표 (자동화·피지컬AI)
```

운영자 문장은 이 경로 앞에 게이트가 있다: 해석 → 대상 → 안전 → 가능 → 영향. 한 단 실패면 거절.

레거시 = 수동(안돈). 자동화 기본 = 단일 에이전트. 피지컬AI 기본 = 혼합형.

OCS 산정의 “OCS Cell = Local Server + EGW, 모션 금지”와 역할은 같게 두되, **구현체는 JS 모듈**이다. 하드웨어 OCS가 아니다.

---

## 4. 데이터 경로 비교

같은 “AAS / OPC UA / MQTT” 단어가 장마다 다른 프로토콜이다.

| | 장 A 목표 | 장 B 시뮬 | 장 C 현장 |
|---|---|---|---|
| 실시간 값 | OPC UA Aggregation → TSDB | DataHub 10초 스냅샷 | collector 폴링 → ZMQ |
|  ent | MQTT **Sparkplug B** | OPC UA **PubSub JSON** over MQTT | 없음 |
| OPC UA | 세션 + 집선 | PubSub만. `opc.tcp` 서버 없음 | 세션 `:4840/edge/` (읽기) |
| AAS | Enterprise + 로컬 복제 | 파일 쓰기 (v3.1 기본) | `.aasx` 업로드 후 트리 |
| 시각 | PTP / TSN | 시뮬 0초 = 08:00, ISO UTC | `timestamp_ms` |

시뮬 토픽:

- `opcua/json/data/jin3d/MetaFactory/<자산>`
- `…/Events` · `…/Commands`
- `opcua/json/metadata/…` (retain)
- `aas/jin3d/environment` (retain)

AAS IRI: `https://camtic.or.kr/aas/jin3d/<자산>`.

---

## 5. 장 C — 현장 수집 (있는 코드)

```
Field ──► collector ──ZMQ PUB──► ┬─ edge_forwarder ── opc.tcp :4840/edge/
                                 └─ ingest (로그, HQ 업로드)
ingest ──ZMQ PUB cmd──► collector   SET_SCAN / SET_DEVICE만
                                     로봇 쓰기 = 전부 reject
```

AAS viewer는 이 파이프에 없다. 파일을 읽어 NodeSet **파일**을 만든다. 라이브 서버가 아니다.

---

## 6. 역할 분리 (개발 시 유지)

| 층 | 해도 됨 | 하지 말 것 |
|---|---|---|
| 셀 PLC / 시뮬 셀 컨트롤러 | 그 셀 정지·속도·ACK | 공장 전체 재계획 |
| 오케스트레이터 / OCS | 수집·감독·재계획·HOLD | 모션 루프 (EtherCAT/관절 IK는 셀·`sim.js`) |
| DataHub / EGW | 정규화·AAS 매핑·발행 | 학습, PLC 직접 제어 |
| VLA / Isaac (목표) | 에피소드·모델 | 실설비 시운전 |
| AIOS / impact | 정책 레버·트윈 비교 | 틱 물리 |
| DMWorks (목표) | 검증 DT | AI 학습, CAM |
| AAS viewer | 패키지 탐색·NodeSet export | 라이브 조인트, MQTT 구독 |

---

## 7. 이 레포에서 손댈 자리

렌더 뷰어(`10-viewer.md`)는 셀 GLB 표시용 골격이다. 여기에 기능을 붙일 때도 “어느 장에 붙는 viewer인가”를 먼저 고른다.

1. 장 B 구독 — MQTT/FAC GET 대시보드. 3D 불필요. Pages에서는 불가. **골랐음(V3-0)·구현됨(V3-1)**: `/dashboard`, `server/mqtt.mjs` `server/chapter-b.mjs` `js/data/pubsub.js`. 구독만, 발행 없음. 3D 뷰와는 따로 있다.
2. 장 C 조회 — AAS viewer 프론트 (`camtic-aas-web-viewer`가 비어 있음).
3. 조인 — MQTT→ZMQ 브리지. 장 B와 C를 처음으로 잇는 작업. **구현됨(V3-3, 가정 형식)**: `bridge.mjs` `server/join.mjs` `server/zmtp.mjs`. 장 C DTO 대조·edge_forwarder 연결은 남음. `09` 참고. (장 C 조회 V3-2 는 보류)

존 예산·셀 대수·견적은 `context/`만 본다. 시뮬 셀 ID(SORT…)와 A-3-n을 맞추지 않는다.
