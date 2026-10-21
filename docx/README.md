# 시뮬·연동 시스템 콘텍스트

에이전트가 [피지컬AI 실증 메타팩토리](https://theuniversepark.github.io/micro-assembly/)와 CAMTIC 수집/AAS 스택을 다시 훑지 않고도 쓰게 압축한 지식이다. 이 폴더가 **구현·스펙** 소스 오브 트루스다.

OCS 산정·견적·존 예산은 여기가 아니다. 그건 [`../context/`](../context/README.md)다. **두 폴더를 섞지 말 것.**

| 파일 | 언제 읽나 |
|---|---|
| `ARCHITECTURE.md` | 개발 아키텍처 한 장. 장 A/B/C를 어디에 붙일지 |
| `00-source-and-status.md` | 출처·실행 모드·무엇이 시뮬이고 무엇이 실제인가 |
| `01-glossary.md` | 시뮬/FACOS 용어. OCS 용어와 겹치면 이쪽 정의를 우선하지 말 것 |
| `02-implementation.md` | 스택, 부트, 모듈, 서버 API |
| `03-factory-line-modes.md` | 정밀조립Zone 셀·혼류·3단계·물류 |
| `04-agents-control.md` | 에이전트 구조, 오케스트레이터, 지시 게이트, 명령 |
| `05-data-aas-mqtt.md` | AAS 스키마, OPC UA PubSub, MQTT, 파일 저장 |
| `06-perception-comms.md` | CCTV, 로봇캠, 5G, 드론, 패킷 덤프 |
| `07-kpi-learning-fac.md` | KPI 손실, VLA, AIOS, FAC, 보안 |
| `08-related-systems.md` | CAMTIC AAS viewer · collector · middleware |
| `09-limits-and-join.md` | 한계·미구현·시뮬↔현장 조인 방법. 확정인 것처럼 쓰지 말 것 |
| `10-viewer.md` | **이 레포**의 렌더 뷰어 골격. 레이어·루프·서버·테스트 |

원문: https://theuniversepark.github.io/micro-assembly/
생성 저장소: https://github.com/theuniversepark/micro-assembly
제품명: Jin-micro · 앱 ID `kr.or.camtic.jinmicro`
기준: micro-assembly `main` README·`docs/`·`js/`·`server/` (2026-10 시점 공개본)
