/**
 * File upload service
 *
 * Supports image upload (avatar, attachments) with local storage.
 * Files are stored in packages/server/uploads/ and served via /api/files/:filename.
 */
import Router from '@koa/router'
import multer from '@koa/multer'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { authMiddleware } from '../middleware/auth.js'

const requireAuth = authMiddleware({ required: true })
const router = new Router({ prefix: '/api/files' })

// Upload directory
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

// Subdirectories
const SUBDIRS = ['images', 'avatars', 'attachments'] as const
for (const dir of SUBDIRS) {
  const subPath = path.join(UPLOAD_DIR, dir)
  if (!fs.existsSync(subPath)) {
    fs.mkdirSync(subPath, { recursive: true })
  }
}

// Multer configuration
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, UPLOAD_DIR)
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname)
    const hash = crypto.randomBytes(8).toString('hex')
    const timestamp = Date.now()
    cb(null, `${timestamp}-${hash}${ext}`)
  },
})

const imageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter(_req, file, cb) {
    const allowed = /\.(jpg|jpeg|png|gif|webp|svg)$/i
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true)
    } else {
      cb(new Error('只允许上传图片文件（jpg/png/gif/webp/svg）'), false)
    }
  },
})

const fileUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
})

// POST /api/files/upload/image — 图片上传
router.post('/upload/image', requireAuth, imageUpload.single('file'), async (ctx) => {
  const file = (ctx as any).file as Express.Multer.File | undefined
  if (!file) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: '请选择文件。' } }
    return
  }

  // Move to images subdirectory
  const finalPath = path.join(UPLOAD_DIR, 'images', file.filename)
  fs.renameSync(file.path, finalPath)

  const url = `/api/files/images/${file.filename}`
  ctx.body = {
    success: true,
    data: {
      url,
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    },
  }
})

// POST /api/files/upload/avatar — 头像上传
router.post('/upload/avatar', requireAuth, imageUpload.single('file'), async (ctx) => {
  const file = (ctx as any).file as Express.Multer.File | undefined
  if (!file) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: '请选择文件。' } }
    return
  }

  const finalPath = path.join(UPLOAD_DIR, 'avatars', file.filename)
  fs.renameSync(file.path, finalPath)

  const url = `/api/files/avatars/${file.filename}`
  ctx.body = {
    success: true,
    data: {
      url,
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
    },
  }
})

// POST /api/files/upload/file — 通用文件上传
router.post('/upload/file', requireAuth, fileUpload.single('file'), async (ctx) => {
  const file = (ctx as any).file as Express.Multer.File | undefined
  if (!file) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: '请选择文件。' } }
    return
  }

  const finalPath = path.join(UPLOAD_DIR, 'attachments', file.filename)
  fs.renameSync(file.path, finalPath)

  const url = `/api/files/attachments/${file.filename}`
  ctx.body = {
    success: true,
    data: {
      url,
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    },
  }
})

// GET /api/files/:subdir/:filename — 静态文件访问
router.get('/:subdir/:filename', async (ctx) => {
  const { subdir, filename } = ctx.params

  // Security: only allow known subdirectories
  if (!SUBDIRS.includes(subdir as typeof SUBDIRS[number])) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'File not found.' } }
    return
  }

  // Security: prevent path traversal
  const safeFilename = path.basename(filename)
  const filePath = path.join(UPLOAD_DIR, subdir, safeFilename)

  if (!fs.existsSync(filePath)) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'File not found.' } }
    return
  }

  const ext = path.extname(safeFilename).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }

  ctx.set('Content-Type', mimeTypes[ext] || 'application/octet-stream')
  ctx.set('Cache-Control', 'public, max-age=86400') // 1 day cache
  ctx.body = fs.createReadStream(filePath)
})

export default router
