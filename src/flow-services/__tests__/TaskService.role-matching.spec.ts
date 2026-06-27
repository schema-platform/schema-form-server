/**
 * TaskService Role Matching Runtime Tests
 *
 * Tests the role-based task assignment and matching logic:
 * 1. getMyTasks queries with role-based $or filter
 * 2. claimTask authorization with role intersection
 * 3. Edge cases: no roles, empty candidates, multiple roles
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskService } from '../TaskService.js'

// Mock models
vi.mock('../../flow-models/TaskInstance.js', () => ({
  TaskInstanceModel: {
    find: vi.fn(),
    findById: vi.fn(),
    countDocuments: vi.fn(),
  },
}))

vi.mock('../../flow-models/ApprovalLog.js', () => ({
  ApprovalLogModel: {
    create: vi.fn(),
  },
}))

vi.mock('../../models/User.js', () => ({
  UserModel: {
    findById: vi.fn(),
  },
}))

import { TaskInstanceModel } from '../../flow-models/TaskInstance.js'
import { ApprovalLogModel } from '../../flow-models/ApprovalLog.js'
import { UserModel } from '../../models/User.js'

function mockUserLookup(roles: string[]) {
  vi.mocked(UserModel.findById).mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({ roles }),
    }),
  } as never)
}

function mockQueryChain(items: unknown[], total = 0) {
  const mockSort = vi.fn().mockResolvedValue(items)
  const mockLimit = vi.fn().mockReturnValue({ sort: mockSort })
  const mockSkip = vi.fn().mockReturnValue({ limit: mockLimit })
  vi.mocked(TaskInstanceModel.find).mockReturnValue({ skip: mockSkip } as never)
  vi.mocked(TaskInstanceModel.countDocuments).mockResolvedValue(total)
}

function mockTask(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'task-1',
    status: 'pending',
    candidateUsers: [],
    candidateRoles: [],
    instanceId: 'inst-1',
    nodeId: 'node-1',
    nodeName: 'test',
    save: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

describe('TaskService - Role Matching Runtime', () => {
  let taskService: TaskService

  beforeEach(() => {
    taskService = new TaskService()
    vi.clearAllMocks()
  })

  // ─────────────────────────────────────
  // 1. getMyTasks role-based querying
  // ─────────────────────────────────────

  describe('getMyTasks', () => {
    it('includes role-based matching in the query filter', async () => {
      mockUserLookup(['role-admin', 'role-approver'])
      mockQueryChain([])

      await taskService.getMyTasks('user-1')

      expect(TaskInstanceModel.find).toHaveBeenCalledWith({
        status: { $in: ['pending', 'claimed'] },
        $or: [
          { assignee: 'user-1' },
          { candidateUsers: 'user-1' },
          { candidateRoles: { $in: ['role-admin', 'role-approver'] } },
        ],
      })
    })

    it('handles user with empty roles array', async () => {
      mockUserLookup([])
      mockQueryChain([])

      await taskService.getMyTasks('user-1')

      expect(TaskInstanceModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            { candidateRoles: { $in: [] } },
          ]),
        }),
      )
    })

    it('handles user not found (null)', async () => {
      vi.mocked(UserModel.findById).mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue(null),
        }),
      } as never)
      mockQueryChain([])

      await taskService.getMyTasks('user-1')

      // Should still construct valid query with empty roles
      expect(TaskInstanceModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            { candidateRoles: { $in: [] } },
          ]),
        }),
      )
    })

    it('applies pagination correctly', async () => {
      mockUserLookup(['role-admin'])
      mockQueryChain([], 42)

      const result = await taskService.getMyTasks('user-1', 3, 10)

      expect(result.page).toBe(3)
      expect(result.pageSize).toBe(10)
      expect(result.total).toBe(42)
      expect(result.totalPages).toBe(5)
    })

    it('returns items from the query result', async () => {
      const items = [
        { _id: 't1', nodeId: 'n1', status: 'pending' },
        { _id: 't2', nodeId: 'n2', status: 'claimed' },
      ]
      mockUserLookup(['role-admin'])
      mockQueryChain(items, 2)

      const result = await taskService.getMyTasks('user-1')

      expect(result.items).toEqual(items)
      expect(result.total).toBe(2)
    })

    it('defaults to page 1 and pageSize 20', async () => {
      mockUserLookup([])
      mockQueryChain([])

      const result = await taskService.getMyTasks('user-1')

      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
    })
  })

  // ─────────────────────────────────────
  // 2. claimTask role-based authorization
  // ─────────────────────────────────────

  describe('claimTask', () => {
    it('allows claim when user has a matching role', async () => {
      const task = mockTask({
        candidateUsers: [],
        candidateRoles: ['role-approver'],
      })
      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(task as never)
      mockUserLookup(['role-approver', 'role-viewer'])
      vi.mocked(ApprovalLogModel.create).mockResolvedValue({} as never)

      const result = await taskService.claimTask('task-1', 'user-1')

      expect(result.status).toBe('claimed')
      expect(result.assignee).toBe('user-1')
    })

    it('rejects claim when user has no matching role', async () => {
      const task = mockTask({
        candidateUsers: [],
        candidateRoles: ['role-manager'],
      })
      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(task as never)
      mockUserLookup(['role-viewer'])

      await expect(taskService.claimTask('task-1', 'user-1')).rejects.toThrow(
        'not authorized',
      )
    })

    it('allows claim when user is in candidateUsers (no role check needed)', async () => {
      const task = mockTask({
        candidateUsers: ['user-1'],
        candidateRoles: ['role-manager'],
      })
      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(task as never)
      vi.mocked(ApprovalLogModel.create).mockResolvedValue({} as never)

      const result = await taskService.claimTask('task-1', 'user-1')

      expect(result.status).toBe('claimed')
      // Should not need to look up user roles
      expect(UserModel.findById).not.toHaveBeenCalled()
    })

    it('allows claim when no candidates are specified', async () => {
      const task = mockTask({
        candidateUsers: [],
        candidateRoles: [],
      })
      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(task as never)
      vi.mocked(ApprovalLogModel.create).mockResolvedValue({} as never)

      const result = await taskService.claimTask('task-1', 'user-1')

      expect(result.status).toBe('claimed')
    })

    it('allows claim when user has one of multiple required roles', async () => {
      const task = mockTask({
        candidateUsers: [],
        candidateRoles: ['role-manager', 'role-director'],
      })
      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(task as never)
      mockUserLookup(['role-viewer', 'role-director'])
      vi.mocked(ApprovalLogModel.create).mockResolvedValue({} as never)

      const result = await taskService.claimTask('task-1', 'user-1')

      expect(result.status).toBe('claimed')
    })

    it('rejects claim on non-pending task', async () => {
      const task = mockTask({ status: 'completed' })
      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(task as never)

      await expect(taskService.claimTask('task-1', 'user-1')).rejects.toThrow(
        'not pending',
      )
    })

    it('throws when task not found', async () => {
      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(null)

      await expect(taskService.claimTask('nonexistent', 'user-1')).rejects.toThrow(
        'Task not found',
      )
    })

    it('creates approval log on successful claim', async () => {
      const task = mockTask({
        candidateUsers: ['user-1'],
        candidateRoles: [],
      })
      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(task as never)
      vi.mocked(ApprovalLogModel.create).mockResolvedValue({} as never)

      await taskService.claimTask('task-1', 'user-1')

      expect(ApprovalLogModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'claim',
          operator: 'user-1',
          instanceId: 'inst-1',
          nodeId: 'node-1',
        }),
      )
    })

    it('checks role intersection when only candidateRoles is set (candidateUsers empty)', async () => {
      const task = mockTask({
        candidateUsers: [],
        candidateRoles: ['role-a', 'role-b'],
      })
      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(task as never)
      mockUserLookup(['role-c', 'role-d'])

      await expect(taskService.claimTask('task-1', 'user-1')).rejects.toThrow(
        'not authorized',
      )

      // Verify user roles were fetched
      expect(UserModel.findById).toHaveBeenCalledWith('user-1')
    })

    it('skips role lookup when user matches candidateUsers first', async () => {
      const task = mockTask({
        candidateUsers: ['user-1'],
        candidateRoles: ['role-approver'],
      })
      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(task as never)
      vi.mocked(ApprovalLogModel.create).mockResolvedValue({} as never)

      await taskService.claimTask('task-1', 'user-1')

      // Fast path: candidateUsers match -> no role lookup
      expect(UserModel.findById).not.toHaveBeenCalled()
    })
  })

  // ─────────────────────────────────────
  // 3. delegateTask
  // ─────────────────────────────────────

  describe('delegateTask', () => {
    it('delegates task to target user', async () => {
      const task = mockTask({
        assignee: 'user-1',
        status: 'claimed',
      })
      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(task as never)
      vi.mocked(ApprovalLogModel.create).mockResolvedValue({} as never)

      const result = await taskService.delegateTask('task-1', 'user-2')

      expect(result.status).toBe('delegated')
      expect(result.assignee).toBe('user-2')
    })

    it('throws when task is completed', async () => {
      const task = mockTask({ status: 'completed' })
      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(task as never)

      await expect(taskService.delegateTask('task-1', 'user-2')).rejects.toThrow(
        'cannot be delegated',
      )
    })
  })

  // ─────────────────────────────────────
  // 4. getTasksForInstance
  // ─────────────────────────────────────

  describe('getTasksForInstance', () => {
    it('returns tasks sorted by creation date', async () => {
      const mockSort = vi.fn().mockResolvedValue([
        { _id: 't1', nodeId: 'n1' },
        { _id: 't2', nodeId: 'n2' },
      ])
      vi.mocked(TaskInstanceModel.find).mockReturnValue({ sort: mockSort } as never)

      const result = await taskService.getTasksForInstance('inst-1')

      expect(TaskInstanceModel.find).toHaveBeenCalledWith({ instanceId: 'inst-1' })
      expect(mockSort).toHaveBeenCalledWith({ createdAt: 1 })
      expect(result).toHaveLength(2)
    })
  })
})
