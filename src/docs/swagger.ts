/**
 * OpenAPI 3.0 specification for Schema Form Platform API.
 */

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Schema Form Platform API',
    version: '1.0.0',
    description: [
      'Schema-driven form engine API. All responses use a uniform envelope format.',
      '',
      '```ts',
      'interface ApiResponse<T> {',
      '  success: boolean',
      '  data?: T',
      '  error?: { message: string; code?: string; details?: Array<{ path: string; message: string }> }',
      '}',
      '```',
      '',
      '## Authentication',
      '',
      'Two authentication methods are supported:',
      '',
      '1. **JWT Bearer Token** — Pass via `Authorization: Bearer <token>` header. Obtain from `/api/auth/login`.',
      '2. **API Key** — Pass via `X-API-Key` header.',
    ].join('\n'),
  },
  servers: [
    { url: `http://localhost:${process.env.PORT ?? 3001}`, description: 'Local development' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token obtained from /api/auth/login',
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API Key for programmatic access',
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'User login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        token: { type: 'string' },
                        user: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/schemas': {
      get: {
        tags: ['Schemas'],
        summary: 'List schemas',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'keyword', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Success' },
        },
      },
      post: {
        tags: ['Schemas'],
        summary: 'Create schema',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'json'],
                properties: {
                  name: { type: 'string' },
                  json: { type: 'object' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Success' },
        },
      },
    },
    '/api/flow/definitions': {
      get: {
        tags: ['Flow'],
        summary: 'List flow definitions',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Success' },
        },
      },
      post: {
        tags: ['Flow'],
        summary: 'Create flow definition',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Success' },
        },
      },
    },
    '/api/flow/instances': {
      get: {
        tags: ['Flow'],
        summary: 'List flow instances',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Success' },
        },
      },
      post: {
        tags: ['Flow'],
        summary: 'Start flow instance',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Success' },
        },
      },
    },
    '/api/flow/tasks': {
      get: {
        tags: ['Flow'],
        summary: 'Get my tasks',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Success' },
        },
      },
    },
  },
}

export default spec
