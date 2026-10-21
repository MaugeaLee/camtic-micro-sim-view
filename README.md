# camtic-micro-sim-view

총괄5-세부1 로컬 OCS·시뮬레이션 Cell 작업 공간 + 셀 GLB 렌더 뷰어.

에이전트용 도메인 콘텍스트는 [`context/`](context/README.md). 뷰어 아키텍처는 [`docx/10-viewer.md`](docx/10-viewer.md). 원문: [로컬 OCS 구성](https://theuniversepark.github.io/micro-cell/).

---

## 프론트 서버 실행

프레임워크·번들러 없음. `npm install` 하지 않는다. Node가 정적 파일과 읽기 전용 API만 연다. 브라우저가 뷰어다.

### 1. 준비

- [Node.js](https://nodejs.org/) **20 이상** (이 레포 확인: 24.x)
- 저장소를 받은 뒤 터미널에서 루트로 이동

```powershell
cd d:\Workspace\codebase\camtic-micro-sim-view
node --version
```

`node`를 못 찾으면 Windows에서 설치 경로를 PATH에 넣는다.

```powershell
$env:Path = "C:\Program Files\nodejs;$env:Path"
node --version
```

### 2. 환경 파일

포트·바인드·에셋 경로는 `.env`가 기준이다. API 라우트는 `server/env.mjs` 상수다. git에는 `.env.example`만 올린다.

```powershell
copy .env.example .env
```

| 키 | 예 | 의미 |
|---|---|---|
| `HOST` | `127.0.0.1` | 리슨 주소. LAN이면 `0.0.0.0` |
| `PORT` | `8790` | 리슨 포트 |
| `APP_NAME` | `micro-cell-viewer` | `/api/status` 이름 |
| `ASSET_DIR` | `src/render_asset` | GLB 디스크 경로 |
| `ASSET_URL` | `/assets` | 브라우저가 GLB를 받는 URL |
| `LAYOUT_FILE` | `data/layout.json` | 쓰는 자리. 없으면 `src/layout.default.json`만 읽는다. PUT은 여기만 씀 |

이미 있는 환경변수가 `.env`보다 우선한다. 브라우저는 `.env`를 읽지 않고, 서버가 `index.html`에 `window.__ENV`로 공개 값만 넣는다. API 경로는 `/api/status` `/api/assets` `/api/config` `/api/asset-viewer` `/api/layout` `/api/docs` `/api/openapi.json`. PUT은 `/api/layout`만(127.0.0.1).

### 3. 서버 시작

```powershell
npm start
```

또는 `node server.mjs`. 콘솔의 `Micro-Cell Viewer → http://<HOST>:<PORT>`가 접속 주소다.

### 4. 브라우저

`.env`가 예제 그대로면:

| URL | 내용 |
|---|---|
| http://127.0.0.1:8790/ | 빈 뷰포트 + 셀 목록 (GLB 안 받음) |
| http://127.0.0.1:8790/?assets=1 | `PRESS` `SCREW` `SORT` GLB 로드 |
| http://127.0.0.1:8790/?build=1 | Admin 모드로 시작 (타이틀 옆 버튼과 같음) |
| http://127.0.0.1:8790/api/layout | 셀 자리 JSON |
| http://127.0.0.1:8790/api/layout?download=1 | 같은 JSON을 파일로 |
| http://127.0.0.1:8790/api/docs | Swagger UI (엔드포인트 조회·GET 실행) |
| http://127.0.0.1:8790/api/openapi.json | OpenAPI 3 스펙 |
| http://127.0.0.1:8790/api/asset-viewer | 테스트 뷰포트 (브라우저) |
| http://127.0.0.1:8790/api/asset-viewer?key=PRESS | 해당 셀만 미리보기 |
| http://127.0.0.1:8790/api/asset-viewer?format=json | Three.js가 읽는 GLB/GLTF 목록 |

재생·배속은 상단. 셀 목록에서 선택. 개발자 도구 콘솔에서 수동 로드:

```js
__viewer.loadAssets()
```

자리는 `.env`의 `LAYOUT_FILE`(기본 `data/layout.json`)이다. 파일이 없으면 `src/layout.default.json`을 읽기만 한다. Admin에서 옮긴 뒤 올리면 `LAYOUT_FILE`에만 쓴다.

### 5. 확인

```powershell
npm test
```

서버가 켜진 뒤 상태 URL은 `/api/status`다.

```powershell
curl http://127.0.0.1:8790/api/status
curl http://127.0.0.1:8790/api/config
curl http://127.0.0.1:8790/api/openapi.json
```

### 6. 멈추기

서버를 띄운 터미널에서 `Ctrl+C`.

---

## 디렉터리 (실행에 쓰는 것)

```
index.html          셸 · import map
css/                스타일
js/                 브라우저 모듈 (진입 js/main.js)
vendor/three/       Three r186 (레포에 포함)
.env.example        배포용 키 목록 (복사해서 .env)
server.mjs          npm start
server/             정적 화이트리스트 + API
src/render_asset/   PRESS.glb SCREW.glb SORT.glb
src/layout.default.json  기본 자리(읽기 전용 fallback)
data/layout.json         쓰는 자리 (LAYOUT_FILE, git 제외)
tests/              Node 헤드리스
```

`context/` `docx/` `src/origin_asset/`는 서버가 열지 않는다.

---

## 자주 막히는 곳

| 증상 | 확인 |
|---|---|
| `'node' 명령을 찾을 수 없습니다` | Node 설치, PATH (`C:\Program Files\nodejs`) |
| 포트 사용 중 | 다른 `node server.mjs` 종료, 또는 `.env`의 `PORT` 변경 |
| 화면은 뜨는데 모델이 없음 | 기본은 에셋을 안 받는다. `?assets=1` 또는 `__viewer.loadAssets()` |
| `npm install` 실패 | 의존성 없다. 설치할 패키지 없음 |
| `file://`로 index.html을 연 경우 | 모듈·API가 막힌다. 반드시 `npm start` 후 http로 연다 |
