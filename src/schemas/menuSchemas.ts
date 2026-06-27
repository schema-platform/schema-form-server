import { z } from 'zod'

export const createMenuSchema = z.object({
  name: z.string().min(1, '菜单名称不能为空').max(50, '菜单名称最多50个字符'),
  parentId: z.string().nullable().default(null),
  path: z.string().max(200, '路由路径最多200个字符').default(''),
  icon: z.string().max(50, '图标最多50个字符').default(''),
  type: z.enum(['menu', 'button']).default('menu'),
  permission: z.string().max(100, '权限编码最多100个字符').default(''),
  sort: z.number().int().min(0).default(0),
  status: z.enum(['active', 'inactive']).default('active'),
  component: z.string().max(200, '组件路径最多200个字符').default(''),
  microAppId: z.string().max(100, '微应用ID最多100个字符').nullable().default(null),
  target: z.enum(['_self', '_blank']).default('_self'),
  routeType: z.enum(['schema', 'micro-app', 'link']).default('micro-app'),
  schemaId: z.string().max(100).nullable().default(null),
  url: z.string().max(500, 'URL最多500个字符').default(''),
  app: z.string().max(50, '应用标识最多50个字符').default(''),
}).strict()

export const updateMenuSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  parentId: z.string().nullable().optional(),
  path: z.string().max(200).optional(),
  icon: z.string().max(50).optional(),
  type: z.enum(['menu', 'button']).optional(),
  permission: z.string().max(100).optional(),
  sort: z.number().int().min(0).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  component: z.string().max(200).optional(),
  microAppId: z.string().max(100).nullable().optional(),
  target: z.enum(['_self', '_blank']).optional(),
  routeType: z.enum(['schema', 'micro-app', 'link']).optional(),
  schemaId: z.string().max(100).nullable().optional(),
  url: z.string().max(500).optional(),
  app: z.string().max(50).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field is required.',
})
