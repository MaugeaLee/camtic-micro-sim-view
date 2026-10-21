# 데이터 · AAS · MQTT

구현: `js/datahub.js`(자산·필드), `js/aas.js`(모델), `js/aasx.js`(패키지), `server/mqtt-gateway.mjs`(브로커). 스키마 근거: 원문 `docs/AAS_SCHEMA.md`.

## 기준 시계

시뮬 0초 = 시작일 08:00 현지. 모든 운영 데이터·이벤트·OPC UA·파일 시각은 이 시계의 ISO 8601 UTC. 수집 주기 기본 **시뮬 10초**. 최근 6000회차 보관.

고정 자산: 공장 LAN 가정. 이동 로봇: Private 5G → UPF → MQTT 가정.

## AAS 식별

| 대상 | IRI |
|---|---|
| 셸 | `https://camtic.or.kr/aas/jin3d/<자산 id>` |
| 서브모델 | `…/jin3d/<자산 id>/sm/<이름>` |
| globalAssetId | `…/jin3d/asset/<자산 id>` |
| 자체 semanticId | `https://camtic.or.kr/cd/jin3d/<idShort>` |
| 메타모델 | v3.1 `https://admin-shell.io/aas/3/1` (기본) · v3.0 `…/3/0` |

제조사 표기: “Jin-3D 가상 자산” / “피지컬AI 실증 메타팩토리 가상 자산”.

요소는 Property · SubmodelElementCollection · File만. valueType은 `xs:double|int|boolean|string|dateTime`만. idShort는 PascalCase.

## 서브모델

| 이름 | 출처 | 내용 |
|---|---|---|
| Nameplate | IDTA 02006 간소 | 제조사·제품명·일련번호·연도. 주소·다국어 등 필수 일부 생략 |
| TechnicalData | IDTA 02003 간소 | 종류·축 수·가반하중·기준 사이클 |
| OperationalData | 자체 `…/sm/jin3d/OperationalData/1/0` | 지금 값 |
| TimeSeries | IDTA 02008 | InternalSegment 최근 60 + CSV ExternalSegment |
| TelemetryTimeSeries | 02008 재사용 | 선택 후 1초 관절·TCP·센서. 로봇당 최대 2만 |
| VideoRecordings | 자체 | 카메라별 MP4/WebM 링크·칸 좌표·.url |
| Events | 자체 | 인시던트·명령 |

자산별 OperationalData 예: 공장 UPH/OEE/WIP/전력, 셀 상태·건강도·Cpk·게이트, 셀 로봇 관절·TCP, 이동 로봇 위치·배터리, 기지국 PCI.

## 파일 저장

JSON `.aas.json` · XML `.aas.xml` · RDF `.aas.ttl` · CSV · AutomationML `.aml` · AASX.

AASX: Part 5 + 보조파일(정밀 CSV, `videos/*.url`, `video_links.json`) aas-suppl. 맥 앱 영상 링크 `http://127.0.0.1:47615/videos/…`.

검증: aas-core3.0(v3.0), BaSyx Python SDK 엄격+Compliance(v3.1). `tests/aasbasyx.mjs`. 과거 버그: v3.0 NS로 BaSyx 빈 트리, `bool` → `xs:boolean`.

**한계:** ECLASS/IEC CDD 없음. Robotics 40010 미적용. Nameplate 불완전. 다른 시스템이 semanticId를 자동 매핑하기 어렵다.

## OPC UA PubSub JSON over MQTT

세션 OPC UA 서버가 아니다. 브라우저가 NetworkMessage를 만들고 `POST /api/mqtt/publish`.

브로커: aedes, 기본 `MQTT_HOST=127.0.0.1` `MQTT_PORT=1883`. 외부 수신은 `MQTT_HOST=0.0.0.0`. 사내 브로커는 `MQTT_BRIDGE_URL`. QoS 0 발행(pcap 합성은 QoS 1처럼 그림).

retain 이슈: aedes 1.2는 retain을 기존 구독자에 안 보냄 → 저장소에 retain 넣고 동일 내용을 non-retain으로도 publish.

| 토픽 | 내용 |
|---|---|
| `opcua/json/data/jin3d/MetaFactory/<자산 id>` | ua-data / ua-keyframe. Value + SourceTimestamp |
| `opcua/json/metadata/jin3d/MetaFactory/<자산 id>` | retain. DataSetMetaData + AAS id |
| `opcua/json/data/jin3d/MetaFactory/Events` | ua-event |
| `opcua/json/data/jin3d/MetaFactory/Commands` | CommandId·Code·Target·State… |
| `aas/jin3d/environment` | retain. AAS 구조 |

구독 예: `opcua/json/#`. Pages에서는 수집·파일만.

## 패킷 덤프 (`pcap.js`)

실 NIC가 아니다. MQTT를 Eth/IPv4/TCP로 **합성**해 `.pcap` 저장. 가상 NIC `10.20.0.10:1883`.

주소: 브로커 10.20.0.10 · FACOS 10.20.0.20 · 설비 10.20.1.x · CCTV 10.20.2.x · 5G UE 10.45.x.x. 200MB에서 정지.

## 현장 AAS viewer와

시뮬 AASX를 `POST /api/packages`로 올리면 트리는 열린다. viewer는 값을 갱신하지 않고 MQTT를 구독하지 않는다. NodeSet 파일은 gateway가 읽지 않는다. 조인 방법은 `09`.
