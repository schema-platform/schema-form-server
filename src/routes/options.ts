import Router from '@koa/router'

const router = new Router({ prefix: '/api/options' })

// ========== 平铺选项数据 ==========

interface OptionItem {
  label: string
  value: string
}

const flatOptions: Record<string, OptionItem[]> = {
  // 城市列表
  cities: [
    { label: '北京', value: 'beijing' },
    { label: '上海', value: 'shanghai' },
    { label: '广州', value: 'guangzhou' },
    { label: '深圳', value: 'shenzhen' },
    { label: '杭州', value: 'hangzhou' },
    { label: '成都', value: 'chengdu' },
    { label: '武汉', value: 'wuhan' },
    { label: '南京', value: 'nanjing' },
    { label: '重庆', value: 'chongqing' },
    { label: '西安', value: 'xian' },
    { label: '苏州', value: 'suzhou' },
    { label: '天津', value: 'tianjin' },
    { label: '长沙', value: 'changsha' },
    { label: '郑州', value: 'zhengzhou' },
    { label: '东莞', value: 'dongguan' },
    { label: '青岛', value: 'qingdao' },
    { label: '沈阳', value: 'shenyang' },
    { label: '宁波', value: 'ningbo' },
    { label: '昆明', value: 'kunming' },
    { label: '大连', value: 'dalian' },
  ],
  // 部门列表
  departments: [
    { label: '技术部', value: 'tech' },
    { label: '产品部', value: 'product' },
    { label: '设计部', value: 'design' },
    { label: '运营部', value: 'operations' },
    { label: '市场部', value: 'marketing' },
    { label: '销售部', value: 'sales' },
    { label: '人力资源部', value: 'hr' },
    { label: '财务部', value: 'finance' },
    { label: '法务部', value: 'legal' },
    { label: '行政部', value: 'admin' },
    { label: '客服部', value: 'customer_service' },
    { label: '质量部', value: 'quality' },
  ],
  // 角色列表
  roles: [
    { label: '管理员', value: 'admin' },
    { label: '普通用户', value: 'user' },
    { label: '编辑', value: 'editor' },
    { label: '审核员', value: 'reviewer' },
    { label: '访客', value: 'guest' },
    { label: '超级管理员', value: 'super_admin' },
    { label: '部门主管', value: 'dept_manager' },
    { label: '项目经理', value: 'project_manager' },
    { label: '运维工程师', value: 'ops_engineer' },
    { label: '数据分析师', value: 'data_analyst' },
  ],
  // 技能标签
  skills: [
    { label: 'JavaScript', value: 'javascript' },
    { label: 'TypeScript', value: 'typescript' },
    { label: 'Python', value: 'python' },
    { label: 'Java', value: 'java' },
    { label: 'Go', value: 'go' },
    { label: 'React', value: 'react' },
    { label: 'Vue', value: 'vue' },
    { label: 'Node.js', value: 'nodejs' },
    { label: 'Docker', value: 'docker' },
    { label: 'Kubernetes', value: 'kubernetes' },
    { label: 'SQL', value: 'sql' },
    { label: 'MongoDB', value: 'mongodb' },
    { label: 'Redis', value: 'redis' },
    { label: 'Git', value: 'git' },
    { label: 'CI/CD', value: 'cicd' },
  ],
  // 优先级
  priorities: [
    { label: '紧急', value: 'urgent' },
    { label: '高', value: 'high' },
    { label: '中', value: 'medium' },
    { label: '低', value: 'low' },
    { label: '最低', value: 'lowest' },
  ],
  // 状态
  statuses: [
    { label: '启用', value: 'enabled' },
    { label: '禁用', value: 'disabled' },
    { label: '待审核', value: 'pending' },
    { label: '已通过', value: 'approved' },
    { label: '已拒绝', value: 'rejected' },
    { label: '已归档', value: 'archived' },
    { label: '草稿', value: 'draft' },
    { label: '已发布', value: 'published' },
  ],
}

// ========== 树形选项数据 ==========

interface TreeNode {
  label: string
  value: string
  children?: TreeNode[]
}

const treeOptions: Record<string, TreeNode[]> = {
  // 省市区三级树
  regions: [
    {
      label: '北京市',
      value: 'beijing',
      children: [
        {
          label: '北京市',
          value: 'beijing_city',
          children: [
            { label: '东城区', value: 'dongcheng' },
            { label: '西城区', value: 'xicheng' },
            { label: '朝阳区', value: 'chaoyang' },
            { label: '海淀区', value: 'haidian' },
            { label: '丰台区', value: 'fengtai' },
            { label: '石景山区', value: 'shijingshan' },
          ],
        },
      ],
    },
    {
      label: '上海市',
      value: 'shanghai',
      children: [
        {
          label: '上海市',
          value: 'shanghai_city',
          children: [
            { label: '黄浦区', value: 'huangpu' },
            { label: '徐汇区', value: 'xuhui' },
            { label: '长宁区', value: 'changning' },
            { label: '静安区', value: 'jingan' },
            { label: '浦东新区', value: 'pudong' },
            { label: '闵行区', value: 'minhang' },
          ],
        },
      ],
    },
    {
      label: '广东省',
      value: 'guangdong',
      children: [
        {
          label: '广州市',
          value: 'guangzhou',
          children: [
            { label: '天河区', value: 'tianhe' },
            { label: '越秀区', value: 'yuexiu' },
            { label: '荔湾区', value: 'liwan' },
            { label: '海珠区', value: 'haizhu' },
            { label: '白云区', value: 'baiyun' },
          ],
        },
        {
          label: '深圳市',
          value: 'shenzhen',
          children: [
            { label: '南山区', value: 'nanshan' },
            { label: '福田区', value: 'futian' },
            { label: '罗湖区', value: 'luohu' },
            { label: '宝安区', value: 'baoan' },
            { label: '龙岗区', value: 'longgang' },
          ],
        },
      ],
    },
    {
      label: '浙江省',
      value: 'zhejiang',
      children: [
        {
          label: '杭州市',
          value: 'hangzhou',
          children: [
            { label: '西湖区', value: 'xihu' },
            { label: '余杭区', value: 'yuhang' },
            { label: '萧山区', value: 'xiaoshan' },
            { label: '滨江区', value: 'binjiang' },
            { label: '拱墅区', value: 'gongshu' },
          ],
        },
        {
          label: '宁波市',
          value: 'ningbo',
          children: [
            { label: '海曙区', value: 'haishu' },
            { label: '鄞州区', value: 'yinzhou' },
            { label: '江北区', value: 'jiangbei' },
          ],
        },
      ],
    },
    {
      label: '四川省',
      value: 'sichuan',
      children: [
        {
          label: '成都市',
          value: 'chengdu',
          children: [
            { label: '武侯区', value: 'wuhou' },
            { label: '锦江区', value: 'jinjiang' },
            { label: '青羊区', value: 'qingyang' },
            { label: '高新区', value: 'gaoxin' },
            { label: '天府新区', value: 'tianfu' },
          ],
        },
      ],
    },
  ],
  // 部门树（含子部门）
  departments: [
    {
      label: '技术中心',
      value: 'tech_center',
      children: [
        {
          label: '前端开发组',
          value: 'frontend',
          children: [
            { label: 'Web 前端', value: 'web_frontend' },
            { label: '移动端前端', value: 'mobile_frontend' },
          ],
        },
        {
          label: '后端开发组',
          value: 'backend',
          children: [
            { label: 'Java 服务', value: 'java_service' },
            { label: 'Node.js 服务', value: 'nodejs_service' },
          ],
        },
        { label: '测试组', value: 'qa' },
        { label: '运维组', value: 'devops' },
      ],
    },
    {
      label: '产品中心',
      value: 'product_center',
      children: [
        { label: '产品规划组', value: 'product_planning' },
        { label: '用户体验组', value: 'ux' },
        { label: '数据分析组', value: 'data_analysis' },
      ],
    },
    {
      label: '设计中心',
      value: 'design_center',
      children: [
        { label: 'UI 设计组', value: 'ui_design' },
        { label: '交互设计组', value: 'interaction_design' },
        { label: '品牌设计组', value: 'brand_design' },
      ],
    },
    {
      label: '运营中心',
      value: 'operation_center',
      children: [
        { label: '内容运营组', value: 'content_ops' },
        { label: '活动运营组', value: 'event_ops' },
        { label: '用户运营组', value: 'user_ops' },
      ],
    },
    {
      label: '职能中心',
      value: 'admin_center',
      children: [
        { label: '人力资源组', value: 'hr' },
        { label: '财务组', value: 'finance' },
        { label: '行政组', value: 'admin' },
        { label: '法务组', value: 'legal' },
      ],
    },
  ],
}

// ========== 工具函数 ==========

/** 在树中搜索节点，返回匹配节点及其祖先路径 */
function searchTree(nodes: TreeNode[], keyword: string): TreeNode[] {
  const results: TreeNode[] = []
  for (const node of nodes) {
    const childMatches = node.children ? searchTree(node.children, keyword) : []
    const selfMatch = node.label.toLowerCase().includes(keyword.toLowerCase())
    if (selfMatch || childMatches.length > 0) {
      results.push({
        ...node,
        children: selfMatch ? node.children : childMatches,
      })
    }
  }
  return results
}

// ========== 路由定义 ==========

/**
 * GET /api/options/tree/:category
 * 返回树形选项，支持 search 参数搜索
 */
router.get('/tree/:category', async (ctx) => {
  const { category } = ctx.params
  const search = (ctx.query.search as string) || ''

  const data = treeOptions[category]
  if (!data) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: `Tree category "${category}" not found.` } }
    return
  }

  const result = search ? searchTree(data, search) : data
  ctx.body = { success: true, data: result }
})

/**
 * GET /api/options/:category
 * 返回平铺选项列表，支持 search 过滤和分页
 */
router.get('/:category', async (ctx) => {
  const { category } = ctx.params
  const search = (ctx.query.search as string) || ''

  // 兼容 page 和 pageSize 参数
  const pageStr = (ctx.query.page as string) || '1'
  const pageSizeStr = (ctx.query.pageSize as string) || '20'
  const page = Math.max(1, parseInt(pageStr, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr, 10) || 20))

  const data = flatOptions[category]
  if (!data) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: `Category "${category}" not found.` } }
    return
  }

  // 模糊过滤
  let filtered = data
  if (search) {
    const keyword = search.toLowerCase()
    filtered = data.filter(
      (item) => item.label.toLowerCase().includes(keyword) || item.value.toLowerCase().includes(keyword),
    )
  }

  // 分页
  const total = filtered.length
  const totalPages = Math.ceil(total / pageSize)
  const skip = (page - 1) * pageSize
  const paged = filtered.slice(skip, skip + pageSize)

  ctx.body = {
    success: true,
    data: paged,
    pagination: { page, pageSize, total, totalPages },
  }
})

export default router
