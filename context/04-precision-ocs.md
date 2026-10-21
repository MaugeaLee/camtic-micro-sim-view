# 정밀조립존 OCS Cell (자체 산정)

설치: 창조2관 2층. 서버실 약 28.8㎡, 랙 4대(연산 A · 네트워크 B · 스토리지 C~), 부하 약 17.2kW. 셀–서버실 10GbE 이중 광 + PTP.

1차년도 현장 장비 견적(스크류·압입·분류, 협동 11)은 `08-precision-y1-equip.md`. **이 장은 완성 5셀 OCS 산정만.**

## 규모 가정 (5셀 완성)

| 항목 | 셀 | 존 |
|---|---|---|
| 협동로봇 / AMR / AMMR | 10 / 4 / 1 | 50 / 20 / 5 |
| 카메라 | 55 | 275 |
| AAS 태그(추정) | 9,950 | 49,750 |
| 평균 대역폭 | 1,246 Mbps | 6,232 Mbps |
| 월 발생 | 98.7 TB (영상 97.7 + 텔레메트리 1.01) | 493.6 TB (영상 98%) |
| 운용 | 월 176h 연속 기록 | |

카메라 = 로봇당 손목 D405 + 머리 D455 + 가슴 D455, 협동로봇만 엑소센트릭 D455 추가. 전부 USB3 → 로봇 엣지. PoE는 공정 비전·AP만.

대당 기록: RGB H.265 4Mbps + Depth 16bit 무손실≈4:1 18.4Mbps → **22.4 Mbps, 1.78 TB/월**. Depth 미기록이면 존 월 ~92TB로 급감. 검사 카메라는 산정 제외.

텔레메트리: 협동 39 KB/s, AMR 225 KB/s(LiDAR 포함), AMMR 301 KB/s.

## 저장

정책: 원시 3개월 + AI Ready 3개월. 필요 **2,310 TB** → Ceph 사용률 80% → usable 목표 ≈ 2,888 TB → 노드당 usable 160 TB(raw 240 TB, EC 4+2) → **19노드**.
1개월로 줄이면 ≈ 770 TB · **6노드**. 원시 원본 Golden Copy는 중앙. 로컬 백업 NAS 50 TB는 AAS·TSDB·설정·모델만.

## 총액 (천원, VAT 별도)

| 구분 | 품목 | 금액 |
|---|---|---|
| 존 HW | 22종 | 1,584,800 |
| 존 SW | 22종 | 200,848 |
| 존 소계 (OCS Cell) | | **1,785,648** |
| 셀 HW (온디바이스 엣지) | 7종 | 763,000 |
| 셀 SW | 11종 | 0 (자체 개발·무료) |
| 총계 | | **2,548,648** |

존 HW 내역 소계: Local Server 919,800(LS 84,000 + GPU 276,800 + STO 551,000 + BAK 8,000) · Edge 161,200 · 네트워크 328,700 · 운영·DT 102,400 · 기반 72,700.

존 SW 상용만 금액: Machbase 45,000 · DMWorks 120,848(10/8 단가×52%, 견적 대상 외) · HIWARE 포함 보안 35,000. 나머지 open62541·PLC4X·BaSyx·RKE2·Triton·Airflow·Feast·Iceberg·RabbitMQ·Isaac 등은 0원.

## 핵심 품목 역할 (모델은 내부용)

- LS: KTNF CoreRidge KR587S4 ×3, 25GbE
- GPU: Supermicro 4U + RTX PRO 6000 ×4 ×2대 (추론/배치 분리)
- STO: 12×20 TB HDD + Ceph ×19
- EGW: Neousys Nuvo-10208GC ×6 (셀 5 + 냉예비)
- VNODE: Supermicro short-depth + L4 ×5. 셀당 평균 1,234 Mbps 수신, HDD RAID1 ≈5일 버퍼
- CORE: Cisco Nexus 93180YC-FX3 ×2 MLAG. 소요 포트 ≈111
- TSN: Moxa TSN-G5008 ×20 (셀당 4, 가용 7포트, 대상 23포트)
- POE: Catalyst C9300-24UX ×5
- FW: 시큐아이 BLUEMAX NGF ×2
- PTP: Meinberg microSyncHR ×1
- AP: Cisco IW9167EH ×7 (셀 5 + 통로 2)
- EDGE-T: Advantech MIC-743 Thor ×55 (셀당 11)
- EDGE-O: MIC-733 Orin 64GB ×20 (셀당 4)
- 5G: AirLink XR60 ×25. 기지국·코어는 이음5G 별도. n79·KC 확인 필요

셀 SW 스택: JetPack · ROS 2 Jazzy + Isaac ROS · ros2_control 브리지 · TensorRT VLA · 안전감지 · LeRobot 에피소드 기록 · rclone 업로드 · K3s OTA.

## 네트워크 스케치

100GbE 코어 피어링. 서버 25GbE. 셀 업링크 10GbE 이중. 산업 Ethernet 1/10G OPC UA. PoE+ 2.5GbE(카메라·AP — 로봇 카메라는 USB라 실제 PoE 부하 적음). EtherCAT은 셀 안. AMR·AMMR은 Wi-Fi 6E, 5G는 모뎀→이음5G.
