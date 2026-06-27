/**
 * FlowEngine - Notification integration tests
 *
 * Verifies that notifications are triggered at the correct lifecycle points:
 * 1. Task assigned → createTaskAssignedNotification
 * 2. Task rejected → createTaskRejectedNotification
 * 3. Flow completed → createFlowCompletedNotification
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all models before importing FlowEngine
vi.mock('../../flow-models/FlowInstance.js', () => ({
  FlowInstanceModel: {
    findById: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    find: vi.fn(),
  },
}))

vi.mock('../../flow-models/FlowVersion.js', () => ({
  FlowVersionModel: {
    findById: vi.fn(),
    findOne: vi.fn(),
  },
}))

vi.mock('../../flow-models/FlowDefinition.js', () => ({
  FlowDefinitionModel: {
    findById: vi.fn(),
  },
}))

vi.mock('../../flow-models/TaskInstance.js', () => ({
  TaskInstanceModel: {
    findOne: vi.fn(),
    find: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    findById: vi.fn(),
  },
}))

vi.mock('../../flow-models/TimerJob.js', () => ({
  TimerJobModel: {
    findOne: vi.fn(),
    find: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('../../flow-models/ApprovalLog.js', () => ({
  ApprovalLogModel: {
    create: vi.fn(),
  },
}))

vi.mock('../MessageQueue.js', () => ({
  messageQueue: {
    send: vi.fn(),
    tryConsume: vi.fn(),
    subscribe: vi.fn(),
  },
}))

vi.mock('../NotificationService.js', () => ({
  notificationService: {
    createTaskAssignedNotification: vi.fn().mockResolvedValue({}),
    createTaskRejectedNotification: vi.fn().mockResolvedValue({}),
    createFlowCompletedNotification: vi.fn().mockResolvedValue({}),
    sendNotification: vi.fn().mockResolvedValue({}),
  },
}))

vi.mock('@schema-form/flow-shared', async () => {
  const actual = await vi.importActual<typeof import('@schema-form/flow-shared')>('@schema-form/flow-shared')
  return {
    ...actual,
    parseBpmnGraph: vi.fn(),
    evaluateScript: vi.fn(),
  }
})

import { FlowEngine } from '../FlowEngine.js'
import { FlowInstanceModel } from '../../flow-models/FlowInstance.js'
import { FlowVersionModel } from '../../flow-models/FlowVersion.js'
import { FlowDefinitionModel } from '../../flow-models/FlowDefinition.js'
import { TaskInstanceModel } from '../../flow-models/TaskInstance.js'
import { notificationService } from '../NotificationService.js'
import { parseBpmnGraph, BpmnElementType } from '@schema-form/flow-shared'

function mockInstance(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'inst-1',
    definitionId: 'def-1',
    versionId: 'ver-1',
    version: '1',
    status: 'running',
    variables: {},
    tokens: [],
    initiatedBy: 'user-initiator',
    startedAt: new Date(),
    save: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

function mockModel(nodes: Record<string, unknown> = {}, edges: { source: string; target: string }[] = []) {
  const nodeMap = new Map(Object.entries(nodes))
  const outgoing = new Map<string, { sourceNodeId: string; targetNodeId: string }[]>()
  const incoming = new Map<string, { sourceNodeId: string; targetNodeId: string }[]>()
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, [])
    outgoing.get(e.source)!.push({ sourceNodeId: e.source, targetNodeId: e.target })
    if (!incoming.has(e.target)) incoming.set(e.target, [])
    incoming.get(e.target)!.push({ sourceNodeId: e.source, targetNodeId: e.target })
  }
  return {
    startNodeId: 'start',
    getNode: (id: string) => nodeMap.get(id) ?? null,
    getOutgoing: (id: string) => outgoing.get(id) ?? [],
    getIncoming: (id: string) => incoming.get(id) ?? [],
  }
}

describe('FlowEngine - Notification integration', () => {
  let engine: FlowEngine

  beforeEach(() => {
    engine = new FlowEngine()
    vi.clearAllMocks()
  })

  // ─────────────────────────────────────
  // 1. Task assigned notification
  // ─────────────────────────────────────

  describe('task assigned notification', () => {
    it('sends notification to candidateUsers when a UserTask creates a task', async () => {
      const instance = mockInstance({
        tokens: [{ tokenId: 'tok-1', nodeId: 'ut-1', state: 'active', createdAt: new Date() }],
      })

      vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
      vi.mocked(FlowVersionModel.findById).mockResolvedValue({ graph: 'graph-data' } as never)

      vi.mocked(parseBpmnGraph).mockReturnValue(mockModel({
        'ut-1': {
          id: 'ut-1',
          bpmnType: BpmnElementType.UserTask,
          config: {
            label: '部门审批',
            assigneeType: 'user',
            candidateUsers: ['user-approver'],
            approvalMode: 'single',
          },
        },
      }, [
        { source: 'ut-1', target: 'end-1' },
      ]))

      // No existing task for this node
      vi.mocked(TaskInstanceModel.findOne).mockResolvedValue(null)
      vi.mocked(TaskInstanceModel.create).mockResolvedValue({ _id: 'task-1' } as never)

      await engine.advance('inst-1')

      expect(notificationService.createTaskAssignedNotification).toHaveBeenCalledWith(
        'ut-1',
        'user-approver',
        '部门审批',
      )
    })

    it('sends notifications to all assignees in multi-instance mode', async () => {
      const instance = mockInstance({
        variables: { approvers: ['user-a', 'user-b'] },
        tokens: [{ tokenId: 'tok-1', nodeId: 'ut-multi', state: 'active', createdAt: new Date() }],
      })

      vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
      vi.mocked(FlowVersionModel.findById).mockResolvedValue({ graph: 'graph-data' } as never)

      vi.mocked(parseBpmnGraph).mockReturnValue(mockModel({
        'ut-multi': {
          id: 'ut-multi',
          bpmnType: BpmnElementType.UserTask,
          config: {
            label: '会签审批',
            assigneeCollection: 'approvers',
            approvalMode: 'countersign',
          },
        },
      }, [
        { source: 'ut-multi', target: 'end-1' },
      ]))

      vi.mocked(TaskInstanceModel.find).mockResolvedValue([] as never)
      vi.mocked(TaskInstanceModel.create).mockResolvedValue({ _id: 'task-1' } as never)

      await engine.advance('inst-1')

      expect(notificationService.createTaskAssignedNotification).toHaveBeenCalledTimes(2)
      expect(notificationService.createTaskAssignedNotification).toHaveBeenCalledWith('ut-multi', 'user-a', '会签审批')
      expect(notificationService.createTaskAssignedNotification).toHaveBeenCalledWith('ut-multi', 'user-b', '会签审批')
    })
  })

  // ─────────────────────────────────────
  // 2. Task rejected notification
  // ─────────────────────────────────────

  describe('task rejected notification', () => {
    it('sends rejection notification to flow initiator', async () => {
      const task = {
        _id: 'task-1',
        instanceId: 'inst-1',
        nodeId: 'ut-1',
        nodeName: '部门审批',
        status: 'pending',
        candidateUsers: ['user-approver'],
        save: vi.fn().mockResolvedValue(true),
      }

      const instance = mockInstance({
        tokens: [{ tokenId: 'tok-1', nodeId: 'ut-1', state: 'waiting', createdAt: new Date() }],
      })

      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(task as never)
      vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
      vi.mocked(FlowVersionModel.findById).mockResolvedValue({ graph: 'graph-data' } as never)
      vi.mocked(parseBpmnGraph).mockReturnValue(mockModel({
        'ut-1': { id: 'ut-1', bpmnType: BpmnElementType.UserTask, config: { label: '部门审批', approvalMode: 'single' } },
      }, [
        { source: 'ut-1', target: 'end-1' },
      ]))

      await engine.completeTask('task-1', {}, 'rejected', 'user-approver')

      expect(notificationService.createTaskRejectedNotification).toHaveBeenCalledWith(
        'task-1',
        'user-initiator',
        '部门审批',
        'user-approver',
      )
    })

    it('does not send rejection notification when no initiator', async () => {
      const task = {
        _id: 'task-1',
        instanceId: 'inst-1',
        nodeId: 'ut-1',
        nodeName: '部门审批',
        status: 'pending',
        candidateUsers: ['user-approver'],
        save: vi.fn().mockResolvedValue(true),
      }

      const instance = mockInstance({
        initiatedBy: '',
        tokens: [{ tokenId: 'tok-1', nodeId: 'ut-1', state: 'waiting', createdAt: new Date() }],
      })

      vi.mocked(TaskInstanceModel.findById).mockResolvedValue(task as never)
      vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
      vi.mocked(FlowVersionModel.findById).mockResolvedValue({ graph: 'graph-data' } as never)
      vi.mocked(parseBpmnGraph).mockReturnValue(mockModel({
        'ut-1': { id: 'ut-1', bpmnType: BpmnElementType.UserTask, config: { label: '部门审批', approvalMode: 'single' } },
      }, [
        { source: 'ut-1', target: 'end-1' },
      ]))

      await engine.completeTask('task-1', {}, 'rejected', 'user-approver')

      expect(notificationService.createTaskRejectedNotification).not.toHaveBeenCalled()
    })
  })

  // ─────────────────────────────────────
  // 3. Flow completed notification
  // ─────────────────────────────────────

  describe('flow completed notification', () => {
    it('sends flow completed notification when all tokens are done', async () => {
      const instance = mockInstance({
        tokens: [{ tokenId: 'tok-1', nodeId: 'end-1', state: 'active', createdAt: new Date() }],
      })

      vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
      vi.mocked(FlowVersionModel.findById).mockResolvedValue({ graph: 'graph-data' } as never)
      vi.mocked(parseBpmnGraph).mockReturnValue(mockModel({
        'end-1': { id: 'end-1', bpmnType: BpmnElementType.EndEvent, config: {} },
      }))
      vi.mocked(FlowDefinitionModel.findById).mockResolvedValue({ name: '请假流程' } as never)

      await engine.advance('inst-1')

      expect(notificationService.createFlowCompletedNotification).toHaveBeenCalledWith(
        'inst-1',
        'user-initiator',
        '请假流程',
      )
    })

    it('does not send notification when flow is still running', async () => {
      const instance = mockInstance({
        tokens: [{ tokenId: 'tok-1', nodeId: 'ut-1', state: 'active', createdAt: new Date() }],
      })

      vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
      vi.mocked(FlowVersionModel.findById).mockResolvedValue({ graph: 'graph-data' } as never)
      vi.mocked(parseBpmnGraph).mockReturnValue(mockModel({
        'ut-1': {
          id: 'ut-1',
          bpmnType: BpmnElementType.UserTask,
          config: { label: '审批', assigneeType: 'user', candidateUsers: ['user-1'], approvalMode: 'single' },
        },
      }))
      vi.mocked(TaskInstanceModel.findOne).mockResolvedValue(null)
      vi.mocked(TaskInstanceModel.create).mockResolvedValue({ _id: 'task-1' } as never)

      await engine.advance('inst-1')

      // Flow not completed — should not send
      expect(notificationService.createFlowCompletedNotification).not.toHaveBeenCalled()
    })
  })

  // ─────────────────────────────────────
  // 4. Error isolation
  // ─────────────────────────────────────

  describe('error isolation', () => {
    it('does not throw when notification service fails', async () => {
      vi.mocked(notificationService.createTaskAssignedNotification).mockRejectedValue(
        new Error('DB connection lost'),
      )

      const instance = mockInstance({
        tokens: [{ tokenId: 'tok-1', nodeId: 'ut-1', state: 'active', createdAt: new Date() }],
      })

      vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
      vi.mocked(FlowVersionModel.findById).mockResolvedValue({ graph: 'graph-data' } as never)
      vi.mocked(parseBpmnGraph).mockReturnValue(mockModel({
        'ut-1': {
          id: 'ut-1',
          bpmnType: BpmnElementType.UserTask,
          config: { label: '审批', assigneeType: 'user', candidateUsers: ['user-1'], approvalMode: 'single' },
        },
      }, [
        { source: 'ut-1', target: 'end-1' },
      ]))

      vi.mocked(TaskInstanceModel.findOne).mockResolvedValue(null)
      vi.mocked(TaskInstanceModel.create).mockResolvedValue({ _id: 'task-1' } as never)

      // Should not throw despite notification failure
      await expect(engine.advance('inst-1')).resolves.not.toThrow()
    })
  })
})
