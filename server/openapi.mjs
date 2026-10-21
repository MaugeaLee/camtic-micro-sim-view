// OpenAPI 3 스펙. 경로는 cfg.api — 코드에 엔드포인트를 박지 않는다.

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
      description: '로컬 뷰어 읽기 전용 API. GET만 받는다. 시뮬은 돌리지 않는다. 디스크 경로(`ASSET_DIR`)는 응답에 없다.',
      version: '0.1.0',
    },
    servers: [{ url: '/', description: '이 프로세스' }],
    tags: [
      { name: 'api', description: '상태·목록·설정' },
      { name: 'assets', description: '렌더 에셋 조회' },
      { name: 'docs', description: '이 스펙과 Swagger UI' },
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
          summary: '호스트·포트·URL (디스크 경로 없음)',
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
