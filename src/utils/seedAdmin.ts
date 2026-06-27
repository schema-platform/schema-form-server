import { UserModel } from '../models/User.js'
import { RoleModel } from '../models/Role.js'
import { DEFAULT_TENANT_ID } from './initDefaultTenant.js'

/**
 * 创建默认管理员账号
 *
 * 用户名: admin
 * 密码: admin123456
 * 租户: 默认租户 (000000)
 * 角色: 管理员
 */
export async function seedAdmin(): Promise<void> {
  const existing = await UserModel.findOne({
    username: 'admin',
    tenantId: DEFAULT_TENANT_ID,
  })

  if (existing) {
    console.log('[seed] Admin user already exists')
    return
  }

  // 获取管理员角色 ID
  const adminRole = await RoleModel.findOne({
    name: '管理员',
    tenantId: DEFAULT_TENANT_ID,
  })

  if (!adminRole) {
    console.log('[seed] Admin role not found, skipping admin user creation')
    return
  }

  await UserModel.create({
    username: 'admin',
    password: 'admin123456',
    displayName: '系统管理员',
    roles: [adminRole._id],
    tenantId: DEFAULT_TENANT_ID,
    status: 'active',
  })

  console.log('[seed] Admin user created: admin / admin123456')
}
