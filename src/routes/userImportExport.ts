import Router from '@koa/router'
import ExcelJS from 'exceljs'
import { UserModel } from '../models/User.js'
import { RoleModel } from '../models/Role.js'
import { DeptModel } from '../models/Dept.js'
import { PostModel } from '../models/Post.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'
import { validatePassword } from '../utils/passwordPolicy.js'

const requireAuth = authMiddleware({ required: true })
const router = new Router({ prefix: '/api/users' })

// GET /api/users/export — 导出用户为 Excel
router.get('/export', requireAuth, requirePermission('user:view'), async (ctx) => {
  const currentUser = ctx.state.user as { tenantId: string }
  const users = await UserModel.find({ tenantId: currentUser.tenantId })
    .select('username displayName email phone status deptId roles postIds createdAt')

  // Resolve role names, dept names, post names
  const roleIds = [...new Set(users.flatMap(u => u.roles))]
  const deptIds = [...new Set(users.map(u => u.deptId).filter(Boolean))]
  const postIds = [...new Set(users.flatMap(u => u.postIds || []))]

  const [roles, depts, posts] = await Promise.all([
    RoleModel.find({ _id: { $in: roleIds } }).select('name'),
    DeptModel.find({ _id: { $in: deptIds } }).select('name'),
    PostModel.find({ _id: { $in: postIds } }).select('name'),
  ])

  const roleMap = new Map(roles.map(r => [r._id, r.name]))
  const deptMap = new Map(depts.map(d => [d._id, d.name]))
  const postMap = new Map(posts.map(p => [p._id, p.name]))

  // Create workbook
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('用户列表')

  sheet.columns = [
    { header: '用户名', key: 'username', width: 15 },
    { header: '显示名', key: 'displayName', width: 15 },
    { header: '邮箱', key: 'email', width: 25 },
    { header: '手机', key: 'phone', width: 15 },
    { header: '部门', key: 'dept', width: 15 },
    { header: '岗位', key: 'posts', width: 20 },
    { header: '角色', key: 'roles', width: 20 },
    { header: '状态', key: 'status', width: 10 },
    { header: '创建时间', key: 'createdAt', width: 20 },
  ]

  for (const user of users) {
    sheet.addRow({
      username: user.username,
      displayName: user.displayName,
      email: user.email || '',
      phone: user.phone || '',
      dept: user.deptId ? deptMap.get(user.deptId) || '' : '',
      posts: ((user.postIds || []) as string[]).map((id: string) => postMap.get(id) || '').filter(Boolean).join(', '),
      roles: (user.roles as string[]).map((id: string) => roleMap.get(id) || '').filter(Boolean).join(', '),
      status: user.status === 'active' ? '正常' : '停用',
      createdAt: user.createdAt?.toISOString().slice(0, 19).replace('T', ' ') || '',
    })
  }

  ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  ctx.set('Content-Disposition', 'attachment; filename=users.xlsx')
  ctx.body = await workbook.xlsx.writeBuffer()
})

// POST /api/users/import — 从 Excel 导入用户
router.post('/import', requireAuth, requirePermission('user:create'), async (ctx) => {
  const currentUser = ctx.state.user as { tenantId: string }
  const tenantId = currentUser.tenantId

  // Get file from request body (raw binary)
  const fileBuffer = ctx.request.body as Buffer
  if (!fileBuffer || fileBuffer.length === 0) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: '请上传 Excel 文件。' } }
    return
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(fileBuffer)

  const sheet = workbook.worksheets[0]
  if (!sheet) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Excel 文件为空。' } }
    return
  }

  // Parse rows (skip header)
  const results = { created: 0, skipped: 0, errors: [] as string[] }

  // Build lookup maps
  const [allRoles, allDepts, allPosts] = await Promise.all([
    RoleModel.find({ tenantId }).select('name'),
    DeptModel.find({ tenantId }).select('name'),
    PostModel.find({ tenantId }).select('name'),
  ])
  const roleNameMap = new Map(allRoles.map(r => [r.name, r._id]))
  const deptNameMap = new Map(allDepts.map(d => [d.name, d._id]))
  const postNameMap = new Map(allPosts.map(p => [p.name, p._id]))

  for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
    const row = sheet.getRow(rowNum)
    const username = row.getCell(1).value?.toString().trim()
    const displayName = row.getCell(2).value?.toString().trim()
    const email = row.getCell(3).value?.toString().trim() || null
    const phone = row.getCell(4).value?.toString().trim() || null
    const deptName = row.getCell(5).value?.toString().trim() || ''
    const postNames = row.getCell(6).value?.toString().trim() || ''
    const roleNames = row.getCell(7).value?.toString().trim() || ''
    const statusStr = row.getCell(8).value?.toString().trim() || '正常'

    if (!username) {
      results.skipped++
      continue
    }

    // Check duplicate
    const existing = await UserModel.findOne({ username, tenantId })
    if (existing) {
      results.skipped++
      results.errors.push(`行 ${rowNum}: 用户名 "${username}" 已存在`)
      continue
    }

    // Resolve IDs
    const deptId = deptName ? deptNameMap.get(deptName) || null : null
    const postIds = postNames ? postNames.split(',').map(n => postNameMap.get(n.trim())).filter(Boolean) as string[] : []
    const roleIds = roleNames ? roleNames.split(',').map(n => roleNameMap.get(n.trim())).filter(Boolean) as string[] : []
    const status = statusStr === '正常' ? 'active' : 'inactive'

    await UserModel.create({
      username,
      password: 'Temp123456', // Default password, user should change
      displayName: displayName || username,
      email,
      phone,
      deptId,
      postIds,
      roles: roleIds,
      tenantId,
      status,
    })
    results.created++
  }

  ctx.body = { success: true, data: results }
})

export default router
