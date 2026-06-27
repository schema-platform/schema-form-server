import type { Middleware } from 'koa'
import { RoleModel, type DataScope } from '../models/Role.js'
import { DeptModel } from '../models/Dept.js'
import type { JwtPayload } from './auth.js'

/**
 * Resolve the list of dept IDs that the user can access
 * based on their roles' data_scope settings.
 *
 * - `all`: no restriction (returns null = no filter needed)
 * - `dept`: user's own dept + all descendant depts
 * - `self`: only user's own data (returns empty array, caller filters by createdBy)
 * - `custom`: union of all roles' dept_ids lists
 */
export async function resolveAllowedDeptIds(userId: string, roles: string[]): Promise<string[] | null> {
  if (roles.length === 0) return null // no roles = no data_scope restriction

  const roleDocs = await RoleModel.find({ _id: { $in: roles } })
  if (roleDocs.length === 0) return null

  // Collect all data_scope values from user's roles
  const scopes = roleDocs.map(r => ({ scope: r.data_scope, deptIds: r.dept_ids }))

  // If any role has `all` scope, no restriction applies
  if (scopes.some(s => s.scope === 'all')) return null

  const allowedIds = new Set<string>()
  let hasSelf = false

  for (const { scope, deptIds } of scopes) {
    if (scope === 'dept') {
      // Get user's deptId from the user document
      const { UserModel } = await import('../models/User.js')
      const user = await UserModel.findById(userId).select('deptId').lean()
      const userDeptId = (user as { deptId?: string } | null)?.deptId
      if (userDeptId) {
        allowedIds.add(userDeptId)
        // Find all descendant departments
        const descendants = await findDescendantDepts(userDeptId)
        for (const d of descendants) allowedIds.add(d)
      }
    } else if (scope === 'self') {
      hasSelf = true
    } else if (scope === 'custom') {
      for (const id of deptIds) allowedIds.add(id)
      // Also include descendants of custom dept_ids
      if (deptIds.length > 0) {
        const descendants = await findDescendantDepts(deptIds)
        for (const d of descendants) allowedIds.add(d)
      }
    }
  }

  // If dept/custom scopes produced results, they are more permissive than self
  if (allowedIds.size > 0) return Array.from(allowedIds)
  // Only self scope applies
  if (hasSelf) return ['__self__']
  return []
}

/**
 * Iteratively find all descendant department IDs (BFS).
 * Uses iterative approach to avoid stack overflow on deep hierarchies.
 */
async function findDescendantDepts(deptIds: string | string[]): Promise<string[]> {
  const ids = Array.isArray(deptIds) ? deptIds : [deptIds]
  const result: string[] = []
  let currentLevel = ids

  while (currentLevel.length > 0) {
    const children = await DeptModel.find({ parentId: { $in: currentLevel } }).select('_id').lean()
    const nextLevel: string[] = []
    for (const child of children) {
      const childId = (child as { _id: string })._id
      result.push(childId)
      nextLevel.push(childId)
    }
    currentLevel = nextLevel
  }

  return result
}

/**
 * Build a MongoDB filter condition based on data_scope.
 *
 * @param userId - current user ID
 * @param roles - current user's role IDs
 * @param ownerField - the field name that stores the owner (e.g. 'createdBy', 'initiatedBy')
 * @returns a filter object to merge into the query, or null if no restriction
 */
export async function buildDataScopeFilter(
  userId: string,
  roles: string[],
  ownerField: string,
): Promise<Record<string, unknown> | null> {
  const allowedDeptIds = await resolveAllowedDeptIds(userId, roles)
  if (allowedDeptIds === null) return null // all scope or no roles

  if (allowedDeptIds.length === 1 && allowedDeptIds[0] === '__self__') {
    // Self scope: only own data
    return { [ownerField]: userId }
  }

  if (allowedDeptIds.length > 0) {
    // Dept/custom scope: filter by owner's deptId
    // Need to look up users in those departments
    const { UserModel } = await import('../models/User.js')
    const usersInDepts = await UserModel.find({ deptId: { $in: allowedDeptIds } }).select('_id').lean()
    const userIds = usersInDepts.map(u => (u as { _id: string })._id)
    return { [ownerField]: { $in: userIds } }
  }

  return null
}

/**
 * Koa middleware that attaches data_scope filter building to ctx.state.
 *
 * Usage in routes:
 *   router.get('/', requireAuth, dataScopeMiddleware(), async (ctx) => {
 *     const baseFilter = { ... }
 *     const filter = ctx.state.applyDataScope(baseFilter, 'createdBy')
 *     const items = await Model.find(filter)
 *   })
 */
export function dataScopeMiddleware(): Middleware {
  return async (ctx, next) => {
    const user = ctx.state.user as JwtPayload | undefined
    if (user) {
      ctx.state.applyDataScope = async (
        baseFilter: Record<string, unknown>,
        ownerField: string,
      ): Promise<Record<string, unknown>> => {
        const scopeFilter = await buildDataScopeFilter(user.id, user.roles, ownerField)
        if (!scopeFilter) return baseFilter
        return { ...baseFilter, ...scopeFilter }
      }
    } else {
      ctx.state.applyDataScope = (baseFilter: Record<string, unknown>) => baseFilter
    }

    await next()
  }
}
