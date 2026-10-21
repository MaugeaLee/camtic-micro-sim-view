# CAMTIC 관련 시스템

로컬 `d:\Workspace\codebase` 기준. 시뮬 MQTT/PubSub를 받는 구현은 **없다.**

## 한눈에

```
현장 PLC/로봇
  │  Modbus TCP/RTU · Mitsubishi MC · LS XGT
  ▼
collector-plc (:5556) / collector_robot_modbus (:5557)
  │  ZeroMQ PUB  collector.{plc|robot}.{device_key}.{data|health|ack}
  ├─► middleware_edge_forwarder  → opc.tcp://:4840/edge/
  └─► embedded_ingest            → 로그 · 일일 HTTP 업로드
         ▲
         │ ZeroMQ PUB middleware.gateway.cmd_*  (:5555)

별트랙(파일만):
  .aasx ─► camtic-aas-backend-viewer ─► 트리 + nodeset.xml / engineering.csv / syscfg.json
```

산정 문서의 “Local Server ↔ Enterprise = MQTT Sparkplug B”는 **설계만**. 이 폴더 어떤 레포도 Sparkplug를 말하지 않는다.

## AAS backend viewer

경로: `camtic-aas-backend-viewer`. FastAPI + BaSyx SDK 2.x. 기본 `127.0.0.1:8000`.

- 입력: `AASX_DATA_DIR`의 `.aasx` 또는 `POST /api/packages` (필드 `file`).
- 출력: `/viewer.html?package=`, `/api/packages/{id}/tree|environment`, 산출물 ZIP.
- 산출물: I4AAS/OPC 30270 **개념**. `syscfg.json` 엔드포인트 템플릿 `opc.tcp://127.0.0.1:4840` — **서버 기동 안 함**.
- id는 AAS Part 2식 base64url. `{package_id}` = 파일명(확장자 제외).
- 로컬 샘플: CAMTIC CNC, Hyundai HH7 pick-and-place AASX.
- 없음: MQTT, 라이브 Property write, BaSyx 레지스트리, 3D.

`camtic-aas-web-viewer`: 빈 폴더. git 없음.

## middleware_gateway_opc_ua

세션 OPC UA 클라이언트/서버를 **따로** 띄움. `gateway` 모드 없음. 카탈로그 `catalog/tags.yaml`. 북바운드 기본 `:4841/gateway/`. NodeSet import 없음. MQTT/PubSub/ZeroMQ/AAS 없음.

## middleware_edge_forwarder

ZeroMQ SUB → 세션 OPC UA `:4840/edge/`, NS `urn:middleware:edge:forwarder:tags`. 기본 kind=`plc`만. 로봇은 `:5557`을 `ZMQ_SUB_ENDPOINTS`에 추가하고 kinds에 `robot`. 명령은 안 보냄.

## collector-plc

모드: `modbus_tcp` · `modbus_rtu` · `mc` · `xgt`. PUB `:5556`. 구현 명령 `SET_SCAN` `SET_DEVICE`. `READ_ONCE`/`STOP`은 E-4102.

## collector_robot_modbus

Hyundai HI6 프로파일. PUB `:5557`, `DEVICE_KEY` 기본 `robot-1`. 모든 명령 ACK rejected/E-4102.

## embedded_ingest

엣지 설정·로그·HQ 업로드. HTTP 기본 `:8000` → **AAS viewer와 포트 충돌**. CMD PUB `:5555`. AAS/MQTT/OPC UA 없음.

## 포트 맵

| 역할 | 기본 |
|---|---|
| 시뮬 웹 | 8765 |
| 시뮬 MQTT | 1883 |
| 시뮬 Electron 영상 | 47615 |
| AAS viewer HTTP | 8000 |
| ingest HTTP | 8000 |
| PLC ZMQ | 5556 |
| robot ZMQ | 5557 |
| cmd ZMQ | 5555 |
| edge OPC UA | 4840/edge/ |
| gateway north | 4841/gateway/ |
| AAS syscfg 템플릿 | 4840 (미기동) |

## 이 레포

`camtic-micro-sim-view`는 코드 런타임이 아니다. `context/` = OCS 산정, `docx/` = 이 구현 스펙. viewer를 여기 심을 자리다.
