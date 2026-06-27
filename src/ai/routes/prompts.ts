/**
 * Prompt Management API Routes
 *
 * CRUD operations for prompt templates, quality analysis,
 * feedback-based optimization, and prompt testing.
 *
 * GET    /api/ai/prompts              — List prompt templates (paginated)
 * POST   /api/ai/prompts              — Create prompt template
 * GET    /api/ai/prompts/:id          — Get prompt template detail
 * PUT    /api/ai/prompts/:id          — Update prompt template
 * DELETE /api/ai/prompts/:id          — Delete prompt template (non-builtin only)
 * POST   /api/ai/prompts/:id/analyze  — Analyze prompt quality
 * POST   /api/ai/prompts/:id/optimize — Optimize prompt based on feedback
 * POST   /api/ai/prompts/:id/test     — Test prompt with test cases
 * GET    /api/ai/prompts/:id/versions — Get version history
 * POST   /api/ai/prompts/:id/render   — Render template with variables
 * POST   /api/ai/prompts/seed         — Seed built-in templates
 */

import Router from '@koa/router'
import { v4 as uuidv4 } from 'uuid'
import { authMiddleware } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { PromptTemplateModel } from '../models/promptTemplate.js'
import type { IPromptTemplate } from '../models/promptTemplate.js'
import { promptOptimizer } from '../services/promptOptimizer.js'
import { builtinPromptTemplates, renderTemplate } from '../config/promptTemplates.js'
import {
  promptTemplateCreateSchema,
  promptTemplateUpdateSchema,
  promptOptimizeSchema,
  promptTestSchema,
} from '../schemas/aiSchemas.js'
import { logger } from '../../utils/logger.js'

const router = new Router({ prefix: '/api/ai/prompts' })

// ────────────────────────────────────────────
// GET /api/ai/prompts — List prompt templates
// ────────────────────────────────────────────

router.get('/', authMiddleware(), async (ctx) => {
  const {
    category,
    keyword,
    page: pageStr,
    pageSize: pageSizeStr,
  } = ctx.query as {
    category?: string
    keyword?: string
    page?: string
    pageSize?: string
  }

  const page = Math.max(parseInt(pageStr ?? '1', 10) || 1, 1)
  const pageSize = Math.min(Math.max(parseInt(pageSizeStr ?? '20', 10) || 20, 1), 50)
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = {}
  if (category) filter.category = category
  if (keyword) {
    filter.$or = [
      { name: { $regex: keyword, $options: 'i' } },
      { description: { $regex: keyword, $options: 'i' } },
      { tags: { $in: [new RegExp(keyword, 'i')] } },
    ]
  }

  const [templates, total] = await Promise.all([
    PromptTemplateModel.find(filter)
      .sort({ isBuiltin: -1, usageCount: -1, createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean<IPromptTemplate[]>(),
    PromptTemplateModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: {
      templates: templates.map((t) => ({
        id: t._id,
        name: t.name,
        description: t.description,
        category: t.category,
        variables: t.variables,
        usageCount: t.usageCount,
        successRate: t.successRate,
        isBuiltin: t.isBuiltin,
        tags: t.tags,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
      total,
      page,
      pageSize,
    },
  }
})

// ────────────────────────────────────────────
// POST /api/ai/prompts — Create prompt template
// ────────────────────────────────────────────

router.post('/', authMiddleware(), validate(promptTemplateCreateSchema), async (ctx) => {
  const body = ctx.request.body as {
    name: string
    description?: string
    category?: string
    template: string
    variables?: string[]
    tags?: string[]
  }

  const template = await PromptTemplateModel.create({
    _id: uuidv4(),
    name: body.name,
    description: body.description ?? '',
    category: body.category ?? 'custom',
    template: body.template,
    variables: body.variables ?? [],
    tags: body.tags ?? [],
    isBuiltin: false,
  })

  ctx.status = 201
  ctx.body = {
    success: true,
    data: {
      id: template._id,
      name: template.name,
      description: template.description,
      category: template.category,
      template: template.template,
      variables: template.variables,
      tags: template.tags,
      createdAt: template.createdAt,
    },
  }
})

// ────────────────────────────────────────────
// GET /api/ai/prompts/:id — Get prompt template detail
// ────────────────────────────────────────────

router.get('/:id', authMiddleware(), async (ctx) => {
  const { id } = ctx.params
  const template = await PromptTemplateModel.findById(id).lean<IPromptTemplate | null>()

  if (!template) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Prompt template not found' } }
    return
  }

  ctx.body = {
    success: true,
    data: {
      id: template._id,
      name: template.name,
      description: template.description,
      category: template.category,
      template: template.template,
      variables: template.variables,
      usageCount: template.usageCount,
      successRate: template.successRate,
      isBuiltin: template.isBuiltin,
      tags: template.tags,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    },
  }
})

// ────────────────────────────────────────────
// PUT /api/ai/prompts/:id — Update prompt template
// ────────────────────────────────────────────

router.put('/:id', authMiddleware(), validate(promptTemplateUpdateSchema), async (ctx) => {
  const { id } = ctx.params
  const body = ctx.request.body as {
    name?: string
    description?: string
    category?: string
    template?: string
    variables?: string[]
    tags?: string[]
  }

  const existing = await PromptTemplateModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Prompt template not found' } }
    return
  }

  if (existing.isBuiltin) {
    ctx.status = 403
    ctx.body = { success: false, error: { message: 'Cannot modify built-in templates. Create a copy instead.' } }
    return
  }

  const updateData: Record<string, unknown> = {}
  if (body.name !== undefined) updateData.name = body.name
  if (body.description !== undefined) updateData.description = body.description
  if (body.category !== undefined) updateData.category = body.category
  if (body.template !== undefined) updateData.template = body.template
  if (body.variables !== undefined) updateData.variables = body.variables
  if (body.tags !== undefined) updateData.tags = body.tags

  const updated = await PromptTemplateModel.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true },
  ).lean<IPromptTemplate | null>()

  ctx.body = {
    success: true,
    data: {
      id: updated!._id,
      name: updated!.name,
      description: updated!.description,
      category: updated!.category,
      template: updated!.template,
      variables: updated!.variables,
      tags: updated!.tags,
      updatedAt: updated!.updatedAt,
    },
  }
})

// ────────────────────────────────────────────
// DELETE /api/ai/prompts/:id — Delete prompt template
// ────────────────────────────────────────────

router.delete('/:id', authMiddleware(), async (ctx) => {
  const { id } = ctx.params

  const existing = await PromptTemplateModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Prompt template not found' } }
    return
  }

  if (existing.isBuiltin) {
    ctx.status = 403
    ctx.body = { success: false, error: { message: 'Cannot delete built-in templates' } }
    return
  }

  await PromptTemplateModel.findByIdAndDelete(id)

  ctx.body = { success: true }
})

// ────────────────────────────────────────────
// POST /api/ai/prompts/:id/analyze — Analyze prompt quality
// ────────────────────────────────────────────

router.post('/:id/analyze', authMiddleware(), async (ctx) => {
  const { id } = ctx.params

  const template = await PromptTemplateModel.findById(id).lean<IPromptTemplate | null>()
  if (!template) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Prompt template not found' } }
    return
  }

  const analysis = promptOptimizer.analyzeQuality(template.template)

  ctx.body = {
    success: true,
    data: analysis,
  }
})

// ────────────────────────────────────────────
// POST /api/ai/prompts/:id/optimize — Optimize prompt based on feedback
// ────────────────────────────────────────────

router.post('/:id/optimize', authMiddleware(), validate(promptOptimizeSchema), async (ctx) => {
  const { id } = ctx.params
  const { feedback } = ctx.request.body as {
    feedback: Array<{ rating: 1 | -1; comment?: string }>
  }

  const template = await PromptTemplateModel.findById(id)
  if (!template) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Prompt template not found' } }
    return
  }

  // Use template name as promptId for version tracking
  const promptId = `template-${id}`
  const result = await promptOptimizer.optimizePrompt(promptId, template.template)

  // If optimization produced a new version, update the template
  if (result.newVersion > result.previousVersion) {
    await PromptTemplateModel.findByIdAndUpdate(id, {
      $set: { template: result.optimizedContent },
    })
  }

  ctx.body = {
    success: true,
    data: {
      optimized: result.newVersion > result.previousVersion,
      previousVersion: result.previousVersion,
      newVersion: result.newVersion,
      previousSuccessRate: result.previousSuccessRate,
      optimizationReason: result.optimizationReason,
      optimizedContent: result.optimizedContent,
    },
  }
})

// ────────────────────────────────────────────
// POST /api/ai/prompts/:id/test — Test prompt with test cases
// ────────────────────────────────────────────

router.post('/:id/test', authMiddleware(), validate(promptTestSchema), async (ctx) => {
  const { id } = ctx.params
  const { testCases } = ctx.request.body as {
    testCases: Array<{ input: string; expected?: string }>
  }

  const template = await PromptTemplateModel.findById(id).lean<IPromptTemplate | null>()
  if (!template) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Prompt template not found' } }
    return
  }

  const report = await promptOptimizer.testPrompt(template.template, testCases)

  // Increment usage count
  await PromptTemplateModel.findByIdAndUpdate(id, { $inc: { usageCount: 1 } })

  ctx.body = {
    success: true,
    data: report,
  }
})

// ────────────────────────────────────────────
// GET /api/ai/prompts/:id/versions — Get version history
// ────────────────────────────────────────────

router.get('/:id/versions', authMiddleware(), async (ctx) => {
  const { id } = ctx.params

  const template = await PromptTemplateModel.findById(id).lean<IPromptTemplate | null>()
  if (!template) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Prompt template not found' } }
    return
  }

  const promptId = `template-${id}`
  const versions = await promptOptimizer.getVersionHistory(promptId)

  ctx.body = {
    success: true,
    data: {
      current: {
        id: template._id,
        template: template.template,
        updatedAt: template.updatedAt,
      },
      versions: versions.map((v) => ({
        id: v._id,
        version: v.version,
        content: v.content,
        successRate: v.successRate,
        feedbackCount: v.feedbackCount,
        optimizationReason: v.optimizationReason,
        createdAt: v.createdAt,
      })),
    },
  }
})

// ────────────────────────────────────────────
// POST /api/ai/prompts/:id/render — Render template with variables
// ────────────────────────────────────────────

router.post('/:id/render', authMiddleware(), async (ctx) => {
  const { id } = ctx.params
  const { variables } = ctx.request.body as { variables: Record<string, unknown> }

  const template = await PromptTemplateModel.findById(id).lean<IPromptTemplate | null>()
  if (!template) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Prompt template not found' } }
    return
  }

  if (!variables || typeof variables !== 'object') {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'variables object is required' } }
    return
  }

  const rendered = renderTemplate(template.template, variables)

  ctx.body = {
    success: true,
    data: {
      rendered,
      variables: template.variables,
    },
  }
})

// ────────────────────────────────────────────
// POST /api/ai/prompts/seed — Seed built-in templates
// ────────────────────────────────────────────

router.post('/seed', authMiddleware(), async (ctx) => {
  let seeded = 0
  let skipped = 0

  for (const builtin of builtinPromptTemplates) {
    const existing = await PromptTemplateModel.findOne({ name: builtin.name, isBuiltin: true })
    if (existing) {
      skipped++
      continue
    }

    await PromptTemplateModel.create({
      _id: uuidv4(),
      name: builtin.name,
      description: builtin.description,
      category: builtin.category,
      template: builtin.template,
      variables: builtin.variables,
      tags: builtin.tags,
      isBuiltin: true,
    })
    seeded++
  }

  logger.info({
    msg: 'Prompt templates seeded',
    seeded,
    skipped,
  })

  ctx.body = {
    success: true,
    data: { seeded, skipped },
  }
})

export default router
