import { WidgetTemplateModel } from '../models/WidgetTemplate.js'

/**
 * 种子内置模板
 *
 * 不再预设模板数据。模板由用户在编辑器中创建和管理。
 * 此函数仅确保数据库连接正常，不插入任何数据。
 */
export async function seedBuiltinTemplates(): Promise<void> {
  // 不再插入内置模板，由用户自行创建
  console.log('[seed] Builtin templates: skipped (user-managed)')
}
