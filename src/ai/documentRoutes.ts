/**
 * 文档 API
 *
 * POST   /api/ai/documents/upload
 * POST   /api/ai/upload                    — 兼容旧路径
 * GET    /api/ai/documents/:id
 * GET    /api/ai/documents/:id/preview
 * GET    /api/ai/documents/:id/file      — 下载/预览原文件
 * POST   /api/ai/documents/:id/summarize
 * POST   /api/ai/documents/:id/reparse   — 从磁盘原文件重新解析
 */

import Router from '@koa/router'
import multer from '@koa/multer'
import { authMiddleware } from '../middleware/auth.js'
import { isValidObjectId } from '../utils/objectId.js'
import {
  createDocumentFromUpload,
  getDocumentById,
  getDocumentPreview,
  getDocumentFileMeta,
  openStoredDocumentFile,
  summarizeDocument,
  reprocessDocumentFromStorage,
} from './services/documentService.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

const router = new Router({ prefix: '/api/ai' })

router.use(authMiddleware())

function getUserId(ctx: { state: { user?: { id?: string; userId?: string } } }): string {
  return ctx.state.user?.id ?? ctx.state.user?.userId ?? 'anonymous'
}

function getTenantId(ctx: { state: { user?: { tenantId?: string }; tenantId?: string } }): string {
  return ctx.state.user?.tenantId ?? ctx.state.tenantId ?? '000000'
}

function rejectInvalidObjectId(
  ctx: { status: number; body: unknown },
  id: string,
  label: string,
): boolean {
  if (!id || id === 'undefined' || !isValidObjectId(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: `Invalid ${label}` } }
    return true
  }
  return false
}

async function handleUpload(ctx: {
  file?: { buffer: Buffer; originalname: string; mimetype: string }
  status: number
  body: unknown
  state: { user?: { id?: string; userId?: string; tenantId?: string }; tenantId?: string }
}) {
  const file = ctx.file
  if (!file) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'file is required' } }
    return
  }

  try {
    const data = await createDocumentFromUpload(
      file.buffer,
      file.originalname,
      file.mimetype,
      getUserId(ctx),
      getTenantId(ctx),
    )
    ctx.body = { success: true, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.status = 400
    ctx.body = { success: false, error: { message } }
  }
}

router.post('/documents/upload', upload.single('file'), handleUpload)
router.post('/upload', upload.single('file'), handleUpload)

router.get('/documents/:id', async (ctx) => {
  if (rejectInvalidObjectId(ctx, ctx.params.id, 'document id')) return
  const data = await getDocumentById(ctx.params.id, getUserId(ctx))
  if (!data) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Document not found' } }
    return
  }
  ctx.body = { success: true, data }
})

router.get('/documents/:id/preview', async (ctx) => {
  if (rejectInvalidObjectId(ctx, ctx.params.id, 'document id')) return
  const data = await getDocumentPreview(ctx.params.id, getUserId(ctx))
  if (!data) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Document not found' } }
    return
  }
  ctx.body = { success: true, data }
})

router.get('/documents/:id/file', async (ctx) => {
  if (rejectInvalidObjectId(ctx, ctx.params.id, 'document id')) return
  const meta = await getDocumentFileMeta(ctx.params.id, getUserId(ctx))
  if (!meta) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Original file not found' } }
    return
  }

  ctx.type = meta.mimetype
  ctx.set(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
  )
  ctx.body = openStoredDocumentFile(meta.storagePath)
})

router.post('/documents/:id/summarize', async (ctx) => {
  if (rejectInvalidObjectId(ctx, ctx.params.id, 'document id')) return
  const body = (ctx.request.body ?? {}) as { force?: boolean }
  try {
    const data = await summarizeDocument(ctx.params.id, getUserId(ctx), { force: body.force })
    if (!data) {
      ctx.status = 404
      ctx.body = { success: false, error: { message: 'Document not found' } }
      return
    }
    ctx.body = { success: true, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.status = 400
    ctx.body = { success: false, error: { message } }
  }
})

router.post('/documents/:id/reparse', async (ctx) => {
  if (rejectInvalidObjectId(ctx, ctx.params.id, 'document id')) return
  try {
    const data = await reprocessDocumentFromStorage(ctx.params.id, getUserId(ctx))
    if (!data) {
      ctx.status = 404
      ctx.body = { success: false, error: { message: 'Document not found' } }
      return
    }
    ctx.body = { success: true, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.status = 400
    ctx.body = { success: false, error: { message } }
  }
})

export default router
