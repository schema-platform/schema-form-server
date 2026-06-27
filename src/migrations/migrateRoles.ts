import mongoose from 'mongoose'
import { RoleModel } from '../models/Role.js'
import { UserModel } from '../models/User.js'

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://formgrid:formgrid@localhost:27017/formgrid?authSource=admin'

async function migrateRoles() {
  try {
    await mongoose.connect(MONGODB_URI)
    console.log('Connected to MongoDB')

    // 1. 创建默认角色
    const defaultRoles = [
      { name: '管理员', description: '系统管理员，拥有所有权限' },
      { name: '编辑者', description: '内容编辑者，可编辑和发布' },
      { name: '查看者', description: '只读用户，仅可查看' },
    ]

    const roleMap: Record<string, string> = {}

    for (const roleData of defaultRoles) {
      let role = await RoleModel.findOne({ name: roleData.name })
      if (!role) {
        role = await RoleModel.create(roleData)
        console.log(`Created role: ${role.name}`)
      } else {
        console.log(`Role already exists: ${role.name}`)
      }
      roleMap[roleData.name] = role._id
    }

    // 2. 迁移用户角色
    const users = await UserModel.find()
    console.log(`Found ${users.length} users to migrate`)

    for (const user of users) {
      // 检查用户是否有旧的 role 字段
      const oldRole = (user as unknown as Record<string, unknown>).role as string | undefined
      const roleMapping: Record<string, string> = {
        admin: '管理员',
        editor: '编辑者',
        viewer: '查看者',
      }

      if (oldRole && roleMapping[oldRole]) {
        user.roles = [roleMap[roleMapping[oldRole]]]
        await user.save()
        console.log(`Migrated user ${user.username}: ${oldRole} -> ${roleMapping[oldRole]}`)
      } else if (!user.roles || user.roles.length === 0) {
        // 如果没有角色，默认设为查看者
        user.roles = [roleMap['查看者']]
        await user.save()
        console.log(`Set default role for user ${user.username}: 查看者`)
      }
    }

    console.log('Migration completed successfully')
  } catch (error) {
    console.error('Migration failed:', error)
  } finally {
    await mongoose.disconnect()
    console.log('Disconnected from MongoDB')
  }
}

// 运行迁移
migrateRoles()
