// OpenAPI 3 스펙. 경로는 cfg.api (`server/env.mjs` 상수).

function schemaRef(name) {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonRes(schema, description) {
  return { description, content: { 'application/json': { schema } } };
}

export function buildOpenApi(cfg) {
  const api = cfg.api;
  const assetBase = String(cfg.assetUrl || '/assets/').replace(/\/$/, '') || '/assets';
  return {
    openapi: '3.0.3',
    info: {
      title: cfg.name || 'micro-cell-viewer',
      description: '로컬 뷰어 API. 시뮬은 돌리지 않는다. 쓰기는 레이아웃 PUT·공장 상태 PUT/DELETE(루프백)만. 디스크 경로(`ASSET_DIR` `LAYOUT_FILE` `PLANT_FILE`)는 응답에 없다.',
      version: cfg.version,
    },
    servers: [{ url: '/', description: '이 프로세스' }],
    tags: [
      { name: 'api', description: '상태·목록·설정' },
      { name: 'assets', description: '렌더 에셋 조회' },
      { name: 'docs', description: '이 스펙과 Swagger UI' },
      { name: 'layout', description: '셀 자리 JSON. GET은 공개, PUT은 127.0.0.1만' },
      { name: 'plant', description: '공장 이어가기(시뮬 시각·시나리오). GET은 공개, PUT·DELETE는 127.0.0.1만' },
      { name: 'chapterB', description: '장 B 구독: micro-assembly MQTT·FAC를 읽기만 한다. 발행 없음' },
    ],
    paths: {
      [api.status]: {
        get: {
          tags: ['api'],
          summary: '이름·시각·GLB 키 · 공개 env',
          operationId: 'getStatus',
          responses: {
            200: jsonRes(schemaRef('Status'), '현재 공개 상태'),
          },
        },
      },
      [api.assets]: {
        get: {
          tags: ['api'],
          summary: '디스크의 GLB 파일·크기',
          operationId: 'listAssets',
          responses: {
            200: jsonRes({ type: 'array', items: schemaRef('AssetFile') }, 'GLB 목록'),
          },
        },
      },
      [api.config]: {
        get: {
          tags: ['api'],
          summary: '이름·버전·호스트·포트·URL (디스크 경로 없음)',
          operationId: 'getConfig',
          responses: {
            200: jsonRes(schemaRef('PublicConfig'), '브라우저에 주입하는 것과 같은 공개 설정'),
          },
        },
      },
      [api.assetViewer]: {
        get: {
          tags: ['assets'],
          summary: 'Three.js가 읽는 GLB/GLTF 조회. 브라우저면 테스트 뷰포트',
          operationId: 'getAssetViewer',
          parameters: [
            { name: 'key', in: 'query', schema: { type: 'string' }, description: '셀 키. 없으면 전체' },
            {
              name: 'format', in: 'query', schema: { type: 'string', enum: ['json'] },
              description: 'json 이면 항상 JSON',
            },
            {
              name: 'view', in: 'query', schema: { type: 'string', enum: ['0', '1'] },
              description: '1 이면 HTML 뷰포트, 0 이면 JSON',
            },
          ],
          responses: {
            200: {
              description: '목록·단건 JSON, 또는 테스트 뷰포트 HTML',
              content: {
                'application/json': { schema: schemaRef('AssetCatalog') },
                'text/html': { schema: { type: 'string' } },
              },
            },
            404: jsonRes(schemaRef('Error'), 'key 가 디스크에 없음'),
          },
        },
      },
      [api.docs]: {
        get: {
          tags: ['docs'],
          summary: 'Swagger UI',
          operationId: 'getDocs',
          responses: {
            200: { description: 'Swagger UI HTML', content: { 'text/html': { schema: { type: 'string' } } } },
          },
        },
      },
      [api.layout]: {
        get: {
          tags: ['layout'],
          summary: '현재 셀 자리. download=1 이면 파일로 받음',
          operationId: 'getLayout',
          parameters: [
            { name: 'download', in: 'query', schema: { type: 'string', enum: ['1'] }, description: '1 이면 첨부 파일' },
          ],
          responses: {
            200: {
              description: '레이아웃 JSON',
              content: { 'application/json': { schema: schemaRef('Layout') } },
              headers: { 'Content-Disposition': { schema: { type: 'string' } } },
            },
          },
        },
        put: {
          tags: ['layout'],
          summary: 'JSON을 받아 디스크에 기록. 루프백만',
          operationId: 'putLayout',
          requestBody: { required: true, content: { 'application/json': { schema: schemaRef('Layout') } } },
          responses: {
            200: jsonRes(schemaRef('Layout'), '저장된 레이아웃'),
            400: jsonRes(schemaRef('Error'), '검증 실패'),
            403: jsonRes(schemaRef('Error'), '루프백 아님'),
          },
        },
      },
      [api.plant]: {
        get: {
          tags: ['plant'],
          summary: '저장된 공장 시각·시나리오. 없으면 404',
          operationId: 'getPlant',
          responses: {
            200: jsonRes(schemaRef('Plant'), '이어갈 공장 상태'),
            404: jsonRes(schemaRef('Error'), '저장된 상태 없음'),
          },
        },
        put: {
          tags: ['plant'],
          summary: '공장 시각·시나리오를 디스크에 기록. 루프백만',
          operationId: 'putPlant',
          requestBody: { required: true, content: { 'application/json': { schema: schemaRef('Plant') } } },
          responses: {
            200: jsonRes(schemaRef('Plant'), '저장된 상태'),
            400: jsonRes(schemaRef('Error'), '검증 실패'),
            403: jsonRes(schemaRef('Error'), '루프백 아님'),
          },
        },
        delete: {
          tags: ['plant'],
          summary: '저장된 공장 상태를 지움(Admin 초기화). 루프백만',
          operationId: 'deletePlant',
          responses: {
            200: jsonRes({ type: 'object', properties: { ok: { type: 'boolean' } } }, '지움'),
            403: jsonRes(schemaRef('Error'), '루프백 아님'),
          },
        },
      },
      [api.process]: {
        get: {
          tags: ['layout'],
          summary: '셀 공정 정의(가정값): 스테이션 흐름·작업 지점·부품 치수·사이클. 읽기 전용',
          operationId: 'getProcess',
          responses: {
            200: jsonRes({ type: 'object', required: ['version', 'assumed', 'cells'], properties: { version: { type: 'integer' }, assumed: { type: 'boolean' }, cells: { type: 'object' } } }, '공정 정의 JSON'),
            500: jsonRes(schemaRef('Error'), '정의 파일 오류'),
          },
        },
      },
      [api.openapi]: {
        get: {
          tags: ['docs'],
          summary: 'OpenAPI 3 JSON',
          operationId: 'getOpenApi',
          responses: {
            200: jsonRes({ type: 'object', additionalProperties: true }, '이 문서'),
          },
        },
      },
      [api.bStatus]: {
        get: {
          tags: ['chapterB'],
          summary: '장 B 구독 상태: 브로커 연결·받은 건수. 첫 호출 때 구독을 시작한다',
          operationId: 'getChapterBStatus',
          responses: {
            200: jsonRes({ type: 'object', properties: { mqtt: { type: 'object' }, fac: { type: 'string' }, demo: { type: 'boolean' }, clients: { type: 'integer' }, counts: { type: 'object' }, assets: { type: 'integer' }, topics: { type: 'integer' }, lagSkips: { type: 'integer' }, resyncs: { type: 'integer' } } }, '구독 상태'),
          },
        },
      },
      [api.bInspect]: {
        get: {
          tags: ['chapterB'],
          summary: '수신 점검: 토픽별 건수·속도·크기·seq 누락·해석 오류 + 최근 원문 50건(원문 4 KB에서 자름)과 푼 항목',
          operationId: 'getChapterBInspect',
          responses: {
            200: jsonRes({ type: 'object', properties: { n: { type: 'integer' }, overflow: { type: 'integer' }, topics: { type: 'array', items: { type: 'object' } }, ring: { type: 'array', items: { type: 'object' } }, counts: { type: 'object' }, demo: { type: 'boolean' } } }, '수신 점검'),
          },
        },
      },
      [api.bStream]: {
        get: {
          tags: ['chapterB'],
          summary: 'SSE. snapshot 1회 뒤 batch(0.5초 묶음, 같은 자산 값은 한 건으로 합침)·mqtt(연결 상태). 느린 클라이언트는 건너뛰었다가 snapshot 으로 다시 맞춤',
          operationId: 'streamChapterB',
          responses: { 200: { description: 'text/event-stream', content: { 'text/event-stream': { schema: { type: 'string' } } } } },
        },
      },
      [`${api.bFac}/{view}`]: {
        get: {
          tags: ['chapterB'],
          summary: 'FAC API 조회 대리(GET만). 업스트림은 서버 설정 B_FAC_URL',
          operationId: 'getChapterBFac',
          parameters: [
            { name: 'view', in: 'path', required: true, schema: { type: 'string', enum: ['status', 'events', 'po', 'moves', 'stock', 'mr', 'equipment', 'orderpoints', 'master'] } },
            { name: 'since', in: 'query', schema: { type: 'integer' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'type', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: jsonRes({ type: 'object', additionalProperties: true }, 'FAC 응답 그대로'),
            404: jsonRes(schemaRef('Error'), '없는 조회'),
            502: jsonRes(schemaRef('Error'), '업스트림 응답 없음'),
            503: jsonRes(schemaRef('Error'), '업스트림에 스냅샷 없음'),
          },
        },
      },
      [`${assetBase}/{file}`]: {
        get: {
          tags: ['assets'],
          summary: 'GLB/GLTF 파일',
          operationId: 'getAssetFile',
          parameters: [
            { name: 'file', in: 'path', required: true, schema: { type: 'string' }, example: 'PRESS.glb' },
          ],
          responses: {
            200: { description: '에셋 바이트', content: { 'model/gltf-binary': { schema: { type: 'string', format: 'binary' } } } },
            404: { description: '없음' },
          },
        },
      },
    },
    components: {
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
        PublicConfig: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            version: { type: 'string' },
            host: { type: 'string' },
            port: { type: 'integer' },
            assetUrl: { type: 'string' },
            api: {
              type: 'object',
              additionalProperties: { type: 'string' },
              properties: {
                status: { type: 'string' },
                assets: { type: 'string' },
                config: { type: 'string' },
                assetViewer: { type: 'string' },
                docs: { type: 'string' },
                openapi: { type: 'string' },
                layout: { type: 'string' },
                plant: { type: 'string' },
                process: { type: 'string' },
              },
            },
          },
        },
        Status: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            time: { type: 'string', format: 'date-time' },
            assets: { type: 'array', items: { type: 'string' } },
            env: schemaRef('PublicConfig'),
          },
        },
        AssetFile: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            file: { type: 'string' },
            bytes: { type: 'integer' },
          },
        },
        AssetItem: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            file: { type: 'string' },
            bytes: { type: 'integer' },
            format: { type: 'string', enum: ['glb', 'gltf'] },
            mime: { type: 'string' },
            url: { type: 'string' },
            three: { type: 'boolean' },
          },
        },
        LayoutPose: {
          type: 'object',
          required: ['x', 'z', 'rotY'],
          properties: {
            x: { type: 'number' },
            z: { type: 'number' },
            rotY: { type: 'number', enum: [0, 90, 180, 270] },
          },
        },
        Plant: {
          type: 'object',
          required: ['v', 't', 'scenario', 'running', 'speed', 'process'],
          properties: {
            v: { type: 'integer', enum: [1] },
            t: { type: 'number', minimum: 0 },
            scenario: { type: 'string', nullable: true },
            running: { type: 'boolean' },
            speed: { type: 'number', enum: [1, 3, 10, 30] },
            amr: { type: 'integer', nullable: true },
            drones: { type: 'integer', nullable: true },
            inspect: { type: 'boolean', nullable: true },
            process: { type: 'boolean' },
            layoutFp: { type: 'string', nullable: true },
            processFp: { type: 'string', nullable: true },
          },
        },
        Layout: {
          type: 'object',
          required: ['version', 'snap', 'cells'],
          properties: {
            version: { type: 'integer', enum: [1] },
            snap: { type: 'number' },
            rev: { type: 'number' },
            cells: {
              type: 'object',
              additionalProperties: schemaRef('LayoutPose'),
              properties: {
                PRESS: schemaRef('LayoutPose'),
                SCREW: schemaRef('LayoutPose'),
                SORT: schemaRef('LayoutPose'),
              },
            },
          },
        },
        AssetCatalog: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            key: { type: 'string' },
            items: { type: 'array', items: schemaRef('AssetItem') },
            error: { type: 'string' },
          },
        },
      },
    },
  };
}
