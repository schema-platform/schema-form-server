/**
 * Database seed script.
 * Run: pnpm db:seed (or: cd packages/server && tsx seed.ts)
 */
import 'dotenv/config'
import { connectDatabase, mongoose } from './src/config/database.js'
import { UserModel } from './src/models/User.js'
import { RoleModel } from './src/models/Role.js'
import { PermissionModel } from './src/models/Permission.js'
import { FormSchemaModel } from './src/models/FormSchema.js'
import { seedModelConfigs } from './src/utils/seedModelConfigs.js'
import { seedClients } from './src/utils/seedClients.js'
import { seedBuiltinTemplates } from './src/utils/seedBuiltinTemplates.js'
import { seedMicroApps } from './src/utils/seedMicroApps.js'
import { seedMenus } from './src/utils/seedMenus.js'
import { v4 as uuidv4 } from 'uuid'

// --- 权限定义 ---
const permissions = [
  // 系统管理
  { code: 'system:user:manage', name: '用户管理', module: 'system' as const, description: '创建、编辑、删除用户' },
  { code: 'system:role:manage', name: '角色管理', module: 'system' as const, description: '创建、编辑、删除角色' },
  { code: 'system:permission:manage', name: '权限管理', module: 'system' as const, description: '管理权限配置' },

  // 表单
  { code: 'schema:create', name: '创建表单', module: 'schema' as const, description: '创建新表单' },
  { code: 'schema:edit', name: '编辑表单', module: 'schema' as const, description: '编辑表单设计' },
  { code: 'schema:delete', name: '删除表单', module: 'schema' as const, description: '删除表单' },
  { code: 'schema:view', name: '查看表单', module: 'schema' as const, description: '查看表单列表和详情' },
  { code: 'schema:publish', name: '发布表单', module: 'schema' as const, description: '发布表单版本' },

  // 流程
  { code: 'flow:design', name: '设计流程', module: 'flow' as const, description: '创建和编辑流程定义' },
  { code: 'flow:publish', name: '发布流程', module: 'flow' as const, description: '发布流程版本' },
  { code: 'flow:delete', name: '删除流程', module: 'flow' as const, description: '删除流程定义' },
  { code: 'flow:start', name: '发起流程', module: 'flow' as const, description: '发起流程实例' },
  { code: 'flow:approve', name: '审批流程', module: 'flow' as const, description: '审批流程任务' },
  { code: 'flow:view', name: '查看流程', module: 'flow' as const, description: '查看流程列表和实例' },
  { code: 'flow:monitor', name: '流程监控', module: 'flow' as const, description: '查看流程统计数据' },
]

// --- 角色定义（含权限） ---
const roles = [
  {
    name: 'admin',
    description: '系统管理员，拥有所有权限',
    permissions: permissions.map(p => p.code),  // 所有权限
  },
  {
    name: 'editor',
    description: '编辑者，可创建和编辑表单/流程',
    permissions: [
      'schema:create', 'schema:edit', 'schema:view', 'schema:publish',
      'flow:design', 'flow:publish', 'flow:view',
    ],
  },
  {
    name: 'viewer',
    description: '查看者，只读权限',
    permissions: ['schema:view', 'flow:view'],
  },
  {
    name: 'flow_designer',
    description: '流程设计师，可设计和管理流程',
    permissions: ['flow:design', 'flow:publish', 'flow:delete', 'flow:view', 'flow:monitor'],
  },
  {
    name: 'flow_approver',
    description: '流程审批人，可审批流程实例',
    permissions: ['flow:approve', 'flow:view', 'flow:start'],
  },
]

const users = [
  { username: 'admin', password: 'admin123', displayName: '管理员', roleNames: ['admin'] },
  { username: 'zhangsan', password: '123456', displayName: '张三', roleNames: ['editor', 'flow_designer'] },
  { username: 'lisi', password: '123456', displayName: '李四', roleNames: ['editor', 'flow_approver'] },
  { username: 'wangwu', password: '123456', displayName: '王五', roleNames: ['viewer'] },
  { username: 'zhaoliu', password: '123456', displayName: '赵六', roleNames: ['viewer', 'flow_approver'] },
]

async function seed() {
  await connectDatabase()

  // --- Create permissions first ---
  const permissionSet = new Set<string>() // code -> exists
  for (const p of permissions) {
    const existing = await PermissionModel.findOne({ code: p.code })
    if (existing) {
      permissionSet.add(p.code)
      console.log(`[seed] Permission "${p.code}" already exists, skipping.`)
    } else {
      await PermissionModel.create({ _id: uuidv4(), ...p })
      permissionSet.add(p.code)
      console.log(`[seed] Permission created: ${p.code} (${p.name})`)
    }
  }

  // --- Create roles with permissions ---
  const roleMap = new Map<string, string>() // roleName -> roleId
  for (const r of roles) {
    const existing = await RoleModel.findOne({ name: r.name })
    if (existing) {
      // Update permissions for existing role
      await RoleModel.findByIdAndUpdate(existing._id, { permissions: r.permissions })
      roleMap.set(r.name, existing._id)
      console.log(`[seed] Role "${r.name}" already exists, updated permissions: ${r.permissions.length}`)
    } else {
      const created = await RoleModel.create({ _id: uuidv4(), ...r })
      roleMap.set(r.name, created._id)
      console.log(`[seed] Role created: ${r.name} (permissions: ${r.permissions.length})`)
    }
  }

  // --- Create users and associate roles ---
  for (const u of users) {
    const existing = await UserModel.findOne({ username: u.username })
    if (existing) {
      console.log(`[seed] User "${u.username}" already exists, skipping.`)
    } else {
      const roleIds = u.roleNames.map(name => roleMap.get(name)!).filter(Boolean)
      await UserModel.create({ _id: uuidv4(), username: u.username, password: u.password, displayName: u.displayName, roles: roleIds })
      console.log(`[seed] User created: ${u.username} / ${u.password} (roles: ${u.roleNames.join(', ')})`)
    }
  }

  // --- Model configs ---
  await seedModelConfigs()

  // --- SSO Clients ---
  await seedClients()

  // --- Builtin templates ---
  await seedBuiltinTemplates()

  // --- Micro apps ---
  await seedMicroApps()

  // --- Menus ---
  await seedMenus()

  // --- Sample schema（每次重新创建，确保数据结构正确） ---
  await FormSchemaModel.deleteMany({ name: '示例表单' })
  {
    await FormSchemaModel.create({
      _id: uuidv4(),
      editId: uuidv4(),
      version: generateVersion(),
      name: '示例表单',
      type: 'form',
      json: [
        {
          id: uuidv4(),
          type: 'card',
          props: { title: '基本信息' },
          position: { x: 0, y: 0, w: 800, h: 400, zIndex: 1 },
          children: [
            {
              id: uuidv4(),
              type: 'input',
              label: '姓名',
              field: 'name',
              props: { placeholder: '请输入姓名', required: true },
              position: { x: 50, y: 50, w: 400, h: 60, zIndex: 1 },
            },
            {
              id: uuidv4(),
              type: 'select',
              label: '部门',
              field: 'department',
              props: { placeholder: '请选择部门', dictCode: 'department' },
              position: { x: 50, y: 120, w: 400, h: 60, zIndex: 1 },
            },
            {
              id: uuidv4(),
              type: 'radio',
              label: '状态',
              field: 'status',
              props: { dictCode: 'status' },
              position: { x: 50, y: 190, w: 400, h: 60, zIndex: 1 },
            },
          ],
        },
      ],
    })
    console.log('[seed] Sample schema created (示例表单)')
  }

  await mongoose.disconnect()
  console.log('[seed] Done.')
}

function generateVersion(): string {
  const now = new Date()
  const pad = (n: number, len: number) => String(n).padStart(len, '0')
  return (
    pad(now.getFullYear(), 4) +
    pad(now.getMonth() + 1, 2) +
    pad(now.getDate(), 2) +
    pad(now.getHours(), 2) +
    pad(now.getMinutes(), 2) +
    pad(now.getSeconds(), 2)
  )
}

seed().catch((err) => {
  console.error('[seed] Failed:', err)
  process.exit(1)
})
