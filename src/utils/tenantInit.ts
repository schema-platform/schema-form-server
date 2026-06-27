/**
 * Tenant initialization — creates default roles and admin user for a new tenant.
 *
 * Called after tenant creation to set up the tenant's RBAC foundation.
 */
import { RoleModel } from '../models/Role.js'
import { UserModel } from '../models/User.js'
import { MenuModel } from '../models/Menu.js'

/**
 * Initialize a new tenant with default roles, admin user, and basic menus.
 */
export async function initTenantData(tenantId: string, tenantName: string): Promise<void> {
  // 1. Create default roles for this tenant
  const adminRole = await RoleModel.create({
    name: '管理员',
    description: `${tenantName} 管理员`,
    permissions: [
      'schema:view', 'schema:create', 'schema:edit', 'schema:delete', 'schema:publish',
      'flow:view', 'flow:start', 'flow:design', 'flow:approve', 'flow:delete', 'flow:monitor', 'flow:cancel',
      'user:view', 'user:create', 'user:edit', 'user:delete', 'user:reset-password',
      'role:view', 'role:create', 'role:edit', 'role:delete',
      'dept:view', 'dept:create', 'dept:edit', 'dept:delete',
      'menu:view', 'menu:create', 'menu:edit', 'menu:delete',
      'post:view', 'post:create', 'post:edit', 'post:delete',
      'dict:view', 'dict:create', 'dict:edit', 'dict:delete',
      'config:view', 'config:create', 'config:edit', 'config:delete',
      'audit:view',
      'tenant:view', 'tenant:edit',
      'template:view', 'template:create', 'template:edit', 'template:delete',
      'submission:view', 'submission:delete',
      'credential:view', 'credential:create', 'credential:edit', 'credential:delete',
      'stats:view',
    ],
    data_scope: 'all',
    tenantId,
  })

  await RoleModel.create({
    name: '普通用户',
    description: '基础查看权限',
    permissions: ['schema:view', 'flow:view', 'flow:start'],
    data_scope: 'self',
    tenantId,
  })

  // 2. Create admin user
  await UserModel.create({
    username: 'admin',
    password: 'admin123456',
    displayName: `${tenantName}管理员`,
    roles: [adminRole._id],
    tenantId,
    status: 'active',
  })

  // 3. Copy basic menus for this tenant
  const systemMenus = [
    {
      name: '系统管理',
      parentId: null,
      path: '',
      icon: 'Setting',
      type: 'menu' as const,
      permission: '',
      sort: 1,
      status: 'active' as const,
      component: '',
      microAppId: null,
      target: '_self' as const,
      routeType: 'micro-app' as const,
      schemaId: null,
      url: '',
      app: 'admin',
    },
  ]

  for (const menu of systemMenus) {
    await MenuModel.create({ ...menu, tenantId })
  }
}
