import { MenuModel } from '../models/Menu.js'
import { DEFAULT_TENANT_ID } from './initDefaultTenant.js'

interface MenuSeed {
  _id: string
  parentId: string | null
  name: string
  path: string
  icon: string
  type: 'menu' | 'button'
  permission: string
  sort: number
  microAppId: string | null
  target?: '_self' | '_blank'
  routeType?: 'schema' | 'micro-app' | 'link'
  schemaId?: string | null
  url?: string
  app?: string
}

// Stable UUIDs for each menu item
const IDS = {
  SYSTEM:       'a1b2c3d4-0001-4000-8000-000000000001',
  MENU_MANAGE:  'a1b2c3d4-0002-4000-8000-000000000002',
  EDITOR:       'a1b2c3d4-000b-4000-8000-00000000000b',
  FLOW:         'a1b2c3d4-000c-4000-8000-00000000000c',
  AI:           'a1b2c3d4-000d-4000-8000-00000000000d',
} as const

const MENUS: MenuSeed[] = [
  // ── 系统管理 (目录) — app=admin ──
  { _id: IDS.SYSTEM,       parentId: null,   name: '系统管理',   path: '',            icon: 'Setting',    type: 'menu', permission: '', sort: 1, microAppId: null, app: 'admin' },

  // ── 系统管理 / 菜单管理 — 完整路由路径 /app/admin/menus ──
  { _id: IDS.MENU_MANAGE,  parentId: IDS.SYSTEM, name: '菜单管理', path: '/app/admin/menus', icon: 'Menu', type: 'menu', permission: '', sort: 1, microAppId: 'admin', target: '_self', app: 'admin' },

  // ── 表单设计器（新开页签） — 完整路由路径 /standalone/editor ──
  { _id: IDS.EDITOR,       parentId: null,   name: '表单设计器', path: '/standalone/editor',     icon: 'EditPen',    type: 'menu', permission: '', sort: 2, microAppId: 'editor', target: '_blank', app: 'shell' },

  // ── 流程设计器（新开页签） — 完整路由路径 /standalone/flow/design ──
  { _id: IDS.FLOW,         parentId: null,   name: '流程设计器', path: '/standalone/flow/design', icon: 'Connection', type: 'menu', permission: '', sort: 3, microAppId: 'flow',  target: '_blank', app: 'shell' },

  // ── AI 应用（新开页签） — 完整路由路径 /standalone/ai ──
  { _id: IDS.AI,           parentId: null,   name: 'AI 应用',    path: '/standalone/ai',          icon: 'ChatDotRound', type: 'menu', permission: '', sort: 4, microAppId: 'ai', target: '_blank', app: 'shell' },
]

/**
 * 种子数据：默认菜单树
 *
 * 使用 upsert 保证幂等，根据 _id 判断存在性。
 * 同时为现有菜单补充 app 字段（向后兼容迁移）。
 * 不再删除用户创建的同名菜单。
 */
export async function seedMenus(): Promise<void> {
  let created = 0
  let updated = 0

  for (const menu of MENUS) {
    const result = await MenuModel.updateOne(
      { _id: menu._id },
      { $set: { ...menu, tenantId: DEFAULT_TENANT_ID } },
      { upsert: true },
    )

    if (result.upsertedCount > 0) created++
    else if (result.modifiedCount > 0) updated++
  }

  const skipped = MENUS.length - created - updated
  console.log(`[seed] Menus: ${created} created, ${updated} updated, ${skipped} unchanged`)

  // ── 迁移：为现有菜单补充 app 字段 ──
  const systemDir = await MenuModel.findOne({ _id: IDS.SYSTEM })
  if (systemDir) {
    // 系统管理目录下的子菜单 → app=admin
    const adminChildren = await MenuModel.updateMany(
      { parentId: systemDir._id, app: { $in: [null, ''] } },
      { $set: { app: 'admin' } },
    )
    // microAppId=admin 的菜单 → app=admin
    const adminMicroApp = await MenuModel.updateMany(
      { microAppId: 'admin', app: { $in: [null, ''] } },
      { $set: { app: 'admin' } },
    )
    // microAppId=editor/flow/ai 的菜单 → app=shell
    const shellMicroApp = await MenuModel.updateMany(
      { microAppId: { $in: ['editor', 'flow', 'ai'] }, app: { $in: [null, ''] } },
      { $set: { app: 'shell' } },
    )

    const migrated = adminChildren.modifiedCount + adminMicroApp.modifiedCount + shellMicroApp.modifiedCount
    if (migrated > 0) {
      console.log(`[seed] Migrated ${migrated} menus with app field`)
    }
  }
}
