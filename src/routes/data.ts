import Router from '@koa/router'

const router = new Router({ prefix: '/api/data' })

const departments = ['tech', 'product', 'design', 'operations', 'marketing', 'sales', 'hr', 'finance', 'legal', 'admin']
const statuses = ['enabled', 'disabled', 'pending', 'approved', 'rejected', 'archived']
const firstNames = ['张', '李', '王', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗']
const lastNames = ['伟', '芳', '娜', '敏', '静', '强', '磊', '洋', '勇', '艳', '军', '杰', '涛', '明', '超', '秀英', '丽', '鑫', '斌', '桂英']

/** 生成模拟数据记录 */
function generateMockRecords(count: number) {
  const records = []
  for (let i = 1; i <= count; i++) {
    const firstName = firstNames[i % firstNames.length]
    const lastName = lastNames[(i * 3) % lastNames.length]
    records.push({
      id: String(i),
      name: `${firstName}${lastName}`,
      age: 20 + (i % 40),
      email: `user${i}@example.com`,
      department: departments[i % departments.length],
      status: statuses[i % statuses.length],
      city: ['beijing', 'shanghai', 'guangzhou', 'shenzhen', 'hangzhou', 'chengdu', 'wuhan', 'nanjing'][i % 8],
      joinDate: `202${Math.floor(i / 50)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    })
  }
  return records
}

const mockRecords = generateMockRecords(200)

/**
 * GET/POST /api/data/list
 * 同时支持 GET（query）和 POST（body）读取参数
 */
async function listHandler(ctx: Router.RouterContext) {
  // POST 从 body 读取，GET 从 query 读取
  const params = ctx.method === 'POST' ? (ctx.request.body as Record<string, unknown>) : ctx.query

  // 分页参数：优先 pageNum/pageSize，兼容 page/size
  const pageNumStr = String(params.pageNum ?? params.page ?? '1')
  const pageSizeStr = String(params.pageSize ?? params.size ?? '10')
  const page = Math.max(1, parseInt(pageNumStr, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr, 10) || 10))

  // 收集过滤参数（排除分页键）
  const paginationKeys = new Set(['page', 'pageNum', 'pageSize', 'size'])
  const filters: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    if (!paginationKeys.has(key) && value && typeof value === 'string') {
      filters[key] = value
    }
  }

  let items = [...mockRecords]

  // 应用过滤条件
  for (const [key, value] of Object.entries(filters)) {
    items = items.filter((item) => {
      const fieldValue = (item as Record<string, unknown>)[key]
      if (fieldValue === undefined) return false
      return String(fieldValue).toLowerCase().includes(value.toLowerCase())
    })
  }

  const total = items.length
  const totalPages = Math.ceil(total / pageSize)
  const skip = (page - 1) * pageSize
  const paged = items.slice(skip, skip + pageSize)

  ctx.body = {
    success: true,
    data: {
      items: paged,
      total,
      page,
      pageSize,
      totalPages,
    },
  }
}

router.get('/list', listHandler)
router.post('/list', listHandler)

/**
 * GET /api/data/:id
 */
router.get('/:id', async (ctx) => {
  const { id } = ctx.params
  const record = mockRecords.find((r) => r.id === id)

  if (!record) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Record not found.' } }
    return
  }

  ctx.body = { success: true, data: record }
})

export default router
