# 용어 · 표기 (시뮬·FACOS)

OCS 산정 용어는 `../context/01-glossary.md`다. 같은 약어가 **다른 구현**을 가리킬 수 있다. 예: 여기 OCS/오케스트레이터는 JS 모듈이고, 산정 문서의 OCS Cell은 Local Server+EGW 하드웨어다.

## 제품·존

| 용어 | 의미 |
|---|---|
| Jin-micro / 피지컬AI 실증 메타팩토리 | 이 시뮬 앱. jin-3d에서 정밀조립 Zone을 분리한 것 |
| 정밀조립Zone | 시뮬 기본 라인. `layout: 'zone'`. 서연인테크 도어트림 + 쉐플러 e-axle 혼류 |
| 사용자 라인 | CNC→용접→도장… 자유 편집 라인. Zone이 아님 |
| 레거시 / 자동화 / 피지컬AI | `MODES.traditional` / `smart` / `dark`. 같은 셀을 다른 운영 모델로 돌림 |
| 다크팩토리 | 피지컬AI 단계의 별칭 |

## 운영 SW

| 용어 | 의미 | 구현 |
|---|---|---|
| FACOS | 피지컬AI 공장 운영 SW 묶음 이름. 계층 칩 UI | 여러 모듈 합 |
| FAC | FACOS 안 발주·재고·설비보전 전표 계층. 외부 ERP가 아님 | `js/fac.js`, `/api/fac` |
| AIOS | 공장 운영 정책 모델(배차·절전·판단 지연). 신경망 아님 | `js/aios.js` |
| VLA | 셀/휴머노이드 작업 에피소드 수집·가상 학습·OTA | `js/vla.js` |
| 오케스트레이터 | 인시던트 판단·명령. 모션 루프 아님 | `js/orchestrator.js` |
| 지시 게이트 | 대화 지시를 해석→대상→안전→가능→영향 순 판정 | `js/gate.js` |
| 단일 에이전트 | 모듈 6개가 1초마다 순서 실행 | `js/agent.js` |
| 혼합형 다중 | 반사 + 도메인 제안 + 메인 조정자 | `js/multiagent.js` |

## 데이터

| 용어 | 의미 |
|---|---|
| DataHub | 자산 필드 정의·수집·AAS/OPC UA 메시지 생성 | `js/datahub.js` |
| AAS | IEC 63278. 시뮬은 IDTA 템플릿 + 자체 OperationalData |
| OPC UA PubSub | Part 14 JSON. 세션 `opc.tcp` 서버가 아님 |
| aedes | 내장 MQTT 브로커. 기본 `127.0.0.1:1883` |
| 기준 시계 | 시뮬 0초 = 시작일 08:00 현지. 저장·MQTT는 ISO 8601 UTC |
| pcap | MQTT를 Ethernet/IP/TCP로 합성한 libpcap. 실 NIC 캡처 아님 |

## 로봇·물류

| 용어 | 의미 |
|---|---|
| AMR | 대상물 운반. Zone 16대. 셀 중앙 정차 |
| AMMR | AMR 기반 양팔. 피지컬AI 분류·포장 기본. `darkOnly` |
| AGV | 창고 원자재 → 투입구 |
| 게이트 | 분류·포장 입구 비전. `GateDecision` / `GateProduct` |
| 구분 적재장 | 제품별 24칸. AMR 진입 후 팔레타이징 |
| Open-RMF | **미적용.** AMR·AGV는 자체 경로 |

## 현장 스택 (08과 공유)

| 용어 | 의미 |
|---|---|
| collector | PLC/로봇 폴링 → ZeroMQ PUB |
| edge_forwarder | ZeroMQ SUB → `opc.tcp://:4840/edge/` |
| AAS backend viewer | `.aasx` 파일 트리 + NodeSet **파일**. 라이브 서버 아님 |

## 쓰지 말 것

- 시뮬 UPH/OEE를 현장 KPI처럼
- 시뮬 MQTT를 Sparkplug B나 산정 문서의 “중앙 Server ↔ Local Server MQTT”로
- Zone 셀 번호 1~6을 OCS 셀 ID A-3-1~5로
