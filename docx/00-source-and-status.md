# 출처와 문서 성격

이 폴더는 **동작하는 시뮬레이터와 로컬 수집 스택**을 정리한다. 계약·발주·현장 구축 확정본이 아니다. 시뮬 수치는 가정값·시드 평균이다.

## 문서 맵

| 공개물 | 성격 | 서버 기능 |
|---|---|---|
| https://theuniversepark.github.io/micro-assembly/ | GitHub Pages. `main` 루트 정적 서빙(`.nojekyll`) | 없음. Claude·MQTT 꺼짐 (`JIN3D_NO_SERVER`) |
| `npm start` → `http://localhost:8765` | 브라우저 + Node 서버 | Claude, MQTT, FAC API, 영상/에피소드 저장 |
| `npm run app` / `npm run package` | Electron 맥 앱 (Apple Silicon) | 위와 같음. 키는 키체인. 데이터 `~/Library/Application Support/Jin-micro/` |

원문 README는 운영 로그·검증 항목까지 포함한 설계 일기이다. 여기에는 **구조·ID·프로토콜·한계**만 남긴다.

## 세 레이어를 섞지 말 것

1. **micro-assembly 시뮬** — 브라우저에서 틱을 돌리고 AAS/MQTT를 **쓴다**. 3D 공장·에이전트·KPI가 여기 있다.
2. **CAMTIC 현장 스택** — PLC/로봇 → ZeroMQ → OPC UA(세션) 또는 파일/REST. MQTT·PubSub·Sparkplug **없음**.
3. **OCS 산정 문서** (`../context/`) — 존 서버·견적·셀 ID(A-3-n). 시뮬 셀 ID와 다르다.

## 실행 모드

| 조건 | 3D·KPI·파일 저장 | Claude 대화 | MQTT 발행 | FAC 외부 GET |
|---|---|---|---|---|
| `*.github.io` | 됨 | 안 됨 | 안 됨 | 안 됨 |
| `node server.mjs` | 됨 | API 키 있으면 | `127.0.0.1:1883` | `127.0.0.1`만 |
| Electron 앱 | 됨 | 키체인 키 | 내장 브로커 | 로컬만 |

ES 모듈이라 `index.html`을 `file://`로 열면 동작하지 않는다.

## 검증 성격

`npm test`는 헤드리스로 시뮬을 돌려 경로·충돌·KPI 항등식·AAS 파싱을 본다. **실제 신경망·실제 5G·실제 EtherCAT이 아니다.** YOLO/ByteTrack 출력, 5G RSRP, VLA 학습은 장면 상태를 모델 출력 형식에 맞춰 만든 값이다.

## 버전·식별

- 패키지: `micro-assembly` 1.0.0, `productName` Jin-micro
- AAS 네임스페이스: `https://camtic.or.kr/aas/jin3d/<자산>`
- MQTT 토픽 prefix: `opcua/json/data/jin3d/MetaFactory/`
- Three.js r186 (vendor). 의존: `@anthropic-ai/sdk`, `aedes`, `mqtt`. 개발: `electron`, `three`
