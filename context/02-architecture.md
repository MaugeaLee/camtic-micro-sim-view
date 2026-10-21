# AAS 기반 수집–저장 아키텍처

원도: 발표자료 「2-2. 피지컬AI 제조 데이터 구축(4/6)」 68쪽. 모든 실증 존이 같은 계층을 쓴다.

## 계층

```
중앙 Server (Enterprise AAS · Manufacturing Data Lake · Golden Copy)
        ↕ MQTT Sparkplug B / REST · 방화벽 HA
Local Server  (존 서버실)     ← OCS Cell
        ↕ 10GbE 이중 광 + PTP
Edge Gateway + 영상 수집 노드 (셀 캐비닛)
        ↕ OPC UA / USB3 / EtherCAT / Wi-Fi 6E
Field (셀 장비·로봇·카메라·PLC)
        + TTA 검증 영역 (Trace API)
```

- 초록 테두리 = 현장 셀. 주황 = OCS Cell(Local Server + Edge Gateway). 청록 강조 = 정밀조립 예시.

## 역할 분리 (깨면 안 됨)

| 층 | 하는 일 | 하지 않는 일 |
|---|---|---|
| 셀 PLC EtherCAT | 로봇·서보 실시간 제어 | — |
| OCS Cell | 수집·감독·재계획·HOLD/재배정 | 모션 루프. OPC UA 지연 ≈ 100ms |
| DMWorks | 검증 DT. 경로 간섭·사이클·PLC 핸드셰이크 | AI 학습(물리엔진 없음), PLC 직접 제어, CAM |
| Isaac Sim/Lab | 학습 DT. VLA·합성데이터·S2R | 실설비 PLC 시운전 |
| 국가 GPU 인프라 | 모델 학습 | 존 실시간 추론(로컬 GPU-1) |

USD Converter가 검증 셀 모델을 학습 DT로 넘긴다. Live Edit는 업체가 DT 운영용 비추천(지연).

## 수집 경로

1. **상태·공정값**: 필드 → OPC UA Aggregation → Edge TSDB → Operational TSDB(Machbase)
2. **영상·진동·오디오**: OPC UA 우회 → 영상 수집 노드 store-and-forward → S3 Data Lake
3. **AI Ready**: Airflow가 원시 → 시간동기 정렬 → 결측검사 → AAS 매핑 → LeRobot/RLDS → 중앙 Lake
4. **엣지 에피소드**: 로봇 단위 카메라+관절 100Hz+F/T 1kHz를 PTP로 묶어 기록 후 영상 노드로 업로드

힌지큐브 원칙: 장비당 약 400 엘리먼트, 주기 20ms / 200ms / 1~3s, 타임싱크 필수.

## 정밀조립 Local Server 배치

| 장비 | 수량 | 용도 |
|---|---|---|
| LS-1~3 | 3 | K8s HA. etcd 쿼럼. AAS·TSDB·MQTT 3중 복제. 주 배치 LS-1 AAS/OCS, LS-2 TSDB/MQTT, LS-3 파이프라인/카탈로그/모니터 |
| GPU-1 | 1 | Triton 실시간 추론. 이상 판단 10초 KPI |
| GPU-2 | 1 | 배치: AI Ready GPU, 비식별, 라벨링, 합성, 재학습 |
| OWS ×2 | 2 | 존 관제 / 셀 알람(HOLD 승인) |
| DWS ×2 | 2 | DMWorks 검증 DT / Isaac 학습 DT. 라이선스·GPU 분리 |

시뮬레이션 Cell 3존은 같은 계층을 **축소 가정**한다. 데이터 처리 서버 ×5, 연산 서버 1(GPU 4장), 랙 R1 네트워크 / R2 데이터 / R3 연산.
