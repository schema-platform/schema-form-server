import { FlowDefinitionModel } from '../flow-models/FlowDefinition.js'
import { UserModel } from '../models/User.js'
import { RoleModel } from '../models/Role.js'

export class FlowPermissionService {
  /**
   * 本地开发环境跳过权限检查
   */
  private isDev(): boolean {
    return process.env.NODE_ENV !== 'production'
  }

  /**
   * 获取用户的所有权限（基于角色）
   */
  async getUserPermissions(userId: string): Promise<Set<string>> {
    if (this.isDev()) return new Set(['*']) // 开发环境返回所有权限

    const user = await UserModel.findById(userId)
    if (!user) return new Set()

    const roles = await RoleModel.find({ _id: { $in: user.roles } })
    return new Set(roles.flatMap(r => r.permissions))
  }

  /**
   * 检查用户是否有指定权限
   */
  async hasPermission(userId: string, permission: string): Promise<boolean> {
    if (this.isDev()) return true // 开发环境跳过

    const permissions = await this.getUserPermissions(userId)
    return permissions.has(permission)
  }

  /**
   * 检查流程编辑权限
   * 优先级：流程定义级权限 > 角色权限
   */
  async checkEditPermission(userId: string, definitionId: string): Promise<boolean> {
    const def = await FlowDefinitionModel.findById(definitionId)
    if (!def) return false

    // Creator always has permission
    if (def.createdBy === userId) return true

    // Check flow-level editors list
    if (def.permissions?.editors && def.permissions.editors.length > 0) {
      if (def.permissions.editors.includes(userId)) return true
    }

    // Check role-based permission
    return this.hasPermission(userId, 'flow:design')
  }

  /**
   * 检查流程发起权限
   * 优先级：流程定义级权限 > 角色权限
   */
  async checkLaunchPermission(userId: string, definitionId: string): Promise<boolean> {
    const def = await FlowDefinitionModel.findById(definitionId)
    if (!def) return false
    if (def.status !== 'published') return false

    // Check flow-level launchers list
    if (def.permissions?.launchers && def.permissions.launchers.length > 0) {
      if (def.permissions.launchers.includes(userId)) return true
    }

    // Check role-based permission
    return this.hasPermission(userId, 'flow:start')
  }

  /**
   * 检查流程查看权限
   * 优先级：流程定义级权限 > 角色权限
   */
  async checkViewPermission(userId: string, definitionId: string): Promise<boolean> {
    const def = await FlowDefinitionModel.findById(definitionId)
    if (!def) return false

    // Creator always has permission
    if (def.createdBy === userId) return true

    // Check flow-level viewers list
    if (def.permissions?.viewers && def.permissions.viewers.length > 0) {
      if (def.permissions.viewers.includes(userId)) return true
    }

    // Check role-based permission
    return this.hasPermission(userId, 'flow:view')
  }

  /**
   * 检查流程审批权限
   */
  async checkApprovePermission(userId: string): Promise<boolean> {
    return this.hasPermission(userId, 'flow:approve')
  }

  /**
   * 检查流程监控权限
   */
  async checkMonitorPermission(userId: string): Promise<boolean> {
    return this.hasPermission(userId, 'flow:monitor')
  }
}

export const flowPermissionService = new FlowPermissionService()
