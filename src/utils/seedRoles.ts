import { RoleModel } from '../models/Role.js'
import { DEFAULT_TENANT_ID } from './initDefaultTenant.js'

/**
 * 创建默认角色
 *
 * 管理员：拥有所有权限
 * 普通用户：基础查看权限（注册用户自动分配）
 */
export async function seedRoles(): Promise<void> {
  // ── 管理员角色 ──
  const adminExists = await RoleModel.findOne({
    name: '管理员',
    tenantId: DEFAULT_TENANT_ID,
  })

  if (!adminExists) {
    const allPermissions = [
      'microapp:view', 'microapp:create', 'microapp:edit', 'microapp:delete',
      'menu:view', 'menu:create', 'menu:edit', 'menu:delete',
      'user:view', 'user:create', 'user:edit', 'user:delete', 'user:reset-password',
      'role:view', 'role:create', 'role:edit', 'role:delete',
      'dept:view', 'dept:create', 'dept:edit', 'dept:delete',
      'post:view', 'post:create', 'post:edit', 'post:delete',
      'dict:view', 'dict:create', 'dict:edit', 'dict:delete',
      'config:view', 'config:create', 'config:edit', 'config:delete',
      'audit:view', 'audit:export',
      'schema:view', 'schema:create', 'schema:edit', 'schema:delete', 'schema:publish',
      'flow:view', 'flow:create', 'flow:edit', 'flow:delete', 'flow:design', 'flow:approve', 'flow:monitor', 'flow:publish', 'flow:start',
      'tenant:view', 'tenant:create', 'tenant:edit', 'tenant:delete',
      'apikey:view', 'apikey:create', 'apikey:edit', 'apikey:delete',
      'webhook:view', 'webhook:create', 'webhook:edit', 'webhook:delete',
    ]

    await RoleModel.create({
      name: '管理员',
      permissions: allPermissions,
      data_scope: 'all',
      tenantId: DEFAULT_TENANT_ID,
    })
    console.log('[seed] Admin role created with all permissions')
  }

  // ── 普通用户角色（注册用户自动分配） ──
  const userExists = await RoleModel.findOne({
    name: '普通用户',
    tenantId: DEFAULT_TENANT_ID,
  })

  if (!userExists) {
    const basicPermissions = [
      'schema:view',
      'flow:view', 'flow:start',
    ]

    await RoleModel.create({
      name: '普通用户',
      description: '注册用户默认角色，基础查看权限',
      permissions: basicPermissions,
      data_scope: 'self',
      tenantId: DEFAULT_TENANT_ID,
    })
    console.log('[seed] Regular user role created with basic permissions')
  }
}
