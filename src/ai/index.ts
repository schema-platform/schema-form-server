/**
 * AI module entry point.
 *
 * Re-exports the router so it can be mounted in the main Koa app.
 */

export { default as aiRouter } from './routes.js'
export { default as monitorRouter } from './monitorRoutes.js'
export { default as aiHealthRouter } from './healthRoutes.js'
export { default as ragRouter } from './ragRoutes.js'
export { default as llmProviderRouter } from './routes/llmProviderRoutes.js'
export { default as collaborationRouter } from './routes/collaboration.js'
export { default as promptsRouter } from './routes/prompts.js'
