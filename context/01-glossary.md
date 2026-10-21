# 용어·표기

## 금액

- 단위는 **천원, VAT 별도**가 기본이다. `1,991,000천원` = 19.91억.
- 견적서 표지는 `VAT 포함`, 참고사항은 `부가세 별도`로 엇갈린다. 총액을 확정처럼 쓰지 말 것.
- 일반관리비·이윤 = (OCS SW + OCS HW + 기술지원) × 10%. 로컬 HW·로컬 OCS·보안에는 붙지 않는다.
- 견적 합계는 업체 **백만 원 미만 버림**.

## 약어

| 용어 | 의미 |
|---|---|
| OCS | Orchestration / Operation Control System. 존 오케스트레이터. 수집·감독·재계획. 실시간 모션 제어 아님 |
| OCS Cell | Local Server + Edge Gateway를 묶은 존 단위 데이터·관제 계층. 그림에서 주황 테두리 |
| AAS | Asset Administration Shell (IEC 63278). 자산 표준 정보모델 |
| EGW | Edge Gateway. 셀 OPC UA 수집·정규화·AAS 매핑 |
| TSDB | 시계열 DB. 엣지(InfluxDB 3 Core, 7일 버퍼) / 운영(Machbase Cluster, 12개월) |
| DCC | 로컬존 관제(운영 워크스테이션·비디오월) |
| DT | 디지털트윈. 검증 DT = DMWorks, 학습 DT = Isaac Sim/Lab |
| DMWorks | 이지로보틱스 공정 시뮬레이션. PLC 가상 시운전·OLP·라인/물류 |
| VLA | Vision-Language-Action. 엣지에서 다음 동작 생성 |
| FMS | 유연제조(Flexible Manufacturing) 존 |
| QMS | AI 정밀검사 존 |
| AMR / AMMR | 이동로봇 / 양팔 이동로봇 |
| PTP | IEEE 1588 / 802.1AS 시간동기. 로봇 100Hz·F/T 1kHz·영상 정합에 필수 |
| TSN | Time-Sensitive Networking (802.1AS, Qbv) |
| AMC | 유지보수. 계상은 연 18% × 4년. 견적서 문구는 5년 |
| PA Agent | 공장 Physical AI Agent. 오더를 존 OCS에 내림 |
| TTA | 검증 영역. Expected↔Actual Trace 비교 |
| Network-Lock | 네트워크 라이선스. 모듈별 1카피(포맷·제어기·PLC는 수량만큼) |

## 공개 문서 vs 내부 대조

- **제출·발표**: 일반 명칭만 (`3D 공정 시뮬레이션 SW 기본 모듈`, `제어기 n종`). 업체·모델명 금지.
- **내부 대조열**: DMWorks Base, RTC700, ESC8000A-E13P 등 원 품목명 허용.
- 견적서 건명(`…디지털 트윈 시뮬레이션 시스템 구축`)과 장비명(`…통합 OCS 시뮬레이션 Cell`)이 다르다. 사업계획서 장비명을 따른다.
