/**
 * TaskService 角色匹配测试
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskService } from '../flow-services/TaskService.js'

// Mock models
vi.mock('../flow-models/TaskInstance.js', () => ({
  TaskInstanceModel: {
    find: vi.fn(),
    findById: vi.fn(),
    countDocuments: vi.fn(),
  },
}))

vi.mock('../flow-models/ApprovalLog.js', () => ({
  ApprovalLogModel: {
    create: vi.fn(),
  },
}))

vi.mock('../models/User.js', () => ({
  UserModel: {
    findById: vi.fn(),
  },
}))

import { TaskInstanceModel } from '../flow-models/TaskInstance.js'
import { ApprovalLogModel } from '../flow-models/ApprovalLog.js'
import { UserModel } from '../models/User.js'

describe('TaskService - Role Matching', () => {
  let taskService: TaskService

  beforeEach(() => {
    taskService = new TaskService()
    vi.clearAllMocks()
  })

  describe('getMyTasks', () => {
    it('should include role-based matching in query', async () => {
      const userId = 'user-1'
      const userRoles = ['role-admin', 'role-approver']

      // Mock user lookup
      vi.mocked(UserModel.findById).mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ roles: userRoles }),
        }),
      } as any)

      // Mock query chain
      const mockSort = vi.fn().mockResolvedValue([])
      const mockLimit = vi.fn().mockReturnValue({ sort: mockSort })
      const mockSkip = vi.fn().mockReturnValue({ limit: mockLimit })
      vi.mocked(TaskInstanceModel.find).mockReturnValue({ skip: mockSkip } as any)
      vi.mocked(TaskInstanceModel.countDocuments).mockResolvedValue(0)

      await taskService.getMyTasks(userId)

      // Verify query includes role matching
      expect(TaskInstanceModel.find).toHaveBeenCalledWith({
        status: { $in: ['pending', 'claimed'] },
        $or: [
          { assignee: userId },
          { candidateUsers: userId },
          { candidateRoles: { $in: userRoles } },
        ],
      })
    })

    it('should handle user with no roles', async () => {
      const userId = 'user-1'

      // Mock user with no roles
      vi.mocked(UserModel.findById).mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ roles: [] }),
        }),
      } as any)

      const mockSort = vi.fn().mockResolvedValue([])
      const mockLimit = vi.fn().mockReturnValue({ sort: mockSort })
      const mockSkip = vi.fn().mockReturnValue({ limit: mockLimit })
      vi.mocked(TaskInstanceModel.find).mockReturnValue({ skip: mockSkip } as any)
      vi.mocked(TaskInstanceModel.countDocuments).mockResolvedValue(0)

      await taskService.getMyTasks(userId)

      expect(TaskInstanceModel.find).toHaveBeenCalledWith({
        status: { $in: ['pending', 'claimed'] },
        $or: [
          { assignee: userId },
          { candidateUsers: userId },
          { candidateRoles: { $in: [] } },
        ],
      })
    })
  })

  describe('claimTask', () => {
    it('should allow claim when user has matching role', async () => {
      const taskId = 'task-1'
      const userId = 'user-1'
      const userRoles = ['role-approver']

      const mockTask = {
        _id: taskId,
        status: 'pending',
        candidateUsers: [],
        candidateRoles: ['role-approver'],
        instanceId: 'inst-1',
        nodeId: 'node-1',
        nodeName: '审批节点',
        save: vi.fn().mockResolvedValue(true),
      }

      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(mockTask as any)
      vi.mocked(UserModel.findById).mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ roles: userRoles }),
        }),
      } as any)
      vi.mocked(ApprovalLogModel.create).mockResolvedValue({} as any)

      const result = await taskService.claimTask(taskId, userId)

      expect(result.status).toBe('claimed')
      expect(result.assignee).toBe(userId)
      expect(mockTask.save).toHaveBeenCalled()
    })

    it('should reject claim when user has no matching role', async () => {
      const taskId = 'task-1'
      const userId = 'user-1'
      const userRoles = ['role-viewer']

      const mockTask = {
        _id: taskId,
        status: 'pending',
        candidateUsers: [],
        candidateRoles: ['role-approver'],
      }

      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(mockTask as any)
      vi.mocked(UserModel.findById).mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ roles: userRoles }),
        }),
      } as any)

      await expect(taskService.claimTask(taskId, userId)).rejects.toThrow(
        'You are not authorized to claim this task'
      )
    })

    it('should allow claim when user is in candidateUsers', async () => {
      const taskId = 'task-1'
      const userId = 'user-1'

      const mockTask = {
        _id: taskId,
        status: 'pending',
        candidateUsers: ['user-1'],
        candidateRoles: ['role-approver'],
        instanceId: 'inst-1',
        nodeId: 'node-1',
        nodeName: '审批节点',
        save: vi.fn().mockResolvedValue(true),
      }

      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(mockTask as any)
      vi.mocked(ApprovalLogModel.create).mockResolvedValue({} as any)

      const result = await taskService.claimTask(taskId, userId)

      expect(result.status).toBe('claimed')
    })

    it('should allow claim when no candidates specified', async () => {
      const taskId = 'task-1'
      const userId = 'user-1'

      const mockTask = {
        _id: taskId,
        status: 'pending',
        candidateUsers: [],
        candidateRoles: [],
        instanceId: 'inst-1',
        nodeId: 'node-1',
        nodeName: '审批节点',
        save: vi.fn().mockResolvedValue(true),
      }

      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(mockTask as any)
      vi.mocked(ApprovalLogModel.create).mockResolvedValue({} as any)

      const result = await taskService.claimTask(taskId, userId)

      expect(result.status).toBe('claimed')
    })

    it('should allow claim when user has one of multiple matching roles', async () => {
      const taskId = 'task-1'
      const userId = 'user-1'
      const userRoles = ['role-viewer', 'role-approver']

      const mockTask = {
        _id: taskId,
        status: 'pending',
        candidateUsers: [],
        candidateRoles: ['role-approver', 'role-manager'],
        instanceId: 'inst-1',
        nodeId: 'node-1',
        nodeName: '审批节点',
        save: vi.fn().mockResolvedValue(true),
      }

      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(mockTask as any)
      vi.mocked(UserModel.findById).mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ roles: userRoles }),
        }),
      } as any)
      vi.mocked(ApprovalLogModel.create).mockResolvedValue({} as any)

      const result = await taskService.claimTask(taskId, userId)

      expect(result.status).toBe('claimed')
    })
  })
})
