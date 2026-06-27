/**
 * NotificationService - notification trigger methods tests
 *
 * Tests the three new convenience methods:
 * 1. createTaskAssignedNotification
 * 2. createTaskRejectedNotification
 * 3. createFlowCompletedNotification
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotificationService } from '../NotificationService.js'

// Mock models and dependencies
vi.mock('../../flow-models/Notification.js', () => ({
  NotificationModel: {
    create: vi.fn(),
    insertMany: vi.fn(),
    find: vi.fn(),
    countDocuments: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('../../socket.js', () => ({
  getIO: vi.fn().mockReturnValue(null),
}))

import { NotificationModel } from '../../flow-models/Notification.js'

function mockCreate(doc: Record<string, unknown>) {
  vi.mocked(NotificationModel.create).mockResolvedValue({
    toObject: () => doc,
    ...doc,
  } as never)
}

describe('NotificationService - trigger methods', () => {
  let service: NotificationService

  beforeEach(() => {
    service = new NotificationService()
    vi.clearAllMocks()
  })

  // ─────────────────────────────────────
  // 1. createTaskAssignedNotification
  // ─────────────────────────────────────

  describe('createTaskAssignedNotification', () => {
    it('creates a task_created notification for the assigned user', async () => {
      mockCreate({ _id: 'notif-1', type: 'task_created', userId: 'user-1' })

      await service.createTaskAssignedNotification('task-1', 'user-1', '审批任务')

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'task_created',
          title: '新任务: 审批任务',
          content: expect.stringContaining('审批任务'),
          relatedId: 'task-1',
          relatedType: 'task',
        }),
      )
    })

    it('uses default task name when not provided', async () => {
      mockCreate({ _id: 'notif-1', type: 'task_created', userId: 'user-1' })

      await service.createTaskAssignedNotification('task-1', 'user-1')

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '新任务: 待办任务',
        }),
      )
    })
  })

  // ─────────────────────────────────────
  // 2. createTaskRejectedNotification
  // ─────────────────────────────────────

  describe('createTaskRejectedNotification', () => {
    it('creates a task_rejected notification for the submitter', async () => {
      mockCreate({ _id: 'notif-2', type: 'task_rejected', userId: 'user-2' })

      await service.createTaskRejectedNotification('task-1', 'user-2', '报销审批', 'approver-1')

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-2',
          type: 'task_rejected',
          title: '任务已驳回: 报销审批',
          content: expect.stringContaining('approver-1'),
          relatedId: 'task-1',
          relatedType: 'task',
        }),
      )
    })

    it('uses default values when optional params omitted', async () => {
      mockCreate({ _id: 'notif-2', type: 'task_rejected', userId: 'user-2' })

      await service.createTaskRejectedNotification('task-1', 'user-2')

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '任务已驳回: 待办任务',
          content: expect.stringContaining('审批人'),
        }),
      )
    })
  })

  // ─────────────────────────────────────
  // 3. createFlowCompletedNotification
  // ─────────────────────────────────────

  describe('createFlowCompletedNotification', () => {
    it('creates a flow_completed notification for the initiator', async () => {
      mockCreate({ _id: 'notif-3', type: 'flow_completed', userId: 'user-3' })

      await service.createFlowCompletedNotification('inst-1', 'user-3', '请假流程')

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-3',
          type: 'flow_completed',
          title: '流程已完成: 请假流程',
          content: expect.stringContaining('请假流程'),
          relatedId: 'inst-1',
          relatedType: 'task',
        }),
      )
    })

    it('uses default flow name when not provided', async () => {
      mockCreate({ _id: 'notif-3', type: 'flow_completed', userId: 'user-3' })

      await service.createFlowCompletedNotification('inst-1', 'user-3')

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '流程已完成: 流程',
          content: expect.stringContaining('流程'),
        }),
      )
    })
  })
})
