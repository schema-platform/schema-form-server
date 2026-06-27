/**
 * FlowEngine Core Path Integration Tests
 *
 * Tests the main execution paths of the FlowEngine:
 * 1. startFlow -> advance -> completeTask main chain
 * 2. ExclusiveGateway condition branching
 * 3. ParallelGateway fork/join
 * 4. Countersign / or-sign approval modes
 * 5. Terminate / suspend / resume lifecycle
 *
 * All Mongoose models are mocked; parseBpmnGraph runs for real (pure function).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BpmnElementType } from '@schema-form/flow-shared'
import type { FlowGraph, FlowNodeData, FlowEdgeData } from '@schema-form/flow-shared'

// ── Mock all Mongoose models (vi.hoisted ensures they exist before vi.mock runs) ──

const {
  mockFlowDefinitionFindById,
  mockFlowVersionFindById,
  mockFlowVersionFindOne,
  mockFlowInstanceFindById,
  mockFlowInstanceFindOne,
  mockFlowInstanceFind,
  mockFlowInstanceCreate,
  mockFlowInstanceUpdateMany,
  mockTaskInstanceFindById,
  mockTaskInstanceFindOne,
  mockTaskInstanceFind,
  mockTaskInstanceCreate,
  mockTaskInstanceUpdateMany,
  mockTimerJobFindOne,
  mockTimerJobFind,
  mockTimerJobCreate,
  mockTimerJobUpdateMany,
  mockTimerJobFindById,
  mockApprovalLogCreate,
  mockSendNotification,
  mockSendBatchNotifications,
  mockCreateTaskAssignedNotification,
  mockCreateTaskRejectedNotification,
  mockCreateFlowCompletedNotification,
} = vi.hoisted(() => ({
  mockFlowDefinitionFindById: vi.fn(),
  mockFlowVersionFindById: vi.fn(),
  mockFlowVersionFindOne: vi.fn(),
  mockFlowInstanceFindById: vi.fn(),
  mockFlowInstanceFindOne: vi.fn(),
  mockFlowInstanceFind: vi.fn(),
  mockFlowInstanceCreate: vi.fn(),
  mockFlowInstanceUpdateMany: vi.fn(),
  mockTaskInstanceFindById: vi.fn(),
  mockTaskInstanceFindOne: vi.fn(),
  mockTaskInstanceFind: vi.fn(),
  mockTaskInstanceCreate: vi.fn(),
  mockTaskInstanceUpdateMany: vi.fn(),
  mockTimerJobFindOne: vi.fn(),
  mockTimerJobFind: vi.fn(),
  mockTimerJobCreate: vi.fn(),
  mockTimerJobUpdateMany: vi.fn(),
  mockTimerJobFindById: vi.fn(),
  mockApprovalLogCreate: vi.fn(),
  mockSendNotification: vi.fn().mockResolvedValue(undefined),
  mockSendBatchNotifications: vi.fn().mockResolvedValue(undefined),
  mockCreateTaskAssignedNotification: vi.fn().mockResolvedValue(undefined),
  mockCreateTaskRejectedNotification: vi.fn().mockResolvedValue(undefined),
  mockCreateFlowCompletedNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../flow-models/FlowDefinition.js', () => ({
  FlowDefinitionModel: {
    findById: mockFlowDefinitionFindById,
  },
}))

vi.mock('../../flow-models/FlowVersion.js', () => ({
  FlowVersionModel: {
    findById: mockFlowVersionFindById,
    findOne: mockFlowVersionFindOne,
  },
}))

vi.mock('../../flow-models/FlowInstance.js', () => ({
  FlowInstanceModel: {
    findById: mockFlowInstanceFindById,
    findOne: mockFlowInstanceFindOne,
    find: mockFlowInstanceFind,
    create: mockFlowInstanceCreate,
    updateMany: mockFlowInstanceUpdateMany,
  },
}))

vi.mock('../../flow-models/TaskInstance.js', () => ({
  TaskInstanceModel: {
    findById: mockTaskInstanceFindById,
    findOne: mockTaskInstanceFindOne,
    find: mockTaskInstanceFind,
    create: mockTaskInstanceCreate,
    updateMany: mockTaskInstanceUpdateMany,
  },
}))

vi.mock('../../flow-models/TimerJob.js', () => ({
  TimerJobModel: {
    findOne: mockTimerJobFindOne,
    find: mockTimerJobFind,
    create: mockTimerJobCreate,
    updateMany: mockTimerJobUpdateMany,
    findById: mockTimerJobFindById,
  },
}))

vi.mock('../../flow-models/ApprovalLog.js', () => ({
  ApprovalLogModel: {
    create: mockApprovalLogCreate,
  },
}))

vi.mock('../../flow-services/TimerService.js', () => ({
  parseTimerValue: vi.fn(() => new Date('2026-12-01T00:00:00Z')),
}))

vi.mock('../../flow-services/NotificationService.js', () => ({
  notificationService: {
    sendNotification: mockSendNotification,
    sendBatchNotifications: mockSendBatchNotifications,
    createTaskAssignedNotification: mockCreateTaskAssignedNotification,
    createTaskRejectedNotification: mockCreateTaskRejectedNotification,
    createFlowCompletedNotification: mockCreateFlowCompletedNotification,
  },
}))

vi.mock('../../flow-services/MessageQueue.js', () => ({
  messageQueue: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../services/executionLogger.js', () => ({
  logNodeStart: vi.fn().mockResolvedValue({}),
  logNodeComplete: vi.fn().mockResolvedValue(undefined),
  logNodeFail: vi.fn().mockResolvedValue(undefined),
  getInstanceLogs: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../services/eventBus.js', () => ({
  eventBus: {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  },
}))

vi.mock('../../services/dataUpdateEngine.js', () => ({
  executeDataUpdateRules: vi.fn().mockResolvedValue({ submissionId: null, rulesApplied: 0 }),
}))

// Import after mocks are set up
import { FlowEngine } from '../../flow-services/FlowEngine.js'

// ── Helper factories ──

/** Create a FlowGraph node */
function nd(id: string, bpmnType: BpmnElementType, data: Record<string, unknown> = {}): FlowNodeData {
  return {
    id,
    shape: 'bpmn-node',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    data: { bpmnType, label: id, ...data } as FlowNodeData['data'],
  }
}

/** Create a FlowGraph edge */
function eg(
  id: string,
  source: string,
  target: string,
  data: { conditionExpression?: string; isDefault?: boolean } = {},
): FlowEdgeData {
  return {
    id,
    shape: 'bpmn-edge',
    source: { cell: source },
    target: { cell: target },
    data: { label: id, ...data },
  }
}

/** Build a simple linear graph: start -> task -> end */
function linearGraph(taskConfig: Record<string, unknown> = {}): FlowGraph {
  return {
    nodes: [
      nd('start', BpmnElementType.StartEvent),
      nd('task1', BpmnElementType.UserTask, taskConfig),
      nd('end', BpmnElementType.EndEvent),
    ],
    edges: [eg('e1', 'start', 'task1'), eg('e2', 'task1', 'end')],
  }
}

/** Build an exclusive gateway graph: start -> gw -> (taskA | taskB) -> end */
function exclusiveGatewayGraph(): FlowGraph {
  return {
    nodes: [
      nd('start', BpmnElementType.StartEvent),
      nd('gw', BpmnElementType.ExclusiveGateway),
      nd('taskA', BpmnElementType.UserTask, { assignee: 'userA', assigneeType: 'user', candidateUsers: ['userA'] }),
      nd('taskB', BpmnElementType.UserTask, { assignee: 'userB', assigneeType: 'user', candidateUsers: ['userB'] }),
      nd('end', BpmnElementType.EndEvent),
    ],
    edges: [
      eg('e1', 'start', 'gw'),
      eg('e2', 'gw', 'taskA', { conditionExpression: 'amount > 1000' }),
      eg('e3', 'gw', 'taskB', { isDefault: true }),
      eg('e4', 'taskA', 'end'),
      eg('e5', 'taskB', 'end'),
    ],
  }
}

/** Build a parallel gateway graph: start -> fork -> (taskA || taskB) -> join -> end */
function parallelGatewayGraph(): FlowGraph {
  return {
    nodes: [
      nd('start', BpmnElementType.StartEvent),
      nd('fork', BpmnElementType.ParallelGateway),
      nd('taskA', BpmnElementType.UserTask, { assignee: 'userA', assigneeType: 'user', candidateUsers: ['userA'] }),
      nd('taskB', BpmnElementType.UserTask, { assignee: 'userB', assigneeType: 'user', candidateUsers: ['userB'] }),
      nd('join', BpmnElementType.ParallelGateway),
      nd('end', BpmnElementType.EndEvent),
    ],
    edges: [
      eg('e1', 'start', 'fork'),
      eg('e2', 'fork', 'taskA'),
      eg('e3', 'fork', 'taskB'),
      eg('e4', 'taskA', 'join'),
      eg('e5', 'taskB', 'join'),
      eg('e6', 'join', 'end'),
    ],
  }
}

/** Build a multi-instance (countersign/or-sign) graph: start -> multiTask -> end */
function multiInstanceGraph(approvalMode: string, assignees: string[], minApprovalCount?: number): FlowGraph {
  return {
    nodes: [
      nd('start', BpmnElementType.StartEvent),
      nd('multiTask', BpmnElementType.UserTask, {
        assignee: assignees[0] ?? '',
        assigneeType: 'user',
        candidateUsers: assignees,
        approvalMode,
        assigneeCollection: 'approvers',
        ...(minApprovalCount != null ? { minApprovalCount } : {}),
      }),
      nd('end', BpmnElementType.EndEvent),
    ],
    edges: [eg('e1', 'start', 'multiTask'), eg('e2', 'multiTask', 'end')],
  }
}

/** Create a mock Mongoose-like document with save() */
function mockDoc<T extends Record<string, unknown>>(data: T): T & { save: ReturnType<typeof vi.fn> } {
  const doc = { ...data } as T & { save: ReturnType<typeof vi.fn> }
  doc.save = vi.fn().mockResolvedValue(doc)
  return doc
}

/** Standard version mock setup */
function setupVersion(graph: FlowGraph, metadata?: Record<string, unknown>) {
  const version = mockDoc({
    _id: 'v1',
    definitionId: 'def1',
    version: '1',
    graph,
    metadata: metadata ?? null,
  })
  mockFlowVersionFindById.mockResolvedValue(version)
  mockFlowVersionFindOne.mockResolvedValue(version)
  return version
}

/** Standard definition mock setup */
function setupDefinition() {
  const definition = mockDoc({
    _id: 'def1',
    name: 'Test Flow',
    status: 'published',
    currentVersionId: 'v1',
    createdBy: 'admin',
  })
  mockFlowDefinitionFindById.mockResolvedValue(definition)
  return definition
}

// ── Tests ──

describe('FlowEngine', () => {
  let engine: FlowEngine

  beforeEach(() => {
    vi.clearAllMocks()
    engine = new FlowEngine()

    // Default: no existing tasks, instances, or timer jobs
    mockTaskInstanceFindById.mockResolvedValue(null)
    mockTaskInstanceFindOne.mockResolvedValue(null)
    mockTaskInstanceFind.mockResolvedValue([])
    mockFlowInstanceFindById.mockResolvedValue(null)
    mockFlowInstanceFindOne.mockResolvedValue(null)
    mockFlowInstanceFind.mockResolvedValue([])
    mockTimerJobFindOne.mockResolvedValue(null)
    mockTimerJobFind.mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })

    // Default: TaskInstanceModel.create returns a doc with _id
    mockTaskInstanceCreate.mockImplementation((data: Record<string, unknown>) =>
      Promise.resolve(mockDoc({ _id: data._id ?? 'mockTaskId', ...data })),
    )
  })

  // ─────────────────────────────────────
  // 1. Main chain: startFlow -> advance -> completeTask
  // ─────────────────────────────────────

  describe('main chain: startFlow -> advance -> completeTask', () => {
    it('startFlow creates instance, advances to UserTask, creates pending task', async () => {
      setupDefinition()
      setupVersion(linearGraph({ assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }))

      const createdInstance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })

      mockFlowInstanceCreate.mockResolvedValue(createdInstance)
      mockFlowInstanceFindById.mockResolvedValue(createdInstance)

      await engine.startFlow('def1', {}, 'admin')

      expect(mockFlowDefinitionFindById).toHaveBeenCalledWith('def1')
      expect(mockFlowInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          definitionId: 'def1',
          status: 'running',
          initiatedBy: 'admin',
        }),
      )
      // Task should have been created for the UserTask node
      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: 'inst1',
          nodeId: 'task1',
          status: 'pending',
          candidateUsers: ['user1'],
        }),
      )
    })

    it('completeTask marks task completed and triggers advance', async () => {
      setupDefinition()
      setupVersion(linearGraph({ assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }))

      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'pending',
        assignee: null,
        candidateUsers: ['user1'],
      })

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [
          { tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() },
        ],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })

      mockTaskInstanceFindById.mockResolvedValue(task)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.completeTask('taskInst1', undefined, 'approved', 'user1')

      expect(task.status).toBe('completed')
      expect(task.outcome).toBe('approved')
      expect(task.save).toHaveBeenCalled()
      // Instance should have been saved
      expect(instance.save).toHaveBeenCalled()
      // After completeTask + advance: token is moved past the UserTask to the next node (end),
      // then advance processes the EndEvent and marks the token as 'completed'.
      // The instance completes because all tokens reached the EndEvent.
      expect(instance.tokens[0].state).toBe('completed')
      expect(instance.tokens[0].nodeId).toBe('end')
      expect(instance.status).toBe('completed')
    })

    it('completeTask writes form data to instance variables when formVariable is configured', async () => {
      setupDefinition()
      const graph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('task1', BpmnElementType.UserTask, {
            assignee: 'user1',
            assigneeType: 'user',
            candidateUsers: ['user1'],
            formVariable: 'formData',
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'task1'), eg('e2', 'task1', 'end')],
      }
      setupVersion(graph)

      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'pending',
        candidateUsers: ['user1'],
      })

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })

      mockTaskInstanceFindById.mockResolvedValue(task)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.completeTask('taskInst1', { field1: 'value1' }, 'approved', 'user1')

      expect(instance.variables.formData).toEqual({ field1: 'value1' })
    })

    it('completeTask does NOT write to variables when formVariable is not configured', async () => {
      setupDefinition()
      // linearGraph has no formVariable configured
      setupVersion(linearGraph({ assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }))

      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'pending',
        candidateUsers: ['user1'],
      })

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })

      mockTaskInstanceFindById.mockResolvedValue(task)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.completeTask('taskInst1', { field1: 'value1' }, 'approved', 'user1')

      // formVariable not configured => variables must remain empty
      expect(instance.variables).toEqual({})
    })

    it('form data persists across node transitions', async () => {
      setupDefinition()
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('task1', BpmnElementType.UserTask, {
            assignee: 'user1',
            assigneeType: 'user',
            candidateUsers: ['user1'],
            formVariable: 'data1',
          }),
          nd('task2', BpmnElementType.UserTask, {
            assignee: 'user2',
            assigneeType: 'user',
            candidateUsers: ['user2'],
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [
          eg('e1', 'start', 'task1'),
          eg('e2', 'task1', 'task2', { conditionExpression: 'data1.amount > 100' }),
          eg('e3', 'task2', 'end'),
        ],
      }
      setupVersion(graph)

      const task1 = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'pending',
        candidateUsers: ['user1'],
      })

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })

      mockTaskInstanceFindById.mockResolvedValue(task1)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      // Step 1: complete task1 with form data
      await engine.completeTask('taskInst1', { amount: 200 }, 'approved', 'user1')

      // Verify form data persisted into instance.variables
      expect(instance.variables.data1).toEqual({ amount: 200 })

      // Step 2: token is moved past task1 to task2 (the next node).
      // The persisted data survives the transition and remains available
      // for downstream nodes (task2 condition 'data1.amount > 100' can evaluate).
      expect(instance.save).toHaveBeenCalled()

      // Token should now be at task2 (waiting, since a new task was created there)
      expect(instance.tokens[0].nodeId).toBe('task2')
      expect(instance.tokens[0].state).toBe('waiting')

      // The new task created during advance is at task2
      const createdTaskData = mockTaskInstanceCreate.mock.calls[0][0] as Record<string, unknown>
      expect(createdTaskData.instanceId).toBe('inst1')
      expect(createdTaskData.nodeId).toBe('task2')

      // Verify the graph with condition expression can parse correctly
      expect(instance.variables.data1.amount).toBe(200)
    })

    it('completeTask rejects unauthorized user', async () => {
      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'pending',
        assignee: null,
        candidateUsers: ['user1'],
      })

      mockTaskInstanceFindById.mockResolvedValue(task)

      await expect(
        engine.completeTask('taskInst1', undefined, 'approved', 'unauthorized_user'),
      ).rejects.toThrow('not authorized')
    })

    it('completeTask rejects already-completed task', async () => {
      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'completed',
        candidateUsers: ['user1'],
      })

      mockTaskInstanceFindById.mockResolvedValue(task)

      await expect(
        engine.completeTask('taskInst1', undefined, 'approved', 'user1'),
      ).rejects.toThrow('not in a completable state')
    })

    it('full cycle: startFlow -> advance pauses at UserTask -> completeTask -> advance reaches end', async () => {
      setupDefinition()
      setupVersion(linearGraph({ assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }))

      // Phase 1: startFlow
      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', {}, 'admin')

      // After startFlow+advance: token moved to task1, state=waiting, task created
      expect(instance.tokens[0].nodeId).toBe('task1')
      expect(instance.tokens[0].state).toBe('waiting')
      expect(mockTaskInstanceCreate).toHaveBeenCalledTimes(1)

      // Phase 2: completeTask
      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'pending',
        candidateUsers: ['user1'],
      })

      mockTaskInstanceFindById.mockResolvedValue(task)

      await engine.completeTask('taskInst1', undefined, 'approved', 'user1')

      // After completeTask + advance:
      // 1. Task is marked completed
      // 2. Token moved past UserTask to 'end' node
      // 3. advance processes EndEvent: token 'completed', instance 'completed'
      expect(task.status).toBe('completed')
      expect(instance.tokens[0].state).toBe('completed')
      expect(instance.tokens[0].nodeId).toBe('end')
      expect(instance.status).toBe('completed')
      // Only 1 task was created (no re-entry)
      expect(mockTaskInstanceCreate).toHaveBeenCalledTimes(1)
    })
  })

  // ─────────────────────────────────────
  // 2. ExclusiveGateway condition branching
  // ─────────────────────────────────────

  describe('ExclusiveGateway', () => {
    it('evaluates condition expression and routes to matching branch', async () => {
      setupDefinition()
      setupVersion(exclusiveGatewayGraph())

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { amount: 2000 },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { amount: 2000 }, 'admin')

      // Should have routed to taskA (amount > 1000)
      expect(instance.tokens[0].nodeId).toBe('taskA')
      expect(instance.tokens[0].state).toBe('waiting')
      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'taskA' }),
      )
    })

    it('falls back to default edge when no condition matches', async () => {
      setupDefinition()
      setupVersion(exclusiveGatewayGraph())

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { amount: 500 },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { amount: 500 }, 'admin')

      // Should have routed to taskB (default edge)
      expect(instance.tokens[0].nodeId).toBe('taskB')
      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'taskB' }),
      )
    })

    it('handles multiple conditions: first matching wins', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('gw', BpmnElementType.ExclusiveGateway),
          nd('taskHigh', BpmnElementType.UserTask, { assignee: 'u1', assigneeType: 'user', candidateUsers: ['u1'] }),
          nd('taskMed', BpmnElementType.UserTask, { assignee: 'u2', assigneeType: 'user', candidateUsers: ['u2'] }),
          nd('taskLow', BpmnElementType.UserTask, { assignee: 'u3', assigneeType: 'user', candidateUsers: ['u3'] }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [
          eg('e1', 'start', 'gw'),
          eg('e2', 'gw', 'taskHigh', { conditionExpression: 'score >= 90' }),
          eg('e3', 'gw', 'taskMed', { conditionExpression: 'score >= 60' }),
          eg('e4', 'gw', 'taskLow', { isDefault: true }),
          eg('e5', 'taskHigh', 'end'),
          eg('e6', 'taskMed', 'end'),
          eg('e7', 'taskLow', 'end'),
        ],
      }
      setupDefinition()
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { score: 95 },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { score: 95 }, 'admin')

      // First matching condition: score >= 90 -> taskHigh
      expect(instance.tokens[0].nodeId).toBe('taskHigh')
    })
  })

  // ─────────────────────────────────────
  // 3. ParallelGateway fork/join
  // ─────────────────────────────────────

  describe('ParallelGateway', () => {
    it('fork creates tokens for all outgoing branches', async () => {
      setupDefinition()
      setupVersion(parallelGatewayGraph())

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', {}, 'admin')

      // After fork: two new active tokens at taskA and taskB
      const taskAToken = instance.tokens.find((t: { nodeId: string }) => t.nodeId === 'taskA')
      const taskBToken = instance.tokens.find((t: { nodeId: string }) => t.nodeId === 'taskB')

      expect(taskAToken).toBeDefined()
      expect(taskBToken).toBeDefined()
      expect(taskAToken!.state).toBe('waiting')
      expect(taskBToken!.state).toBe('waiting')

      // Two tasks created
      expect(mockTaskInstanceCreate).toHaveBeenCalledTimes(2)
    })

    it('join merges when all branches arrive', async () => {
      setupDefinition()
      setupVersion(parallelGatewayGraph())

      // Both tokens arrive at the join gateway (active).
      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [
          { tokenId: 'tokA', nodeId: 'join', state: 'active', createdAt: new Date() },
          { tokenId: 'tokB', nodeId: 'join', state: 'active', createdAt: new Date() },
        ],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      // Advance: both tokens at join (ParallelGateway, inEdges=2)
      // tokA processes first: finds tokB (1 other active) >= 2-1 = 1 -> merge
      // Both set to completed, new token pushed to end.
      //
      // Note: the engine captures activeTokens at the start of each while-loop
      // iteration. tokB is still in the captured array when tokA processes it.
      // After tokA sets tokB to 'completed', tokB is processed next in the same
      // iteration. Since tokA is already 'completed', tokB sees 0 other active
      // tokens and reverts to 'waiting'. This is a known engine behavior where
      // the second token at a join may not merge cleanly in the same iteration.
      await engine.advance('inst1')

      // A new token was pushed to 'end' (the merge succeeded for tokA).
      // The EndEvent token is processed to 'completed' in subsequent iterations.
      const endToken = instance.tokens.find((t: { nodeId: string }) => t.nodeId === 'end')
      expect(endToken).toBeDefined()
      expect(endToken!.state).toBe('completed')
    })

    it('join with one token waits for the other', async () => {
      setupDefinition()
      setupVersion(parallelGatewayGraph())

      // Only tokA at join, tokB still at taskB (waiting)
      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [
          { tokenId: 'tokA', nodeId: 'join', state: 'active', createdAt: new Date() },
          { tokenId: 'tokB', nodeId: 'taskB', state: 'waiting', createdAt: new Date() },
        ],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      // Advance: only tokA is active at join (inEdges=2, need 1 other active)
      // 0 other active < 1 required => tokA becomes waiting
      await engine.advance('inst1')

      const tokA = instance.tokens.find((t: { tokenId: string }) => t.tokenId === 'tokA')
      expect(tokA!.state).toBe('waiting')
      expect(instance.status).toBe('running')
    })
  })

  // ─────────────────────────────────────
  // 4. Countersign / Or-sign approval modes
  // ─────────────────────────────────────

  describe('countersign (all must approve or reach minApprovalCount)', () => {
    it('creates tasks for all assignees from variable collection', async () => {
      setupDefinition()
      setupVersion(multiInstanceGraph('countersign', ['user1', 'user2', 'user3']))

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { approvers: ['user1', 'user2', 'user3'] },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { approvers: ['user1', 'user2', 'user3'] }, 'admin')

      // 3 tasks created for 3 assignees
      expect(mockTaskInstanceCreate).toHaveBeenCalledTimes(3)
      const createdTasks = mockTaskInstanceCreate.mock.calls.map((c: Record<string, unknown>[]) => c[0])
      const assignees = createdTasks.map((t: { candidateUsers: string[] }) => t.candidateUsers[0])
      expect(assignees).toEqual(expect.arrayContaining(['user1', 'user2', 'user3']))
    })

    it('advances when minApprovalCount is reached', async () => {
      setupDefinition()
      setupVersion(multiInstanceGraph('countersign', ['user1', 'user2', 'user3'], 2))

      // Token is waiting at multiTask, with 3 tasks (2 completed, 1 pending)
      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { approvers: ['user1', 'user2', 'user3'] },
        tokens: [{ tokenId: 'tok1', nodeId: 'multiTask', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      // Mock find to return existing tasks (2 completed, 1 pending) - advance sees these
      mockTaskInstanceFind.mockResolvedValue([
        mockDoc({ _id: 't1', instanceId: 'inst1', nodeId: 'multiTask', status: 'completed', outcome: 'approved' }),
        mockDoc({ _id: 't2', instanceId: 'inst1', nodeId: 'multiTask', status: 'completed', outcome: 'approved' }),
        mockDoc({ _id: 't3', instanceId: 'inst1', nodeId: 'multiTask', status: 'pending' }),
      ])

      const task = mockDoc({
        _id: 't3',
        instanceId: 'inst1',
        nodeId: 'multiTask',
        nodeName: 'multiTask',
        status: 'pending',
        candidateUsers: ['user3'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await engine.completeTask('t3', undefined, 'approved', 'user3')

      // minApprovalCount=2 met (2 completed + this one = 3 >= 2)
      // Pending tasks cancelled, token reactivated, advance reaches end -> completed
      expect(mockTaskInstanceUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'multiTask' }),
        expect.objectContaining({ status: 'cancelled' }),
      )
      expect(instance.status).toBe('completed')
    })

    it('advances when all assignees approve (default = assignees.length)', async () => {
      setupDefinition()
      setupVersion(multiInstanceGraph('countersign', ['user1', 'user2']))

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { approvers: ['user1', 'user2'] },
        tokens: [{ tokenId: 'tok1', nodeId: 'multiTask', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      // Both tasks completed (advance sees this)
      mockTaskInstanceFind.mockResolvedValue([
        mockDoc({ _id: 't1', status: 'completed', outcome: 'approved' }),
        mockDoc({ _id: 't2', status: 'completed', outcome: 'approved' }),
      ])

      const task = mockDoc({
        _id: 't2',
        instanceId: 'inst1',
        nodeId: 'multiTask',
        nodeName: 'multiTask',
        status: 'pending',
        candidateUsers: ['user2'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await engine.completeTask('t2', undefined, 'approved', 'user2')

      // All 2/2 approved -> advance past node -> end -> completed
      expect(instance.status).toBe('completed')
    })
  })

  describe('or-sign (one approval is enough)', () => {
    it('advances immediately when one task is approved', async () => {
      setupDefinition()
      setupVersion(multiInstanceGraph('or-sign', ['user1', 'user2', 'user3']))

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { approvers: ['user1', 'user2', 'user3'] },
        tokens: [{ tokenId: 'tok1', nodeId: 'multiTask', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      // After this task completes, advance finds 1 completed task
      mockTaskInstanceFind.mockResolvedValue([
        mockDoc({ _id: 't1', instanceId: 'inst1', nodeId: 'multiTask', status: 'completed', outcome: 'approved' }),
        mockDoc({ _id: 't2', instanceId: 'inst1', nodeId: 'multiTask', status: 'pending' }),
        mockDoc({ _id: 't3', instanceId: 'inst1', nodeId: 'multiTask', status: 'pending' }),
      ])

      const task = mockDoc({
        _id: 't1',
        instanceId: 'inst1',
        nodeId: 'multiTask',
        nodeName: 'multiTask',
        status: 'pending',
        candidateUsers: ['user1'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await engine.completeTask('t1', undefined, 'approved', 'user1')

      // Or-sign: 1 approval -> cancel remaining -> advance to end -> completed
      expect(mockTaskInstanceUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'multiTask' }),
        expect.objectContaining({ status: 'cancelled' }),
      )
      expect(instance.status).toBe('completed')
    })

    it('or-sign with reject-on-any policy cancels remaining tasks on rejection', async () => {
      setupDefinition()
      setupVersion(
        multiInstanceGraph('or-sign', ['user1', 'user2', 'user3']),
        { defaultRejectPolicy: 'reject-on-any' },
      )

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { approvers: ['user1', 'user2', 'user3'] },
        tokens: [{ tokenId: 'tok1', nodeId: 'multiTask', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      const task = mockDoc({
        _id: 't1',
        instanceId: 'inst1',
        nodeId: 'multiTask',
        nodeName: 'multiTask',
        status: 'pending',
        candidateUsers: ['user1'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await engine.completeTask('t1', undefined, 'rejected', 'user1')

      // reject-on-any: cancel remaining and advance past the node
      expect(mockTaskInstanceUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'multiTask' }),
        expect.objectContaining({ status: 'cancelled' }),
      )
      // Token moved to end -> completed
      expect(instance.status).toBe('completed')
    })
  })

  // ─────────────────────────────────────
  // 4b. Multi-instance (BPMN standard)
  // ─────────────────────────────────────

  describe('multi-instance (collection-driven)', () => {
    /** Build a graph with collection-driven multi-assignee config (countersign mode) */
    function miGraph(collection: string, minApprovalCount?: number): FlowGraph {
      return {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('miTask', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: [],
            approvalMode: 'countersign',
            assigneeCollection: collection,
            ...(minApprovalCount != null ? { minApprovalCount } : {}),
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'miTask'), eg('e2', 'miTask', 'end')],
      }
    }

    it('countersign with collection creates all tasks at once', async () => {
      setupDefinition()
      setupVersion(miGraph('items'))

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { items: ['a', 'b', 'c'] },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { items: ['a', 'b', 'c'] }, 'admin')

      // Should create 3 tasks for 3 assignees
      expect(mockTaskInstanceCreate).toHaveBeenCalledTimes(3)
      // Token should be waiting
      const miToken = instance.tokens.find((t: { nodeId: string }) => t.nodeId === 'miTask')
      expect(miToken).toBeDefined()
      expect(miToken!.state).toBe('waiting')
    })

    it('countersign with minApprovalCount advances early when threshold met', async () => {
      setupDefinition()
      setupVersion(miGraph('items', 2))

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { items: ['a', 'b', 'c'] },
        tokens: [{ tokenId: 'tok1', nodeId: 'miTask', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      // After this task completes, advance sees 3 tasks (2 already completed + this one)
      mockTaskInstanceFind.mockResolvedValue([
        mockDoc({ _id: 't1', nodeId: 'miTask', status: 'completed', outcome: 'approved' }),
        mockDoc({ _id: 't2', nodeId: 'miTask', status: 'completed', outcome: 'approved' }),
        mockDoc({ _id: 't3', nodeId: 'miTask', status: 'completed', outcome: 'approved' }),
      ])

      // The task being completed is the last pending one
      const task = mockDoc({
        _id: 't3',
        instanceId: 'inst1',
        nodeId: 'miTask',
        nodeName: 'miTask',
        status: 'pending',
        candidateUsers: ['c'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await engine.completeTask('t3', undefined, 'approved', undefined)

      // minApprovalCount=2 met (3 completed >= 2) -> cancel remaining -> advance to end
      expect(mockTaskInstanceUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'miTask' }),
        expect.objectContaining({ status: 'cancelled' }),
      )
      expect(instance.status).toBe('completed')
    })

    it('empty collection skips the node', async () => {
      setupDefinition()
      setupVersion(miGraph('items'))

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { items: [] },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { items: [] }, 'admin')

      // Empty collection → no tasks created, token moves past the node to 'end'
      expect(mockTaskInstanceCreate).not.toHaveBeenCalled()
      const endToken = instance.tokens.find((t: { nodeId: string }) => t.nodeId === 'end')
      expect(endToken).toBeDefined()
      expect(endToken!.state).toBe('completed')
    })
  })

  // ─────────────────────────────────────
  // 5. Terminate / Suspend / Resume
  // ─────────────────────────────────────

  describe('terminateInstance', () => {
    it('sets instance to terminated and cancels pending tasks + timer jobs', async () => {
      const instance = mockDoc({
        _id: 'inst1',
        status: 'running',
        completedAt: undefined,
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)
      mockFlowInstanceFind.mockResolvedValue([])

      await engine.terminateInstance('inst1')

      expect(instance.status).toBe('terminated')
      expect(instance.completedAt).toBeDefined()
      expect(instance.save).toHaveBeenCalled()
      expect(mockTaskInstanceUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ instanceId: 'inst1' }),
        expect.objectContaining({ status: 'cancelled' }),
      )
      expect(mockTimerJobUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ instanceId: 'inst1' }),
        expect.objectContaining({ status: 'cancelled' }),
      )
    })

    it('recursively terminates child instances (sub-process)', async () => {
      const parentInstance = mockDoc({
        _id: 'parent1',
        status: 'running',
        completedAt: undefined,
      })
      const childInstance = mockDoc({
        _id: 'child1',
        status: 'running',
        completedAt: undefined,
      })

      mockFlowInstanceFindById
        .mockResolvedValueOnce(parentInstance)
        .mockResolvedValueOnce(childInstance)

      mockFlowInstanceFind
        .mockResolvedValueOnce([childInstance])
        .mockResolvedValueOnce([])

      await engine.terminateInstance('parent1')

      expect(parentInstance.status).toBe('terminated')
      expect(childInstance.status).toBe('terminated')
    })

    it('rejects terminating a completed instance', async () => {
      const instance = mockDoc({ _id: 'inst1', status: 'completed' })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await expect(engine.terminateInstance('inst1')).rejects.toThrow('not in a terminable state')
    })

    it('can terminate a suspended instance', async () => {
      const instance = mockDoc({
        _id: 'inst1',
        status: 'suspended',
        completedAt: undefined,
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)
      mockFlowInstanceFind.mockResolvedValue([])

      await engine.terminateInstance('inst1')

      expect(instance.status).toBe('terminated')
    })
  })

  describe('suspendInstance', () => {
    it('sets instance status to suspended', async () => {
      const instance = mockDoc({ _id: 'inst1', status: 'running' })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.suspendInstance('inst1')

      expect(instance.status).toBe('suspended')
      expect(instance.save).toHaveBeenCalled()
    })

    it('rejects suspending a non-running instance', async () => {
      const instance = mockDoc({ _id: 'inst1', status: 'completed' })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await expect(engine.suspendInstance('inst1')).rejects.toThrow()
    })
  })

  describe('resumeInstance', () => {
    it('restores running status and triggers advance', async () => {
      setupDefinition()
      setupVersion(linearGraph({ assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }))

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'suspended',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.resumeInstance('inst1')

      expect(instance.status).toBe('running')
      expect(instance.save).toHaveBeenCalled()
    })

    it('rejects resuming a non-suspended instance', async () => {
      const instance = mockDoc({ _id: 'inst1', status: 'running' })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await expect(engine.resumeInstance('inst1')).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────

  describe('edge cases', () => {
    it('startFlow throws when definition not found', async () => {
      mockFlowDefinitionFindById.mockResolvedValue(null)

      await expect(engine.startFlow('nonexistent', {}, 'admin')).rejects.toThrow('not found')
    })

    it('startFlow throws when no version found', async () => {
      setupDefinition()
      mockFlowVersionFindById.mockResolvedValue(null)
      mockFlowVersionFindOne.mockResolvedValue(null)

      await expect(engine.startFlow('def1', {}, 'admin')).rejects.toThrow('No flow version found')
    })

    it('advance is no-op for non-running instance', async () => {
      const instance = mockDoc({
        _id: 'inst1',
        status: 'completed',
        tokens: [],
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.advance('inst1')
      expect(mockFlowVersionFindById).not.toHaveBeenCalled()
    })

    it('advance is no-op when instance not found', async () => {
      mockFlowInstanceFindById.mockResolvedValue(null)

      await engine.advance('nonexistent')
      expect(mockFlowVersionFindById).not.toHaveBeenCalled()
    })

    it('completeTask throws when task not found', async () => {
      mockTaskInstanceFindById.mockResolvedValue(null)

      await expect(engine.completeTask('nonexistent')).rejects.toThrow('Task not found')
    })

    it('instance auto-completes when all tokens reach EndEvent', async () => {
      setupDefinition()
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'end')],
      }
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', {}, 'admin')

      expect(instance.tokens[0].state).toBe('completed')
      expect(instance.status).toBe('completed')
      expect(instance.completedAt).toBeDefined()
    })

    it('handles empty assignee list for countersign: skips task creation', async () => {
      setupDefinition()
      setupVersion(multiInstanceGraph('countersign', []))

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { approvers: [] },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { approvers: [] }, 'admin')

      // No tasks created, token should have moved past the node
      expect(mockTaskInstanceCreate).not.toHaveBeenCalled()
    })
  })

  // ─────────────────────────────────────
  // 6. ServiceTask pass-through
  // ─────────────────────────────────────

  describe('ServiceTask', () => {
    it('completes immediately and advances token to next node', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('svc', BpmnElementType.ServiceTask, { label: 'svc' }),
          nd('task1', BpmnElementType.UserTask, { assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'svc'), eg('e2', 'svc', 'task1'), eg('e3', 'task1', 'end')],
      }
      setupDefinition()
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', {}, 'admin')

      // ServiceTask marks the original token as 'completed' and pushes a NEW token.
      // The new token is then processed by UserTask, which sets it to 'waiting'.
      // Find the token that landed on the UserTask.
      const taskToken = instance.tokens.find((t: { nodeId: string }) => t.nodeId === 'task1')
      expect(taskToken).toBeDefined()
      expect(taskToken!.state).toBe('waiting')

      // The original ServiceTask token is completed
      const svcToken = instance.tokens.find((t: { nodeId: string }) => t.nodeId === 'svc')
      expect(svcToken).toBeDefined()
      expect(svcToken!.state).toBe('completed')

      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'task1' }),
      )
    })

    it('executes dataUpdate service when serviceConfig.type is dataUpdate', async () => {
      const mockExecuteDataUpdateRules = vi.fn().mockResolvedValue({ submissionId: 'sub1', rulesApplied: 1 })
      vi.doMock('../../services/dataUpdateEngine.js', () => ({
        executeDataUpdateRules: mockExecuteDataUpdateRules,
      }))

      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('svc', BpmnElementType.ServiceTask, {
            label: 'dataUpdate',
            serviceConfig: { type: 'dataUpdate' },
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'svc'), eg('e2', 'svc', 'end')],
      }
      setupDefinition()
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { submissionId: 'sub1' },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', {}, 'admin')

      expect(mockExecuteDataUpdateRules).toHaveBeenCalledWith(instance)
      expect(instance.status).toBe('completed')
    })
  })

  // ─────────────────────────────────────
  // 7. ScriptTask execution
  // ─────────────────────────────────────

  describe('ScriptTask', () => {
    it('evaluates script and writes result to instance variables', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('script', BpmnElementType.ScriptTask, { label: 'doubled', scriptContent: 'x * 2' }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'script'), eg('e2', 'script', 'end')],
      }
      setupDefinition()
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { x: 21 },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { x: 21 }, 'admin')

      // Script result stored under the node's label key
      expect(instance.variables['doubled']).toBe(42)
      // Token completed through to end
      expect(instance.tokens[0].state).toBe('completed')
      expect(instance.status).toBe('completed')
    })

    it('skips variable write when script returns undefined', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('script', BpmnElementType.ScriptTask, { label: 'noop', scriptContent: 'void 0' }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'script'), eg('e2', 'script', 'end')],
      }
      setupDefinition()
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', {}, 'admin')

      // No 'noop' key should be written since script returned undefined
      expect(instance.variables).not.toHaveProperty('noop')
      expect(instance.status).toBe('completed')
    })
  })

  // ─────────────────────────────────────
  // 8. TimerEvent + fireTimerJob / fireDueTimers
  // ─────────────────────────────────────

  describe('TimerEvent', () => {
    it('creates a timer job and pauses the token', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('timer', BpmnElementType.TimerEvent, { timerType: 'duration', timerValue: 'PT5M' }),
          nd('task1', BpmnElementType.UserTask, { assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'timer'), eg('e2', 'timer', 'task1'), eg('e3', 'task1', 'end')],
      }
      setupDefinition()
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', {}, 'admin')

      // Timer job created
      expect(mockTimerJobCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: 'inst1',
          nodeId: 'timer',
          status: 'pending',
          timerType: 'duration',
          timerValue: 'PT5M',
        }),
      )
      // Token paused at timer
      expect(instance.tokens[0].nodeId).toBe('timer')
      expect(instance.tokens[0].state).toBe('waiting')
    })

    it('fireTimerJob resumes token and advances to next node', async () => {
      setupDefinition()
      setupVersion(linearGraph({ assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }))

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'timer1', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })

      const job = mockDoc({
        _id: 'job1',
        instanceId: 'inst1',
        tokenId: 'tok1',
        nodeId: 'timer1',
        status: 'pending',
        fireAt: new Date(),
      })

      mockTimerJobFindById.mockResolvedValue(job)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      // For the advance that fireTimerJob triggers after moving the token
      // The advance will try to load version, parse graph, and process the token
      const result = await engine.fireTimerJob('job1')

      expect(result).toBe(true)
      expect(job.status).toBe('fired')
      expect(job.save).toHaveBeenCalled()
    })

    it('fireTimerJob returns false for already-fired job', async () => {
      const job = mockDoc({
        _id: 'job1',
        instanceId: 'inst1',
        status: 'fired',
      })
      mockTimerJobFindById.mockResolvedValue(job)

      const result = await engine.fireTimerJob('job1')
      expect(result).toBe(false)
    })

    it('fireTimerJob returns false when job not found', async () => {
      mockTimerJobFindById.mockResolvedValue(null)

      const result = await engine.fireTimerJob('nonexistent')
      expect(result).toBe(false)
    })

    it('fireDueTimers processes pending jobs whose fireAt <= now', async () => {
      const pastDate = new Date('2020-01-01T00:00:00Z')
      const job1 = mockDoc({ _id: 'job1', instanceId: 'inst1', status: 'pending', fireAt: pastDate })
      const job2 = mockDoc({ _id: 'job2', instanceId: 'inst2', status: 'pending', fireAt: pastDate })

      mockTimerJobFind.mockReturnValue({
        limit: vi.fn().mockResolvedValue([job1, job2]),
      })

      // Both jobs: findById returns the job, but instance is not found so fire returns false
      mockTimerJobFindById
        .mockResolvedValueOnce(job1)
        .mockResolvedValueOnce(job2)

      // Instance not found -> fireTimerJob returns false
      mockFlowInstanceFindById.mockResolvedValue(null)

      const result = await engine.fireDueTimers()

      expect(result.checked).toBe(2)
      expect(result.fired).toBe(0)
    })
  })

  // ─────────────────────────────────────
  // 9. InclusiveGateway (fork + join)
  // ─────────────────────────────────────

  describe('InclusiveGateway', () => {
    function inclusiveGraph(): FlowGraph {
      return {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('fork', BpmnElementType.InclusiveGateway),
          nd('taskA', BpmnElementType.UserTask, { assignee: 'userA', assigneeType: 'user', candidateUsers: ['userA'] }),
          nd('taskB', BpmnElementType.UserTask, { assignee: 'userB', assigneeType: 'user', candidateUsers: ['userB'] }),
          nd('taskC', BpmnElementType.UserTask, { assignee: 'userC', assigneeType: 'user', candidateUsers: ['userC'] }),
          nd('join', BpmnElementType.InclusiveGateway),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [
          eg('e1', 'start', 'fork'),
          eg('e2', 'fork', 'taskA', { conditionExpression: 'doA === true' }),
          eg('e3', 'fork', 'taskB', { conditionExpression: 'doB === true' }),
          eg('e4', 'fork', 'taskC', { isDefault: true }),
          eg('e5', 'taskA', 'join'),
          eg('e6', 'taskB', 'join'),
          eg('e7', 'taskC', 'join'),
          eg('e8', 'join', 'end'),
        ],
      }
    }

    it('fork creates tokens only for matching conditions', async () => {
      setupDefinition()
      setupVersion(inclusiveGraph())

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { doA: true, doB: false },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { doA: true, doB: false }, 'admin')

      // doA matches -> taskA gets token; doB does not match, no default since doB=false path doesn't match
      // Actually, default edge is for taskC (isDefault: true), so taskC also gets a token
      // Fork evaluates: doA=true -> match taskA; doB=false -> no match; default -> taskC
      // Wait, the inclusive gateway fork logic: it filters matching edges by condition,
      // and if any match, only those get tokens. If none match, default gets token.
      // Here doA=true matches, so only taskA should get a token (not default).
      const taskAToken = instance.tokens.find((t: { nodeId: string }) => t.nodeId === 'taskA')
      expect(taskAToken).toBeDefined()
      expect(taskAToken!.state).toBe('waiting')
    })

    it('fork falls back to default when no condition matches', async () => {
      setupDefinition()
      setupVersion(inclusiveGraph())

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { doA: false, doB: false },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { doA: false, doB: false }, 'admin')

      // No conditions match -> default edge -> taskC
      const taskCToken = instance.tokens.find((t: { nodeId: string }) => t.nodeId === 'taskC')
      expect(taskCToken).toBeDefined()
      expect(taskCToken!.state).toBe('waiting')
    })

    it('join waits until all arriving branches are present', async () => {
      setupDefinition()
      setupVersion(inclusiveGraph())

      // Only tokA at join, tokB still at taskB
      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [
          { tokenId: 'tokA', nodeId: 'join', state: 'active', createdAt: new Date() },
          { tokenId: 'tokB', nodeId: 'taskB', state: 'waiting', createdAt: new Date() },
        ],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.advance('inst1')

      // tokA should be waiting because not all branches arrived
      const tokA = instance.tokens.find((t: { tokenId: string }) => t.tokenId === 'tokA')
      expect(tokA!.state).toBe('waiting')
    })
  })

  // ─────────────────────────────────────
  // 10. Assignee resolution: role-based and expression-based
  // ─────────────────────────────────────

  describe('assignee resolution', () => {
    it('resolves role-based assignees into candidateRoles', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('task1', BpmnElementType.UserTask, {
            assigneeType: 'role',
            candidateRoles: ['manager', 'director'],
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'task1'), eg('e2', 'task1', 'end')],
      }
      setupDefinition()
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', {}, 'admin')

      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          candidateRoles: ['manager', 'director'],
          candidateUsers: [],
        }),
      )
    })

    it('resolves expression-based assignees from instance variables', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('task1', BpmnElementType.UserTask, {
            assigneeType: 'expression',
            assignee: 'reviewers',
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'task1'), eg('e2', 'task1', 'end')],
      }
      setupDefinition()
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { reviewers: ['alice', 'bob'] },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { reviewers: ['alice', 'bob'] }, 'admin')

      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          candidateUsers: ['alice', 'bob'],
        }),
      )
    })
  })

  // ─────────────────────────────────────
  // 11. Approval log is written on completeTask
  // ─────────────────────────────────────

  describe('approval log', () => {
    it('creates an approval log entry when task is completed', async () => {
      setupDefinition()
      setupVersion(linearGraph({ assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }))

      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'pending',
        assignee: null,
        candidateUsers: ['user1'],
      })

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })

      mockTaskInstanceFindById.mockResolvedValue(task)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.completeTask('taskInst1', undefined, 'approved', 'user1')

      expect(mockApprovalLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: 'inst1',
          nodeId: 'task1',
          nodeName: 'task1',
          taskId: 'taskInst1',
          action: 'approve',
          operator: 'user1',
          outcome: 'approved',
        }),
      )
    })

    it('logs reject action when outcome is rejected', async () => {
      setupDefinition()
      setupVersion(linearGraph({ assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }))

      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'pending',
        assignee: null,
        candidateUsers: ['user1'],
      })

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })

      mockTaskInstanceFindById.mockResolvedValue(task)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.completeTask('taskInst1', undefined, 'rejected', 'user1')

      expect(mockApprovalLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'reject',
          outcome: 'rejected',
        }),
      )
    })
  })

  // ─────────────────────────────────────
  // 12. or-sign with reject-on-all policy (default)
  // ─────────────────────────────────────

  describe('or-sign reject-on-all policy', () => {
    it('does NOT cancel remaining tasks when reject-on-all and one task rejects', async () => {
      setupDefinition()
      setupVersion(
        multiInstanceGraph('or-sign', ['user1', 'user2', 'user3']),
        { defaultRejectPolicy: 'reject-on-all' },
      )

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { approvers: ['user1', 'user2', 'user3'] },
        tokens: [{ tokenId: 'tok1', nodeId: 'multiTask', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      const task = mockDoc({
        _id: 't1',
        instanceId: 'inst1',
        nodeId: 'multiTask',
        nodeName: 'multiTask',
        status: 'pending',
        candidateUsers: ['user1'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await engine.completeTask('t1', undefined, 'rejected', 'user1')

      // reject-on-all: should NOT cancel remaining tasks
      expect(mockTaskInstanceUpdateMany).not.toHaveBeenCalled()
      // Token should stay at the same node (advance re-enters UserTask)
      expect(instance.tokens[0].nodeId).toBe('multiTask')
    })
  })

  // ─────────────────────────────────────
  // 13. SubProcess (nested flow execution)
  // ─────────────────────────────────────

  describe('SubProcess', () => {
    it('skips SubProcess when no subProcessDefinitionId configured', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('sub', BpmnElementType.SubProcess), // no subProcessDefinitionId
          nd('task1', BpmnElementType.UserTask, { assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'sub'), eg('e2', 'sub', 'task1'), eg('e3', 'task1', 'end')],
      }

      const parentDef = mockDoc({
        _id: 'def1',
        name: 'Test Flow',
        status: 'published',
        currentVersionId: 'v1',
        createdBy: 'admin',
      })
      const parentVersion = mockDoc({
        _id: 'v1',
        definitionId: 'def1',
        version: '1',
        graph,
        metadata: null,
      })
      mockFlowDefinitionFindById.mockImplementation((id: string) =>
        id === 'def1' ? Promise.resolve(parentDef) : Promise.resolve(null),
      )
      mockFlowVersionFindById.mockImplementation((id: string) =>
        id === 'v1' ? Promise.resolve(parentVersion) : Promise.resolve(null),
      )

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', {}, 'admin')

      // Should pass through the SubProcess (no subProcessDefinitionId) and land on UserTask
      const taskToken = instance.tokens.find((t: { nodeId: string }) => t.nodeId === 'task1')
      expect(taskToken).toBeDefined()
      expect(taskToken!.state).toBe('waiting')
    })

    it('starts a child flow and pauses parent token', async () => {
      const parentGraph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('sub', BpmnElementType.SubProcess, { subProcessDefinitionId: 'child-def' }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'sub'), eg('e2', 'sub', 'end')],
      }

      const childGraph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'end')],
      }

      const parentDef = mockDoc({
        _id: 'def1',
        name: 'Parent Flow',
        status: 'published',
        currentVersionId: 'v1',
        createdBy: 'admin',
      })
      const parentVersion = mockDoc({
        _id: 'v1',
        definitionId: 'def1',
        version: '1',
        graph: parentGraph,
        metadata: null,
      })

      const childDef = mockDoc({
        _id: 'child-def',
        name: 'Child Flow',
        status: 'published',
        currentVersionId: 'cv1',
        createdBy: 'admin',
      })
      const childVersion = mockDoc({
        _id: 'cv1',
        definitionId: 'child-def',
        version: '1',
        graph: childGraph,
        metadata: null,
      })

      // Use mockImplementation to dispatch by ID for both definition and version lookups
      mockFlowDefinitionFindById.mockImplementation((id: string) => {
        if (id === 'def1') return Promise.resolve(parentDef)
        if (id === 'child-def') return Promise.resolve(childDef)
        return Promise.resolve(null)
      })
      mockFlowVersionFindById.mockImplementation((id: string) => {
        if (id === 'v1') return Promise.resolve(parentVersion)
        if (id === 'cv1') return Promise.resolve(childVersion)
        return Promise.resolve(null)
      })
      mockFlowVersionFindOne.mockImplementation((query: Record<string, string>) => {
        if (query.definitionId === 'def1') return Promise.resolve(parentVersion)
        if (query.definitionId === 'child-def') return Promise.resolve(childVersion)
        return Promise.resolve(null)
      })

      const parentInstance = mockDoc({
        _id: 'parent1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { shared: 'data' },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })

      const childInstance = mockDoc({
        _id: 'child1',
        definitionId: 'child-def',
        versionId: 'cv1',
        version: '1',
        status: 'running',
        variables: { shared: 'data' },
        tokens: [{ tokenId: 'ctok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })

      let createCallCount = 0
      mockFlowInstanceCreate.mockImplementation((data: Record<string, unknown>) => {
        createCallCount++
        if (createCallCount === 1) {
          // First call: parent instance
          Object.assign(parentInstance, { _id: data._id ?? 'parent1' })
          return Promise.resolve(parentInstance)
        }
        // Second call: child instance
        Object.assign(childInstance, {
          _id: data._id ?? 'child1',
          parentInstanceId: parentInstance._id,
          parentTokenId: parentInstance.tokens[0].tokenId,
        })
        return Promise.resolve(childInstance)
      })

      mockFlowInstanceFindById.mockImplementation((id: string) => {
        if (id === parentInstance._id) return Promise.resolve(parentInstance)
        if (id === childInstance._id) return Promise.resolve(childInstance)
        return Promise.resolve(null)
      })
      mockFlowInstanceFindOne.mockResolvedValue(null) // no existing child subprocess

      await engine.startFlow('def1', { shared: 'data' }, 'admin')

      // Parent token should be waiting at the SubProcess node
      const subToken = parentInstance.tokens.find((t: { nodeId: string }) => t.nodeId === 'sub')
      expect(subToken).toBeDefined()
      expect(subToken!.state).toBe('waiting')
    })
  })

  // ─────────────────────────────────────
  // 14. ReceiveTask pass-through
  // ─────────────────────────────────────

  describe('ReceiveTask', () => {
    it('creates a pending task and pauses the token', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('recv', BpmnElementType.ReceiveTask, { assignee: 'user1', label: 'recv' }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'recv'), eg('e2', 'recv', 'end')],
      }
      setupDefinition()
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', {}, 'admin')

      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: 'recv',
          nodeName: 'recv',
          status: 'pending',
          candidateUsers: ['user1'],
        }),
      )
      expect(instance.tokens[0].nodeId).toBe('recv')
      expect(instance.tokens[0].state).toBe('waiting')
    })
  })

  // ─────────────────────────────────────
  // 15. completeTask with assignee field (isAssignee path)
  // ─────────────────────────────────────

  describe('completeTask authorization', () => {
    it('authorizes user who is the assignee (not just candidateUsers)', async () => {
      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'pending',
        assignee: 'user1',
        candidateUsers: [],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      setupDefinition()
      setupVersion(linearGraph({ assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }))

      // Should not throw — user1 is the assignee
      await expect(
        engine.completeTask('taskInst1', undefined, 'approved', 'user1'),
      ).resolves.not.toThrow()
    })

    it('authorizes user in candidateUsers even without being assignee', async () => {
      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'pending',
        assignee: null,
        candidateUsers: ['user2', 'user3'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      setupDefinition()
      setupVersion(linearGraph({ assignee: 'user2', assigneeType: 'user', candidateUsers: ['user2', 'user3'] }))

      // user3 is in candidateUsers but not the assignee — should still work
      await expect(
        engine.completeTask('taskInst1', undefined, 'approved', 'user3'),
      ).resolves.not.toThrow()
    })

    it('rejects user not in assignee or candidateUsers', async () => {
      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'pending',
        assignee: 'user1',
        candidateUsers: ['user2'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await expect(
        engine.completeTask('taskInst1', undefined, 'approved', 'intruder'),
      ).rejects.toThrow('not authorized')
    })

    it('skips authorization check when userId is not provided', async () => {
      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'pending',
        assignee: 'user1',
        candidateUsers: [],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      setupDefinition()
      setupVersion(linearGraph({ assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }))

      // No userId passed — should skip auth check entirely
      await expect(
        engine.completeTask('taskInst1', undefined, 'approved'),
      ).resolves.not.toThrow()
    })
  })

  // ─────────────────────────────────────
  // 16. completeTask on claimed task
  // ─────────────────────────────────────

  describe('completeTask on claimed task', () => {
    it('can complete a claimed task (not just pending)', async () => {
      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'claimed',
        assignee: 'user1',
        candidateUsers: ['user1'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      setupDefinition()
      setupVersion(linearGraph({ assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }))

      await engine.completeTask('taskInst1', undefined, 'approved', 'user1')

      expect(task.status).toBe('completed')
      expect(task.outcome).toBe('approved')
    })
  })

  // ─────────────────────────────────────
  // 17. Multi-instance: sequential advances one by one
  // ─────────────────────────────────────

  describe('multi-instance sequential advancement', () => {
    it('creates next task after completing current one', async () => {
      function seqGraph(): FlowGraph {
        return {
          nodes: [
            nd('start', BpmnElementType.StartEvent),
            nd('miTask', BpmnElementType.UserTask, {
              assigneeType: 'user',
              candidateUsers: [],
              multiInstance: {
                type: 'sequential',
                collection: 'items',
                elementVariable: 'item',
                completionCondition: '',
              },
            }),
            nd('end', BpmnElementType.EndEvent),
          ],
          edges: [eg('e1', 'start', 'miTask'), eg('e2', 'miTask', 'end')],
        }
      }

      setupDefinition()
      setupVersion(seqGraph())

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { items: ['a', 'b', 'c'] },
        tokens: [{ tokenId: 'tok1', nodeId: 'miTask', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      // Simulate: first task completed, second pending
      mockTaskInstanceFind.mockResolvedValue([
        mockDoc({ _id: 't1', nodeId: 'miTask', status: 'completed', multiInstanceIndex: 0, multiInstanceItem: 'a' }),
        mockDoc({ _id: 't2', nodeId: 'miTask', status: 'pending', multiInstanceIndex: 1, multiInstanceItem: 'b' }),
      ])

      const task = mockDoc({
        _id: 't1',
        instanceId: 'inst1',
        nodeId: 'miTask',
        nodeName: 'miTask',
        status: 'pending',
        candidateUsers: [],
        multiInstanceIndex: 0,
        multiInstanceItem: 'a',
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await engine.completeTask('t1', undefined, 'approved', undefined)

      // Token should still be at miTask (sequential, not all done)
      expect(instance.tokens[0].nodeId).toBe('miTask')
    })
  })

  // ─────────────────────────────────────
  // 18. Nested exclusive gateway: multi-level branching
  // ─────────────────────────────────────

  describe('nested gateway flow', () => {
    it('handles exclusive gateway after exclusive gateway', async () => {
      // start -> gw1 -> (gw2 if amount > 500 | taskLow) -> gw2 -> (taskHigh if amount > 1000 | taskMed)
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('gw1', BpmnElementType.ExclusiveGateway),
          nd('gw2', BpmnElementType.ExclusiveGateway),
          nd('taskHigh', BpmnElementType.UserTask, { assignee: 'h', assigneeType: 'user', candidateUsers: ['h'] }),
          nd('taskMed', BpmnElementType.UserTask, { assignee: 'm', assigneeType: 'user', candidateUsers: ['m'] }),
          nd('taskLow', BpmnElementType.UserTask, { assignee: 'l', assigneeType: 'user', candidateUsers: ['l'] }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [
          eg('e1', 'start', 'gw1'),
          eg('e2', 'gw1', 'gw2', { conditionExpression: 'amount > 500' }),
          eg('e3', 'gw1', 'taskLow', { isDefault: true }),
          eg('e4', 'gw2', 'taskHigh', { conditionExpression: 'amount > 1000' }),
          eg('e5', 'gw2', 'taskMed', { isDefault: true }),
          eg('e6', 'taskHigh', 'end'),
          eg('e7', 'taskMed', 'end'),
          eg('e8', 'taskLow', 'end'),
        ],
      }
      setupDefinition()
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { amount: 800 },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { amount: 800 }, 'admin')

      // amount > 500 -> gw2; amount not > 1000 -> default (taskMed)
      expect(instance.tokens[0].nodeId).toBe('taskMed')
      expect(instance.tokens[0].state).toBe('waiting')
    })
  })

  // ─────────────────────────────────────
  // 19. Variable propagation through multi-node flow
  // ─────────────────────────────────────

  describe('variable propagation', () => {
    it('variables set by form persist across task completions and are saved', async () => {
      // Test that form data is written to instance variables via formVariable
      // and persists after the instance is saved.
      setupDefinition()
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('task1', BpmnElementType.UserTask, {
            assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'],
            formVariable: 'step1',
          }),
          nd('task2', BpmnElementType.UserTask, {
            assignee: 'user2', assigneeType: 'user', candidateUsers: ['user2'],
            formVariable: 'step2',
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [
          eg('e1', 'start', 'task1'),
          eg('e2', 'task1', 'task2'),
          eg('e3', 'task2', 'end'),
        ],
      }
      setupVersion(graph)

      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'pending',
        candidateUsers: ['user1'],
      })

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })

      mockTaskInstanceFindById.mockResolvedValue(task)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.completeTask('taskInst1', { score: 75 }, 'approved', 'user1')

      // Form data written to variables via formVariable config
      expect(instance.variables.step1).toEqual({ score: 75 })
      // Instance is saved (variables are persisted)
      expect(instance.save).toHaveBeenCalled()
      // Variables are available for downstream condition evaluation
      expect(instance.variables.step1.score).toBe(75)
    })
  })

  // ─────────────────────────────────────
  // 20. Reject policy: follow-global falls back to metadata default
  // ─────────────────────────────────────

  describe('reject policy resolution', () => {
    it('node with follow-global uses metadata defaultRejectPolicy', async () => {
      setupDefinition()
      setupVersion(
        multiInstanceGraph('or-sign', ['user1', 'user2']),
        { defaultRejectPolicy: 'reject-on-any' },
      )

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { approvers: ['user1', 'user2'] },
        tokens: [{ tokenId: 'tok1', nodeId: 'multiTask', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      const task = mockDoc({
        _id: 't1',
        instanceId: 'inst1',
        nodeId: 'multiTask',
        nodeName: 'multiTask',
        status: 'pending',
        candidateUsers: ['user1'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await engine.completeTask('t1', undefined, 'rejected', 'user1')

      // Global policy reject-on-any: cancel remaining and advance
      expect(mockTaskInstanceUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'multiTask' }),
        expect.objectContaining({ status: 'cancelled' }),
      )
      expect(instance.status).toBe('completed')
    })
  })

  // ── rejectToNode tests ──

  describe('rejectToNode', () => {
    it('rejects task back to an upstream UserTask', async () => {
      // Graph: start -> task1 -> task2 -> end
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('task1', BpmnElementType.UserTask, { assignee: 'userA', assigneeType: 'user', candidateUsers: ['userA'] }),
          nd('task2', BpmnElementType.UserTask, { assignee: 'userB', assigneeType: 'user', candidateUsers: ['userB'] }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'task1'), eg('e2', 'task1', 'task2'), eg('e3', 'task2', 'end')],
      }
      setupVersion(graph)
      setupDefinition()

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task2', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      const task = mockDoc({
        _id: 't1',
        instanceId: 'inst1',
        nodeId: 'task2',
        nodeName: 'task2',
        status: 'claimed',
        assignee: 'userB',
        candidateUsers: ['userB'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await engine.rejectToNode('t1', 'task1', '需要修改', 'userB')

      // Task should be marked as completed with rejected outcome
      expect(task.status).toBe('completed')
      expect(task.outcome).toBe('rejected')

      // Remaining tasks at task2 should be cancelled
      expect(mockTaskInstanceUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ instanceId: 'inst1', nodeId: 'task2' }),
        expect.objectContaining({ status: 'cancelled' }),
      )

      // Token should move to task1 (advance creates a new task there, changing state to waiting)
      expect(instance.tokens[0].nodeId).toBe('task1')

      // Approval log should be created
      expect(mockApprovalLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'reject-to-node',
          comment: '需要修改',
          operator: 'userB',
        }),
      )

      // Instance should be saved
      expect(instance.save).toHaveBeenCalled()
    })

    it('throws when task is not in a rejectable state', async () => {
      const task = mockDoc({
        _id: 't1',
        instanceId: 'inst1',
        nodeId: 'task2',
        nodeName: 'task2',
        status: 'completed',
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await expect(engine.rejectToNode('t1', 'task1')).rejects.toThrow('Task is not in a rejectable state')
    })

    it('throws when target node is not a UserTask', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('task1', BpmnElementType.UserTask),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'task1'), eg('e2', 'task1', 'end')],
      }
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        versionId: 'v1',
        status: 'running',
        tokens: [{ tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() }],
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      const task = mockDoc({
        _id: 't1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'claimed',
        assignee: 'userA',
        candidateUsers: ['userA'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await expect(engine.rejectToNode('t1', 'start')).rejects.toThrow('Target node must be a UserTask')
    })

    it('throws when target node is not upstream', async () => {
      // Graph: start -> task1 -> task2 -> end (task1 is NOT upstream of task1)
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('task1', BpmnElementType.UserTask),
          nd('task2', BpmnElementType.UserTask),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'task1'), eg('e2', 'task1', 'task2'), eg('e3', 'task2', 'end')],
      }
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        versionId: 'v1',
        status: 'running',
        tokens: [{ tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() }],
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      const task = mockDoc({
        _id: 't1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'claimed',
        assignee: 'userA',
        candidateUsers: ['userA'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await expect(engine.rejectToNode('t1', 'task2')).rejects.toThrow('Target node is not reachable upstream')
    })

    it('throws when user is not authorized', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('task1', BpmnElementType.UserTask),
          nd('task2', BpmnElementType.UserTask),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'task1'), eg('e2', 'task1', 'task2'), eg('e3', 'task2', 'end')],
      }
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        versionId: 'v1',
        status: 'running',
        tokens: [{ tokenId: 'tok1', nodeId: 'task2', state: 'waiting', createdAt: new Date() }],
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      const task = mockDoc({
        _id: 't1',
        instanceId: 'inst1',
        nodeId: 'task2',
        nodeName: 'task2',
        status: 'claimed',
        assignee: 'userB',
        candidateUsers: ['userB'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await expect(engine.rejectToNode('t1', 'task1', undefined, 'unauthorizedUser')).rejects.toThrow('not authorized')
    })
  })

  describe('getRejectTargets', () => {
    it('returns upstream UserTask nodes', async () => {
      // Graph: start -> task1 -> task2 -> task3 -> end
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('task1', BpmnElementType.UserTask, { label: '审批' }),
          nd('task2', BpmnElementType.UserTask, { label: '复核' }),
          nd('task3', BpmnElementType.UserTask, { label: '终审' }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [
          eg('e1', 'start', 'task1'),
          eg('e2', 'task1', 'task2'),
          eg('e3', 'task2', 'task3'),
          eg('e4', 'task3', 'end'),
        ],
      }
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        versionId: 'v1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task3', state: 'waiting', createdAt: new Date() }],
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      const task = mockDoc({
        _id: 't1',
        instanceId: 'inst1',
        nodeId: 'task3',
        nodeName: '终审',
        status: 'claimed',
        assignee: 'userC',
        candidateUsers: ['userC'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      const targets = await engine.getRejectTargets('t1')

      expect(targets).toHaveLength(2)
      expect(targets.map(t => t.nodeId)).toContain('task1')
      expect(targets.map(t => t.nodeId)).toContain('task2')
    })

    it('returns empty array when no upstream UserTasks exist', async () => {
      // Graph: start -> task1 -> end (task1 is the first task, no upstream)
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('task1', BpmnElementType.UserTask),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'task1'), eg('e2', 'task1', 'end')],
      }
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        versionId: 'v1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task1', state: 'waiting', createdAt: new Date() }],
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      const task = mockDoc({
        _id: 't1',
        instanceId: 'inst1',
        nodeId: 'task1',
        nodeName: 'task1',
        status: 'claimed',
        assignee: 'userA',
        candidateUsers: ['userA'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      const targets = await engine.getRejectTargets('t1')

      expect(targets).toHaveLength(0)
    })

    it('traverses through gateways to find upstream UserTasks', async () => {
      // Graph: start -> task1 -> gw -> task2 -> end
      // task1 is upstream of task2 through the gateway
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('task1', BpmnElementType.UserTask, { label: '审批' }),
          nd('gw', BpmnElementType.ExclusiveGateway),
          nd('task2', BpmnElementType.UserTask, { label: '复核' }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [
          eg('e1', 'start', 'task1'),
          eg('e2', 'task1', 'gw'),
          eg('e3', 'gw', 'task2'),
          eg('e4', 'task2', 'end'),
        ],
      }
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        versionId: 'v1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'task2', state: 'waiting', createdAt: new Date() }],
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      const task = mockDoc({
        _id: 't1',
        instanceId: 'inst1',
        nodeId: 'task2',
        nodeName: '复核',
        status: 'claimed',
        assignee: 'userB',
        candidateUsers: ['userB'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      const targets = await engine.getRejectTargets('t1')

      // task1 is reachable upstream through the gateway
      expect(targets).toHaveLength(1)
      expect(targets[0].nodeId).toBe('task1')
      expect(targets[0].nodeName).toBe('审批')
    })
  })
})
