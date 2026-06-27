/**
 * AI Plugin Marketplace Routes.
 *
 * GET    /api/ai/plugins                  — List plugins (search, filter, pagination)
 * GET    /api/ai/plugins/user/installed   — List plugins installed by current user
 * GET    /api/ai/plugins/:id              — Get plugin detail
 * POST   /api/ai/plugins                  — Create a new plugin
 * PUT    /api/ai/plugins/:id              — Update a plugin
 * DELETE /api/ai/plugins/:id              — Delete a plugin
 * POST   /api/ai/plugins/:id/install      — Install a plugin
 * POST   /api/ai/plugins/:id/uninstall    — Uninstall a plugin
 */

import Router from '@koa/router'
import { v4 as uuidv4 } from 'uuid'
import { validate } from '../middleware/validate.js'
import { authMiddleware } from '../middleware/auth.js'
import { pluginCreateSchema, pluginUpdateSchema, pluginInstallSchema } from './schemas/aiSchemas.js'
import { PluginModel } from './models/plugin.js'
import { UserPluginModel } from './models/userPlugin.js'

const router = new Router({ prefix: '/api/ai' })

// ────────────────────────────────────────────
// GET /api/ai/plugins — List plugins
// ────────────────────────────────────────────

router.get('/plugins', async (ctx) => {
  const { category, search, page: pageStr, pageSize: pageSizeStr } = ctx.query as {
    category?: string
    search?: string
    page?: string
    pageSize?: string
  }

  const page = Math.max(parseInt(pageStr ?? '1', 10) || 1, 1)
  const pageSize = Math.min(Math.max(parseInt(pageSizeStr ?? '12', 10) || 12, 1), 50)

  const query: Record<string, unknown> = {}
  if (category) query.category = category
  if (search) query.name = { $regex: search, $options: 'i' }

  const [plugins, total] = await Promise.all([
    PluginModel.find(query)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .sort({ downloads: -1 })
      .lean(),
    PluginModel.countDocuments(query),
  ])

  ctx.body = {
    success: true,
    data: {
      plugins: plugins.map((p) => ({
        id: p._id,
        name: p.name,
        description: p.description,
        author: p.author,
        version: p.version,
        category: p.category,
        icon: p.icon,
        tools: p.tools,
        prompt: p.prompt,
        downloads: p.downloads,
        rating: p.rating,
        isBuiltin: p.isBuiltin,
        enabled: p.enabled,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  }
})

// ────────────────────────────────────────────
// GET /api/ai/plugins/user/installed
// ────────────────────────────────────────────

router.get('/plugins/user/installed', authMiddleware(), async (ctx) => {
  const userId = ctx.state.user.id

  const userPlugins = await UserPluginModel.find({ userId }).lean()
  const pluginIds = userPlugins.map((up) => up.pluginId)

  if (pluginIds.length === 0) {
    ctx.body = { success: true, data: [] }
    return
  }

  const plugins = await PluginModel.find({ _id: { $in: pluginIds } }).lean()
  const userPluginMap = new Map(userPlugins.map((up) => [up.pluginId, up]))

  ctx.body = {
    success: true,
    data: plugins.map((p) => {
      const up = userPluginMap.get(p._id)
      return {
        id: p._id,
        name: p.name,
        description: p.description,
        author: p.author,
        version: p.version,
        category: p.category,
        icon: p.icon,
        tools: p.tools,
        prompt: p.prompt,
        downloads: p.downloads,
        rating: p.rating,
        isBuiltin: p.isBuiltin,
        userConfig: up?.config ?? {},
        userEnabled: up?.enabled ?? true,
        installedAt: up?.installedAt,
      }
    }),
  }
})

// ────────────────────────────────────────────
// GET /api/ai/plugins/:id
// ────────────────────────────────────────────

router.get('/plugins/:id', async (ctx) => {
  const { id } = ctx.params
  const plugin = await PluginModel.findById(id).lean()

  if (!plugin) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Plugin not found' } }
    return
  }

  ctx.body = {
    success: true,
    data: {
      id: plugin._id,
      name: plugin.name,
      description: plugin.description,
      author: plugin.author,
      version: plugin.version,
      category: plugin.category,
      icon: plugin.icon,
      config: plugin.config,
      tools: plugin.tools,
      prompt: plugin.prompt,
      downloads: plugin.downloads,
      rating: plugin.rating,
      isBuiltin: plugin.isBuiltin,
      enabled: plugin.enabled,
      createdAt: plugin.createdAt,
      updatedAt: plugin.updatedAt,
    },
  }
})

// ────────────────────────────────────────────
// POST /api/ai/plugins — Create
// ────────────────────────────────────────────

router.post('/plugins', authMiddleware(), validate(pluginCreateSchema), async (ctx) => {
  const body = ctx.request.body as {
    name: string
    description?: string
    author?: string
    version?: string
    category?: string
    icon?: string
    config?: Record<string, unknown>
    tools?: Array<{ name: string; description: string; parameters?: Record<string, unknown> }>
    prompt?: string
  }

  const plugin = await PluginModel.create({
    _id: uuidv4(),
    ...body,
    author: ctx.state.user.username ?? body.author ?? 'anonymous',
  })

  ctx.status = 201
  ctx.body = {
    success: true,
    data: {
      id: plugin._id,
      name: plugin.name,
      description: plugin.description,
      author: plugin.author,
      version: plugin.version,
      category: plugin.category,
      tools: plugin.tools,
      createdAt: plugin.createdAt,
    },
  }
})

// ────────────────────────────────────────────
// PUT /api/ai/plugins/:id — Update
// ────────────────────────────────────────────

router.put('/plugins/:id', authMiddleware(), validate(pluginUpdateSchema), async (ctx) => {
  const { id } = ctx.params
  const body = ctx.request.body as Record<string, unknown>

  const plugin = await PluginModel.findById(id)
  if (!plugin) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Plugin not found' } }
    return
  }

  if (!plugin.isBuiltin && plugin.author !== ctx.state.user.username) {
    ctx.status = 403
    ctx.body = { success: false, error: { message: 'Not authorized to update this plugin' } }
    return
  }

  Object.assign(plugin, body)
  await plugin.save()

  ctx.body = {
    success: true,
    data: {
      id: plugin._id,
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      updatedAt: plugin.updatedAt,
    },
  }
})

// ────────────────────────────────────────────
// DELETE /api/ai/plugins/:id
// ────────────────────────────────────────────

router.delete('/plugins/:id', authMiddleware(), async (ctx) => {
  const { id } = ctx.params

  const plugin = await PluginModel.findById(id)
  if (!plugin) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Plugin not found' } }
    return
  }

  if (plugin.isBuiltin) {
    ctx.status = 403
    ctx.body = { success: false, error: { message: 'Cannot delete builtin plugins' } }
    return
  }

  await PluginModel.findByIdAndDelete(id)
  await UserPluginModel.deleteMany({ pluginId: id })

  ctx.body = { success: true }
})

// ────────────────────────────────────────────
// POST /api/ai/plugins/:id/install
// ────────────────────────────────────────────

router.post('/plugins/:id/install', authMiddleware(), validate(pluginInstallSchema), async (ctx) => {
  const { id } = ctx.params
  const { config } = ctx.request.body as { config?: Record<string, unknown> }
  const userId = ctx.state.user.id

  const plugin = await PluginModel.findById(id)
  if (!plugin) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Plugin not found' } }
    return
  }

  await UserPluginModel.findOneAndUpdate(
    { userId, pluginId: id },
    {
      $set: { config: config ?? {}, enabled: true },
      $setOnInsert: { _id: uuidv4(), userId, pluginId: id },
    },
    { upsert: true, new: true },
  )

  await PluginModel.findByIdAndUpdate(id, { $inc: { downloads: 1 } })

  ctx.body = {
    success: true,
    data: { pluginId: id, installed: true },
  }
})

// ────────────────────────────────────────────
// POST /api/ai/plugins/:id/uninstall
// ────────────────────────────────────────────

router.post('/plugins/:id/uninstall', authMiddleware(), async (ctx) => {
  const { id } = ctx.params
  const userId = ctx.state.user.id

  const deleted = await UserPluginModel.findOneAndDelete({ userId, pluginId: id })
  if (!deleted) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Plugin not installed' } }
    return
  }

  ctx.body = {
    success: true,
    data: { pluginId: id, installed: false },
  }
})

export default router
