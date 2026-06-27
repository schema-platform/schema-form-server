import { MicroAppModel } from '../models/MicroApp.js'
import { DEFAULT_TENANT_ID } from './initDefaultTenant.js'

const DEFAULT_MICRO_APPS = [
  { name: 'editor', displayName: '表单设计器', activeRule: '/standalone/editor', layout: 'without-menu', icon: 'EditPen', url: '/schema-platform/micro/editor/', sort: 1 },
  { name: 'flow', displayName: '流程设计器', activeRule: '/standalone/flow', layout: 'with-menu', icon: 'Connection', url: '/schema-platform/micro/flow/', sort: 2 },
  { name: 'ai', displayName: 'AI 应用', activeRule: '/standalone/ai', layout: 'without-menu', icon: 'ChatDotRound', url: '/schema-platform/micro/ai/', sort: 3 },
]

/**
 * 种子微应用配置
 * 使用 upsert 保证幂等：按 (tenantId + activeRule) 去重
 * 使用 $set 而非 $setOnInsert，确保 URL 等字段与代码保持同步
 * 不再删除用户自建的微应用
 */
export async function seedMicroApps(): Promise<void> {
  let created = 0
  let updated = 0

  for (const app of DEFAULT_MICRO_APPS) {
    const result = await MicroAppModel.updateOne(
      { tenantId: DEFAULT_TENANT_ID, activeRule: app.activeRule },
      { $set: { ...app, tenantId: DEFAULT_TENANT_ID, status: 'active' } },
      { upsert: true },
    )
    if (result.upsertedCount > 0) created++
    else if (result.modifiedCount > 0) updated++
  }

  const skipped = DEFAULT_MICRO_APPS.length - created - updated
  console.log(`[seed] Micro apps: ${created} created, ${updated} updated, ${skipped} unchanged`)
}
