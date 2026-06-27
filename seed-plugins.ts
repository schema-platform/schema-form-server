/**
 * Plugin Marketplace seed script.
 * Run: cd packages/server && tsx seed-plugins.ts
 */
import 'dotenv/config'
import { connectDatabase, mongoose } from './src/config/database.js'
import { PluginModel } from './src/ai/models/plugin.js'
import { v4 as uuidv4 } from 'uuid'

const builtinPlugins = [
  {
    _id: uuidv4(),
    name: '表单验证增强',
    description: '提供高级表单验证规则，包括正则表达式、跨字段校验、异步验证等能力。安装后 AI 生成表单时会自动使用更精确的验证规则。',
    author: 'system',
    version: '1.0.0',
    category: 'productivity' as const,
    icon: 'Shield',
    config: {
      rules: ['email', 'phone', 'idCard', 'url', 'custom'],
    },
    tools: [
      {
        name: 'validate_advanced',
        description: '执行高级字段验证（正则、跨字段、异步）',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            rules: { type: 'array' },
          },
        },
      },
    ],
    prompt: '当生成表单时，对关键字段（邮箱、手机号、身份证号）自动添加对应的正则验证规则。',
    downloads: 128,
    rating: 4.5,
    isBuiltin: true,
    enabled: true,
  },
  {
    _id: uuidv4(),
    name: '数据表格高级功能',
    description: '为数据表格组件增加排序、筛选、分页、导出 Excel 等高级功能配置。让 AI 生成的表格更贴近真实业务需求。',
    author: 'system',
    version: '1.2.0',
    category: 'productivity' as const,
    icon: 'Grid',
    config: {
      features: ['sort', 'filter', 'pagination', 'export', 'columnResize'],
    },
    tools: [
      {
        name: 'configure_table_features',
        description: '配置表格高级功能（排序、筛选、分页等）',
        parameters: {
          type: 'object',
          properties: {
            tableId: { type: 'string' },
            features: { type: 'array' },
          },
        },
      },
    ],
    prompt: '生成数据表格时，默认启用排序、筛选和分页功能。如果用户提到导出需求，自动添加 Excel 导出能力。',
    downloads: 256,
    rating: 4.8,
    isBuiltin: true,
    enabled: true,
  },
  {
    _id: uuidv4(),
    name: '审批流程模板库',
    description: '内置常见审批流程模板（请假、报销、采购、合同审批等），AI 生成流程时可直接引用模板快速创建。',
    author: 'system',
    version: '2.0.0',
    category: 'business' as const,
    icon: 'CheckCircle',
    config: {
      templates: ['leave', 'expense', 'purchase', 'contract', 'onboarding'],
    },
    tools: [
      {
        name: 'get_flow_template',
        description: '获取审批流程模板',
        parameters: {
          type: 'object',
          properties: {
            templateId: { type: 'string' },
          },
        },
      },
      {
        name: 'list_flow_templates',
        description: '列出所有可用的流程模板',
        parameters: {},
      },
    ],
    prompt: '当用户需要创建审批流程时，优先从模板库中查找匹配的模板。如果有合适的模板，直接使用并根据用户需求微调；如果没有合适模板，再从零开始设计。',
    downloads: 512,
    rating: 4.9,
    isBuiltin: true,
    enabled: true,
  },
  {
    _id: uuidv4(),
    name: '国际化助手',
    description: '帮助生成支持多语言的表单和页面，自动为 label、placeholder、提示文本等生成 i18n key。',
    author: 'system',
    version: '1.0.0',
    category: 'development' as const,
    icon: 'Globe',
    config: {
      defaultLocale: 'zh-CN',
      supportedLocales: ['zh-CN', 'en-US'],
    },
    tools: [
      {
        name: 'generate_i18n_keys',
        description: '为表单组件生成国际化 key',
        parameters: {
          type: 'object',
          properties: {
            widgets: { type: 'array' },
            locale: { type: 'string' },
          },
        },
      },
    ],
    prompt: '当用户提到国际化、多语言、i18n 时，为所有文本类属性（label、placeholder、title、description）生成规范的 i18n key，格式为 module.component.field。',
    downloads: 89,
    rating: 4.2,
    isBuiltin: true,
    enabled: true,
  },
  {
    _id: uuidv4(),
    name: '图表智能推荐',
    description: '根据数据特征自动推荐最合适的图表类型和配置。支持趋势分析、占比分析、对比分析等场景。',
    author: 'system',
    version: '1.1.0',
    category: 'development' as const,
    icon: 'BarChart',
    config: {
      chartTypes: ['bar', 'line', 'pie', 'radar', 'scatter', 'heatmap'],
    },
    tools: [
      {
        name: 'recommend_chart',
        description: '根据数据特征推荐图表类型',
        parameters: {
          type: 'object',
          properties: {
            dataStructure: { type: 'object' },
            analysisGoal: { type: 'string' },
          },
        },
      },
    ],
    prompt: '当用户需要数据可视化时，根据数据特征和分析目标推荐最合适的图表类型。趋势数据用折线图，占比数据用饼图，对比数据用柱状图，多维度数据用雷达图。',
    downloads: 347,
    rating: 4.6,
    isBuiltin: true,
    enabled: true,
  },
]

async function seedPlugins() {
  await connectDatabase()

  let created = 0
  let skipped = 0

  for (const pluginData of builtinPlugins) {
    const existing = await PluginModel.findOne({ name: pluginData.name })
    if (existing) {
      console.log(`[seed-plugins] Plugin "${pluginData.name}" already exists, skipping.`)
      skipped++
    } else {
      await PluginModel.create(pluginData)
      console.log(`[seed-plugins] Plugin created: ${pluginData.name} (${pluginData.category})`)
      created++
    }
  }

  await mongoose.disconnect()
  console.log(`[seed-plugins] Done. Created: ${created}, Skipped: ${skipped}`)
}

seedPlugins().catch((err) => {
  console.error('[seed-plugins] Failed:', err)
  process.exit(1)
})
