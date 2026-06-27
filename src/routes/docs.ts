import Router from '@koa/router'
import spec from '../docs/swagger.js'

const router = new Router()

/**
 * Serve the OpenAPI JSON spec at /api/docs.json
 */
router.get('/api/docs.json', (ctx) => {
  ctx.body = spec
})

/**
 * Serve Swagger UI at /api/docs
 */
router.get('/api/docs', (ctx) => {
  ctx.type = 'html'
  ctx.body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>表单设计器 API 文档</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *::before, *::after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/docs.json',
      dom_id: '#swagger-ui',
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset,
      ],
      layout: 'BaseLayout',
      deepLinking: true,
    })
  </script>
</body>
</html>`
})

export default router
