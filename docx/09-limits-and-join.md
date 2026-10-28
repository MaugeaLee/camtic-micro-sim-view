# 한계 · 미구현 · 조인

확정 계획처럼 쓰지 말 것. 아래는 코드와 README가 스스로 밝힌 경계다.

## 시뮬이 아닌 것

- 실제 신경망(VLA/AIOS/YOLO). 출력 형식만 맞춤.
- 실제 5G RAN. RSRP·DAPS·지연은 수식.
- Open-RMF. AMR/AGV는 자체 웨이포인트.
- EtherCAT 모션 루프. 명령 지연은 단계별 상수.
- 암호(DID/OTAC/동형암호/ZKML). 통과·차단 기록.
- 실 NIC pcap. MQTT를 패킷으로 합성.
- Pages의 Claude·MQTT·FAC 외부 API.

## AAS/OPC 한계 (원문 `docs/AAS_SCHEMA.md` §4)

1. Nameplate·TechnicalData 간소. 가상 제조사명.
2. 운영 필드 semanticId가 CAMTIC 자체 IRI. ECLASS/IEC CDD/61360 없음.
3. OPC UA Robotics 40010 · Machinery 40001 미적용.
4. TimeSeries는 최근 60 + CSV. 영상은 링크.

제안(미착수): 02006 전체, ECLASS 부착, 로봇 서브모델 40010 정렬.

## 현장 스택 한계

- MQTT / Sparkplug / PubSub 디코더 없음.
- AAS NodeSet과 gateway 카탈로그가 다른 세계. import 없음.
- gateway 모드 미완 → 필드 OPC UA가 북바운드로 안 흐름.
- 로봇 쓰기 명령 전부 reject. PLC READ_ONCE/STOP 미구현.
- TSDB(Machbase)·Airflow·AI Ready 파이프라인 코드 없음 (`../context/02-architecture.md` 슬라이드만).
- Kepware 미사용 (`../context/07-open-issues.md`).

## ID를 섞지 말 것

| | 시뮬 Zone | OCS 산정 A-3 |
|---|---|---|
| 셀 | SORT, DT_ASSY, DT_FAST, EA_ASSY, EA_FAST, PACK | A-3-5, A-3-2, A-3-3, A-3-1, A-3-4 |
| 규모 | 한 Zone 6셀 혼류 | 완성 시 5셀 동일, 셀당 로봇 15 |
| 위치 | 가상 89×40m | 창조2관 2층(임시) |
| 데이터 버스 | PubSub JSON/MQTT (로컬) | 설계: OPC UA + Sparkplug (미구현) |

수요 시나리오 “LH 도어트림 재배정”은 산정 쪽 문구. 시뮬 고객 표기는 서연인테크·쉐플러코리아.

## 조인 (브리지는 가정 형식으로 있음 · 장 C 연결 미확인)

```
micro-assembly
  ├─ AASX ──POST /api/packages──► aas-backend-viewer (정적 트리·NodeSet 파일)
  └─ MQTT PubSub JSON
         │
         ▼  bridge.mjs · server/join.mjs (V3-3, DTO 가정)
    collector.sim.{device}.data   ZeroMQ PUB tcp://127.0.0.1:5558 (가정 포트)
         │
         ▼
    middleware_edge_forwarder
         │
         ▼
    opc.tcp://:4840/edge/
```

브리지가 할 일: `opcua/json/#` 구독 → PubSub JSON 디코드 → `MsgDataDTO`로 PUB. `engineering.csv`로 `tag_map.json`을 만들면 AAS path와 browse path를 맞출 수 있다. JSON Environment만으로는 viewer 업로드가 안 된다(AASX 필요).

**이 레포의 브리지(V3-3).** `npm run bridge`.
- 장 B 브로커의 `opcua/json/#` 를 구독하고 `decode`(`js/data/pubsub.js`)로 푼다. `data` 항목만 ZeroMQ PUB 으로 넘긴다.
- ZeroMQ 는 `server/zmtp.mjs` 의 ZMTP 3.0 · NULL 메커니즘 최소 구현이다(의존성 없음, 암호·인증 없음). libzmq 4.3.5 SUB 와 붙는 것은 확인했다.
- **본문은 가정 DTO `camtic-sim-bridge/0`** 다. 장 C `MsgDataDTO` 를 이 레포에서 본 적이 없어서 이름만 맞춘 것이 아니라 아예 새로 정했다:
  - 머리: `schema` `kind:"sim"` `device_key`(DataSetWriter 소문자) `timestamp_ms`(메시지 Timestamp) `received_ms` `seq` `source{chapter:"B",publisher,group,writer,mqtt_topic}`
  - `tags[]`: `name` `value` `quality(good|bad)` `ts_ms` `unit` `label` `aas_path`(메타 `AAS.IdShortPath`) `browse_path`(`tag_map.json`, 없으면 null)
  - 2프레임 멀티파트: [토픽, JSON]. 5 s 마다 `collector.sim.bridge.health`.
- 붙일 때 고칠 곳은 `toDto` 한 곳이다. 확인할 것:
  - 장 C DTO 필드 이름·직렬화(JSON인지, 프레임 수);
  - edge_forwarder 가 kind `sim` 을 받는지(기본 `plc` 만);
  - `ZMQ_SUB_ENDPOINTS` 에 브리지 주소 추가;
  - 포트 5558 이 비는지.
- 넘기지 않는 것: 이벤트·명령·AAS 환경. MQTT 로 발행하지 않고, ZeroMQ 명령(`middleware.gateway.cmd_*`)을 받지 않는다.

하지 말 것: collector가 MQTT를 직접 먹는다 가정, viewer 트리가 관절을 실시간으로 움직인다 가정, gateway가 PubSub를 구독한다 가정.

## 이 레포에서 viewer를 만들 때

우선순위 후보(결정은 별도):

1. **얇은 구독 대시보드** — MQTT/FAC GET만. 3D 없음.
2. **AAS 트리 프론트** — backend viewer의 웹을 이 레포에. 라이브 아님.
3. **micro-assembly 이식** — 원 레포가 곧 viewer. 라이선스·자산·Electron 의존 큼.

원 레포는 ISC, 작성자 Jin Park. Blender 휴머노이드/사족/팔은 상용 제품 분위기 참고의 독자 모델(로고 없음).
