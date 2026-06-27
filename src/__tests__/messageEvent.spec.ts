/**
 * Message Event Integration Tests
 *
 * Tests SendTask/ReceiveTask message channel behavior:
 * 1. SendTask sends message to channel via MessageQueue
 * 2. ReceiveTask consumes message from channel and advances
 * 3. Cross-instance message passing
 * 4. Race condition handling (message arrives before ReceiveTask subscribes)
 *
 * All Mongoose models are mocked; parseBpmnGraph runs for real (pure function).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BpmnElementType } from '@schema-form/flow-shared'
import type { FlowGraph, FlowNodeData, FlowEdgeData } from '@schema-form/flow-shared'

// ── Mock all Mongoose models ──

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
  mockMessageSend,
  mockMessageTryConsume,
  mockMessageSubscribe,
  mockMessageGetPendingMessages,
  mockMessageGetPendingCount,
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
  mockMessageSend: vi.fn(),
  mockMessageTryConsume: vi.fn(),
  mockMessageSubscribe: vi.fn(),
  mockMessageGetPendingMessages: vi.fn(),
  mockMessageGetPendingCount: vi.fn(),
}))

vi.mock('../flow-models/FlowDefinition.js', () => ({
  FlowDefinitionModel: { findById: mockFlowDefinitionFindById },
}))

vi.mock('../flow-models/FlowVersion.js', () => ({
  FlowVersionModel: {
    findById: mockFlowVersionFindById,
    findOne: mockFlowVersionFindOne,
  },
}))

vi.mock('../flow-models/FlowInstance.js', () => ({
  FlowInstanceModel: {
    findById: mockFlowInstanceFindById,
    findOne: mockFlowInstanceFindOne,
    find: mockFlowInstanceFind,
    create: mockFlowInstanceCreate,
    updateMany: mockFlowInstanceUpdateMany,
  },
}))

vi.mock('../flow-models/TaskInstance.js', () => ({
  TaskInstanceModel: {
    findById: mockTaskInstanceFindById,
    findOne: mockTaskInstanceFindOne,
    find: mockTaskInstanceFind,
    create: mockTaskInstanceCreate,
    updateMany: mockTaskInstanceUpdateMany,
  },
}))

vi.mock('../flow-models/TimerJob.js', () => ({
  TimerJobModel: {
    findOne: mockTimerJobFindOne,
    find: mockTimerJobFind,
    create: mockTimerJobCreate,
    updateMany: mockTimerJobUpdateMany,
    findById: mockTimerJobFindById,
  },
}))

vi.mock('../flow-models/ApprovalLog.js', () => ({
  ApprovalLogModel: { create: mockApprovalLogCreate },
}))

vi.mock('../flow-services/TimerService.js', () => ({
  parseTimerValue: vi.fn(() => new Date('2026-12-01T00:00:00Z')),
}))

vi.mock('../flow-services/NotificationService.js', () => ({
  notificationService: {
    sendNotification: mockSendNotification,
    sendBatchNotifications: mockSendBatchNotifications,
    createTaskAssignedNotification: vi.fn().mockResolvedValue(undefined),
    createTaskRejectedNotification: vi.fn().mockResolvedValue(undefined),
    createFlowCompletedNotification: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../flow-services/MessageQueue.js', () => ({
  messageQueue: {
    send: mockMessageSend,
    tryConsume: mockMessageTryConsume,
    subscribe: mockMessageSubscribe,
    getPendingMessages: mockMessageGetPendingMessages,
    getPendingCount: mockMessageGetPendingCount,
  },
}))

vi.mock('../services/executionLogger.js', () => ({
  logNodeStart: vi.fn().mockResolvedValue({}),
  logNodeComplete: vi.fn().mockResolvedValue(undefined),
  logNodeFail: vi.fn().mockResolvedValue(undefined),
  getInstanceLogs: vi.fn().mockResolvedValue([]),
}))

vi.mock('../services/eventBus.js', () => ({
  eventBus: {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  },
}))

vi.mock('../services/dataUpdateEngine.js', () => ({
  executeDataUpdateRules: vi.fn().mockResolvedValue({ submissionId: null, rulesApplied: 0 }),
}))

// Import after mocks
import { FlowEngine } from '../flow-services/FlowEngine.js'

// ── Helper factories ──

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

function mockDoc<T extends Record<string, unknown>>(data: T): T & { save: ReturnType<typeof vi.fn> } {
  const doc = { ...data } as T & { save: ReturnType<typeof vi.fn> }
  doc.save = vi.fn().mockResolvedValue(doc)
  return doc
}

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

describe('Message Event: SendTask / ReceiveTask', () => {
  let engine: FlowEngine

  beforeEach(() => {
    vi.clearAllMocks()
    engine = new FlowEngine()

    mockTaskInstanceFindById.mockResolvedValue(null)
    mockTaskInstanceFindOne.mockResolvedValue(null)
    mockTaskInstanceFind.mockResolvedValue([])
    mockFlowInstanceFindById.mockResolvedValue(null)
    mockFlowInstanceFindOne.mockResolvedValue(null)
    mockFlowInstanceFind.mockResolvedValue([])
    mockTimerJobFindOne.mockResolvedValue(null)
    mockTimerJobFind.mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })

    mockTaskInstanceCreate.mockImplementation((data: Record<string, unknown>) =>
      Promise.resolve(mockDoc({ _id: data._id ?? 'mockTaskId', ...data })),
    )
  })

  // ── SendTask with messageRef ──

  describe('SendTask with messageRef', () => {
    it('sends message to channel via MessageQueue when messageRef is configured', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('send1', BpmnElementType.SendTask, {
            messageRef: 'order-channel',
            label: 'sendOrder',
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'send1'), eg('e2', 'send1', 'end')],
      }
      setupDefinition()
      setupVersion(graph)

      mockMessageSend.mockResolvedValue({
        _id: 'msg1',
        channel: 'order-channel',
        payload: {},
        status: 'pending',
      })

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { orderId: '123' },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'admin',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { orderId: '123' }, 'admin')

      expect(mockMessageSend).toHaveBeenCalledWith({
        channel: 'order-channel',
        payload: {
          instanceId: 'inst1',
          nodeId: 'send1',
          variables: expect.objectContaining({ orderId: '123' }),
        },
        senderInstanceId: 'inst1',
        senderNodeId: 'send1',
      })

      // Token should have advanced past SendTask to end
      expect(instance.tokens.some((t: { nodeId: string }) => t.nodeId === 'end')).toBe(true)
    })

    it('SendTask without messageRef uses HTTP or pass-through', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('send1', BpmnElementType.SendTask, {
            label: 'sendHttp',
            // No messageRef, no apiConfig — pass through
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'send1'), eg('e2', 'send1', 'end')],
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

      // Should NOT call MessageQueue
      expect(mockMessageSend).not.toHaveBeenCalled()

      // Token should still advance (pass-through)
      expect(instance.tokens.some((t: { nodeId: string }) => t.nodeId === 'end')).toBe(true)
    })
  })

  // ── ReceiveTask with messageRef ──

  describe('ReceiveTask with messageRef', () => {
    it('consumes existing message and advances immediately', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('recv1', BpmnElementType.ReceiveTask, {
            messageRef: 'order-channel',
            label: 'receiveOrder',
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'recv1'), eg('e2', 'recv1', 'end')],
      }
      setupDefinition()
      setupVersion(graph)

      // Message already available in the queue
      mockMessageTryConsume.mockResolvedValue({
        _id: 'msg1',
        channel: 'order-channel',
        payload: { orderId: '123' },
        status: 'consumed',
      })

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

      expect(mockMessageTryConsume).toHaveBeenCalledWith({
        channel: 'order-channel',
        receiverInstanceId: 'inst1',
        receiverNodeId: 'recv1',
      })

      // Message payload stored in variables
      expect(instance.variables.receiveOrder_message).toEqual({ orderId: '123' })

      // Token advanced past ReceiveTask to end
      expect(instance.tokens.some((t: { nodeId: string }) => t.nodeId === 'end')).toBe(true)
    })

    it('waits when no message available yet', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('recv1', BpmnElementType.ReceiveTask, {
            messageRef: 'order-channel',
            label: 'receiveOrder',
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'recv1'), eg('e2', 'recv1', 'end')],
      }
      setupDefinition()
      setupVersion(graph)

      // No message available
      mockMessageTryConsume.mockResolvedValue(null)

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

      expect(mockMessageTryConsume).toHaveBeenCalled()

      // Should create a pending TaskInstance for the ReceiveTask
      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: 'inst1',
          nodeId: 'recv1',
          status: 'pending',
        }),
      )

      // Should subscribe to the channel for real-time delivery
      expect(mockMessageSubscribe).toHaveBeenCalledWith(
        'order-channel',
        expect.any(Function),
      )

      // Token should be waiting
      const recvToken = instance.tokens.find((t: { nodeId: string }) => t.nodeId === 'recv1')
      expect(recvToken).toBeDefined()
      expect(recvToken!.state).toBe('waiting')
    })

    it('ReceiveTask without messageRef uses task-based waiting', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('recv1', BpmnElementType.ReceiveTask, {
            label: 'receiveTask',
            // No messageRef — task-based
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'recv1'), eg('e2', 'recv1', 'end')],
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

      // Should NOT try to consume from MessageQueue
      expect(mockMessageTryConsume).not.toHaveBeenCalled()
      expect(mockMessageSubscribe).not.toHaveBeenCalled()

      // Should create a pending TaskInstance (task-based)
      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: 'inst1',
          nodeId: 'recv1',
          status: 'pending',
        }),
      )

      // Token should be waiting
      const recvToken = instance.tokens.find((t: { nodeId: string }) => t.nodeId === 'recv1')
      expect(recvToken).toBeDefined()
      expect(recvToken!.state).toBe('waiting')
    })
  })

  // ── SendTask -> ReceiveTask end-to-end ──

  describe('SendTask -> ReceiveTask end-to-end', () => {
    it('message arrives before ReceiveTask: consumed immediately during advance', async () => {
      // Graph: start -> send (channel: 'ch1') -> recv (channel: 'ch1') -> end
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('send1', BpmnElementType.SendTask, { messageRef: 'ch1', label: 'sender' }),
          nd('recv1', BpmnElementType.ReceiveTask, { messageRef: 'ch1', label: 'receiver' }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [
          eg('e1', 'start', 'send1'),
          eg('e2', 'send1', 'recv1'),
          eg('e3', 'recv1', 'end'),
        ],
      }
      setupDefinition()
      setupVersion(graph)

      // SendTask sends message to channel
      mockMessageSend.mockResolvedValue({
        _id: 'msg1',
        channel: 'ch1',
        payload: { data: 'test' },
        status: 'pending',
      })

      // ReceiveTask finds the message already available
      mockMessageTryConsume.mockResolvedValue({
        _id: 'msg1',
        channel: 'ch1',
        payload: { data: 'test' },
        status: 'consumed',
      })

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

      // SendTask should have sent
      expect(mockMessageSend).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'ch1' }),
      )

      // ReceiveTask should have tried to consume
      expect(mockMessageTryConsume).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'ch1' }),
      )

      // Instance should be completed (all nodes passed)
      expect(instance.status).toBe('completed')
    })
  })
})
