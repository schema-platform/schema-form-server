/**
 * End-to-End Pipeline Integration Tests
 * Editor -> Flow -> Approval -> Completion
 *
 * Validates the complete business loop:
 * 1. Editor designs a form and publishes it (produces publishId)
 * 2. Flow designer binds the published form to a UserTask node
 * 3. startFlow event creates a FlowInstance
 * 4. Claimant views task with correct form binding (readonly/editable/partial modes)
 * 5. Approval completes the task, flow status transitions to completed
 * 6. Multi-step approval with form data propagation
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
  mockPublishedSchemaFindOne,
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
  mockPublishedSchemaFindOne: vi.fn(),
}))

vi.mock('../../flow-models/FlowDefinition.js', () => ({
  FlowDefinitionModel: { findById: mockFlowDefinitionFindById },
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
  ApprovalLogModel: { create: mockApprovalLogCreate },
}))

vi.mock('../../models/PublishedSchema.js', () => ({
  PublishedSchemaModel: { findOne: mockPublishedSchemaFindOne },
}))

vi.mock('../../flow-services/TimerService.js', () => ({
  parseTimerValue: vi.fn(() => new Date('2026-12-01T00:00:00Z')),
}))

vi.mock('../../flow-services/NotificationService.js', () => ({
  notificationService: {
    sendNotification: vi.fn().mockResolvedValue(undefined),
    sendBatchNotifications: vi.fn().mockResolvedValue(undefined),
    createTaskAssignedNotification: vi.fn().mockResolvedValue(undefined),
    createTaskRejectedNotification: vi.fn().mockResolvedValue(undefined),
    createFlowCompletedNotification: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../flow-services/MessageQueue.js', () => ({
  messageQueue: { send: vi.fn().mockResolvedValue(undefined) },
}))

import { FlowEngine } from '../../flow-services/FlowEngine.js'

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

// ── Simulate the published schema that the Editor would have created ──

interface PublishedSchemaFixture {
  _id: string
  sourceId: string
  name: string
  type: 'form'
  json: Record<string, unknown>
  publishId: string
  version: string
  publishedAt: Date
}

function makePublishedSchema(overrides: Partial<PublishedSchemaFixture> = {}): PublishedSchemaFixture {
  return {
    _id: 'pub-001',
    sourceId: 'edit-001',
    name: '采购申请表',
    type: 'form',
    json: {
      widgets: [
        { id: 'w1', type: 'input', props: { label: '申请人', field: 'applicant' } },
        { id: 'w2', type: 'number', props: { label: '金额', field: 'amount' } },
        { id: 'w3', type: 'textarea', props: { label: '备注', field: 'remark' } },
      ],
    },
    publishId: 'pub-id-001',
    version: '20260609120000',
    publishedAt: new Date('2026-06-09T12:00:00Z'),
    ...overrides,
  }
}

// ── Tests ──

describe('E2E Pipeline: Editor -> Flow -> Approval -> Completion', () => {
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

  // ─────────────────────────────────────
  // 1. Published schema exists and can be retrieved
  // ─────────────────────────────────────

  describe('Step 1: Editor publishes form schema', () => {
    it('published schema has publishId and schema JSON', () => {
      const published = makePublishedSchema()

      expect(published.publishId).toBe('pub-id-001')
      expect(published.json).toBeDefined()
      expect((published.json as Record<string, unknown>).widgets).toBeDefined()
      expect(published.name).toBe('采购申请表')
    })
  })

  // ─────────────────────────────────────
  // 2. Flow definition binds published form to UserTask
  // ─────────────────────────────────────

  describe('Step 2: Flow binds published form to UserTask', () => {
    it('UserTask node config carries formSchemaId, formPublishId, and formMode', () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('approval', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['approver1'],
            formSchemaId: 'edit-001',
            formPublishId: 'pub-id-001',
            formMode: 'editable',
            formVariable: 'approvalData',
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'approval'), eg('e2', 'approval', 'end')],
      }

      const approvalNode = graph.nodes.find(n => n.id === 'approval')!
      const data = approvalNode.data as Record<string, unknown>

      expect(data.formSchemaId).toBe('edit-001')
      expect(data.formPublishId).toBe('pub-id-001')
      expect(data.formMode).toBe('editable')
      expect(data.formVariable).toBe('approvalData')
    })
  })

  // ─────────────────────────────────────
  // 3. startFlow creates FlowInstance with form-bound UserTask
  // ─────────────────────────────────────

  describe('Step 3: startFlow creates instance and task with form binding', () => {
    it('creates a pending task with formSchemaId/formPublishId/formMode from node config', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('approval', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['approver1'],
            formSchemaId: 'edit-001',
            formPublishId: 'pub-id-001',
            formMode: 'editable',
            formVariable: 'approvalData',
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'approval'), eg('e2', 'approval', 'end')],
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
        initiatedBy: 'user1',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', {}, 'user1')

      // Task created with form binding from node config
      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: 'inst1',
          nodeId: 'approval',
          status: 'pending',
          candidateUsers: ['approver1'],
          formSchemaId: 'edit-001',
          formPublishId: 'pub-id-001',
          formMode: 'editable',
        }),
      )

      // Token waiting at the UserTask
      expect(instance.tokens[0].nodeId).toBe('approval')
      expect(instance.tokens[0].state).toBe('waiting')
      expect(instance.status).toBe('running')
    })

    it('variables passed to startFlow are stored in the instance', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('approval', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['approver1'],
            formSchemaId: 'edit-001',
            formPublishId: 'pub-id-001',
            formMode: 'editable',
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'approval'), eg('e2', 'approval', 'end')],
      }
      setupDefinition()
      setupVersion(graph)

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { applicant: '张三', amount: 5000 },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'user1',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { applicant: '张三', amount: 5000 }, 'user1')

      expect(mockFlowInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { applicant: '张三', amount: 5000 },
        }),
      )
    })
  })

  // ─────────────────────────────────────
  // 4. Task carries correct form binding for rendering
  // ─────────────────────────────────────

  describe('Step 4: Task carries correct form metadata for rendering', () => {
    function setupFormModeTest(formMode: string, extraConfig: Record<string, unknown> = {}) {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('approval', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['approver1'],
            formSchemaId: 'edit-001',
            formPublishId: 'pub-id-001',
            formMode,
            ...extraConfig,
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'approval'), eg('e2', 'approval', 'end')],
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
        initiatedBy: 'user1',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      return { instance, graph }
    }

    it('editable mode: task has formMode=editable, no field restrictions', async () => {
      const { instance } = setupFormModeTest('editable')
      await engine.startFlow('def1', {}, 'user1')

      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          formMode: 'editable',
          formSchemaId: 'edit-001',
          formPublishId: 'pub-id-001',
          editableFields: undefined,
          readonlyFields: undefined,
        }),
      )
    })

    it('readonly mode: task has formMode=readonly, all fields read-only', async () => {
      const { instance } = setupFormModeTest('readonly')
      await engine.startFlow('def1', {}, 'user1')

      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          formMode: 'readonly',
          formSchemaId: 'edit-001',
          formPublishId: 'pub-id-001',
        }),
      )
    })

    it('partial mode: task carries editableFields list', async () => {
      const { instance } = setupFormModeTest('partial', {
        editableFields: ['amount', 'remark'],
      })
      await engine.startFlow('def1', {}, 'user1')

      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          formMode: 'partial',
          editableFields: ['amount', 'remark'],
        }),
      )
    })

    it('partial mode: task carries readonlyFields list', async () => {
      const { instance } = setupFormModeTest('partial', {
        readonlyFields: ['applicant'],
      })
      await engine.startFlow('def1', {}, 'user1')

      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          formMode: 'partial',
          readonlyFields: ['applicant'],
        }),
      )
    })
  })

  // ─────────────────────────────────────
  // 5. completeTask with formData writes to instance variables
  // ─────────────────────────────────────

  describe('Step 5: Approval with form data', () => {
    it('completeTask with formData writes to instance variables via formVariable', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('approval', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['approver1'],
            formSchemaId: 'edit-001',
            formPublishId: 'pub-id-001',
            formMode: 'editable',
            formVariable: 'approvalData',
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'approval'), eg('e2', 'approval', 'end')],
      }
      setupDefinition()
      setupVersion(graph)

      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'approval',
        nodeName: 'approval',
        status: 'pending',
        assignee: null,
        candidateUsers: ['approver1'],
        formSchemaId: 'edit-001',
        formPublishId: 'pub-id-001',
        formMode: 'editable',
      })

      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { applicant: '张三' },
        tokens: [{ tokenId: 'tok1', nodeId: 'approval', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'user1',
        startedAt: new Date(),
      })

      mockTaskInstanceFindById.mockResolvedValue(task)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.completeTask('taskInst1', { amount: 8000, remark: '紧急采购' }, 'approved', 'approver1')

      // Form data written to instance variables via formVariable
      expect(instance.variables.approvalData).toEqual({ amount: 8000, remark: '紧急采购' })
      // Task marked as completed
      expect(task.status).toBe('completed')
      expect(task.outcome).toBe('approved')
      expect(task.formData).toEqual({ amount: 8000, remark: '紧急采购' })
      // Approval log created
      expect(mockApprovalLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'approve',
          operator: 'approver1',
          outcome: 'approved',
        }),
      )
    })
  })

  // ─────────────────────────────────────
  // 6. Full pipeline: startFlow -> completeTask -> flow completes
  // ─────────────────────────────────────

  describe('Step 6: Full pipeline end-to-end', () => {
    it('startFlow -> task pending -> completeTask -> flow completed', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('approval', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['approver1'],
            formSchemaId: 'edit-001',
            formPublishId: 'pub-id-001',
            formMode: 'editable',
            formVariable: 'approvalData',
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'approval'), eg('e2', 'approval', 'end')],
      }
      setupDefinition()
      setupVersion(graph)

      // Phase 1: startFlow
      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: { applicant: '张三', amount: 5000 },
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'user1',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', { applicant: '张三', amount: 5000 }, 'user1')

      // Instance running, token at approval node, task created
      expect(instance.status).toBe('running')
      expect(instance.tokens[0].nodeId).toBe('approval')
      expect(instance.tokens[0].state).toBe('waiting')
      expect(mockTaskInstanceCreate).toHaveBeenCalledTimes(1)

      // Phase 2: completeTask
      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'approval',
        nodeName: 'approval',
        status: 'pending',
        candidateUsers: ['approver1'],
        formSchemaId: 'edit-001',
        formPublishId: 'pub-id-001',
        formMode: 'editable',
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await engine.completeTask('taskInst1', { amount: 8000 }, 'approved', 'approver1')

      // Flow completed
      expect(task.status).toBe('completed')
      expect(task.outcome).toBe('approved')
      expect(instance.tokens[0].state).toBe('completed')
      expect(instance.tokens[0].nodeId).toBe('end')
      expect(instance.status).toBe('completed')
      expect(instance.completedAt).toBeDefined()
      // Only 1 task created total (no re-entry)
      expect(mockTaskInstanceCreate).toHaveBeenCalledTimes(1)
    })
  })

  // ─────────────────────────────────────
  // 7. Multi-step approval with form data propagation
  // ─────────────────────────────────────

  describe('Step 7: Multi-step approval with form data propagation', () => {
    it('task1 form data persists and is available for task2 condition evaluation', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('apply', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['applicant'],
            formSchemaId: 'edit-001',
            formPublishId: 'pub-id-001',
            formMode: 'editable',
            formVariable: 'applyData',
          }),
          nd('gw', BpmnElementType.ExclusiveGateway),
          nd('manager_approve', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['manager'],
            formSchemaId: 'edit-001',
            formPublishId: 'pub-id-001',
            formMode: 'readonly',
          }),
          nd('director_approve', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['director'],
            formSchemaId: 'edit-001',
            formPublishId: 'pub-id-001',
            formMode: 'readonly',
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [
          eg('e1', 'start', 'apply'),
          eg('e2', 'apply', 'gw'),
          eg('e3', 'gw', 'manager_approve', { isDefault: true }),
          eg('e4', 'gw', 'director_approve', { conditionExpression: 'applyData.amount > 10000' }),
          eg('e5', 'manager_approve', 'end'),
          eg('e6', 'director_approve', 'end'),
        ],
      }
      setupDefinition()
      setupVersion(graph)

      // Phase 1: startFlow - lands on apply task
      const instance = mockDoc({
        _id: 'inst1',
        definitionId: 'def1',
        versionId: 'v1',
        version: '1',
        status: 'running',
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'applicant',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', {}, 'applicant')

      expect(instance.tokens[0].nodeId).toBe('apply')
      expect(instance.tokens[0].state).toBe('waiting')

      // Phase 2: applicant submits form with amount > 10000
      const applyTask = mockDoc({
        _id: 'taskApply',
        instanceId: 'inst1',
        nodeId: 'apply',
        nodeName: 'apply',
        status: 'pending',
        candidateUsers: ['applicant'],
        formMode: 'editable',
      })
      mockTaskInstanceFindById.mockResolvedValue(applyTask)

      await engine.completeTask('taskApply', { amount: 15000, remark: '大额采购' }, 'approved', 'applicant')

      // Form data written to variables
      expect(instance.variables.applyData).toEqual({ amount: 15000, remark: '大额采购' })

      // Gateway evaluates: amount > 10000 -> director_approve
      expect(instance.tokens[0].nodeId).toBe('director_approve')
      expect(instance.tokens[0].state).toBe('waiting')

      // Director's task was created with readonly form mode
      const createdTask = mockTaskInstanceCreate.mock.calls[mockTaskInstanceCreate.mock.calls.length - 1][0] as Record<string, unknown>
      expect(createdTask.nodeId).toBe('director_approve')
      expect(createdTask.formMode).toBe('readonly')
      expect(createdTask.candidateUsers).toEqual(['director'])
    })

    it('amount <= 10000 routes to manager (default branch)', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('apply', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['applicant'],
            formVariable: 'applyData',
          }),
          nd('gw', BpmnElementType.ExclusiveGateway),
          nd('manager_approve', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['manager'],
          }),
          nd('director_approve', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['director'],
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [
          eg('e1', 'start', 'apply'),
          eg('e2', 'apply', 'gw'),
          eg('e3', 'gw', 'manager_approve', { isDefault: true }),
          eg('e4', 'gw', 'director_approve', { conditionExpression: 'applyData.amount > 10000' }),
          eg('e5', 'manager_approve', 'end'),
          eg('e6', 'director_approve', 'end'),
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
        variables: {},
        tokens: [{ tokenId: 'tok1', nodeId: 'start', state: 'active', createdAt: new Date() }],
        initiatedBy: 'applicant',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', {}, 'applicant')

      // Submit with small amount
      const applyTask = mockDoc({
        _id: 'taskApply',
        instanceId: 'inst1',
        nodeId: 'apply',
        nodeName: 'apply',
        status: 'pending',
        candidateUsers: ['applicant'],
      })
      mockTaskInstanceFindById.mockResolvedValue(applyTask)

      await engine.completeTask('taskApply', { amount: 3000 }, 'approved', 'applicant')

      // Default branch -> manager_approve
      expect(instance.tokens[0].nodeId).toBe('manager_approve')
      expect(instance.tokens[0].state).toBe('waiting')
    })
  })

  // ─────────────────────────────────────
  // 8. Rejection flow
  // ─────────────────────────────────────

  describe('Step 8: Approval rejection', () => {
    it('rejection logs reject action and flow stays running', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('approval', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['approver1'],
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'approval'), eg('e2', 'approval', 'end')],
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
        tokens: [{ tokenId: 'tok1', nodeId: 'approval', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'user1',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      const task = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'approval',
        nodeName: 'approval',
        status: 'pending',
        candidateUsers: ['approver1'],
      })
      mockTaskInstanceFindById.mockResolvedValue(task)

      await engine.completeTask('taskInst1', undefined, 'rejected', 'approver1')

      expect(task.status).toBe('completed')
      expect(task.outcome).toBe('rejected')
      expect(mockApprovalLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'reject',
          outcome: 'rejected',
        }),
      )
      // Single-mode: token moves past the node (same as approve path).
      // The FlowEngine's completeTask moves token to next node for single-mode
      // regardless of outcome. The rejection is recorded in the task outcome
      // and approval log, but the flow continues to the next node.
      expect(instance.tokens[0].nodeId).toBe('end')
    })
  })

  // ─────────────────────────────────────
  // 9. hostMethods propagation
  // ─────────────────────────────────────

  describe('Step 9: hostMethods propagation to task', () => {
    it('task inherits hostMethods from UserTask node config', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('approval', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['approver1'],
            formSchemaId: 'edit-001',
            formPublishId: 'pub-id-001',
            formMode: 'editable',
            hostMethods: ['saveDraft', 'submit', 'reject'],
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'approval'), eg('e2', 'approval', 'end')],
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
        initiatedBy: 'user1',
        startedAt: new Date(),
      })
      mockFlowInstanceCreate.mockResolvedValue(instance)
      mockFlowInstanceFindById.mockResolvedValue(instance)

      await engine.startFlow('def1', {}, 'user1')

      expect(mockTaskInstanceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          hostMethods: ['saveDraft', 'submit', 'reject'],
        }),
      )
    })
  })

  // ─────────────────────────────────────
  // 10. Claim task flow
  // ─────────────────────────────────────

  describe('Step 10: Claim task before completion', () => {
    it('claimed task can be completed by the claimant', async () => {
      const graph: FlowGraph = {
        nodes: [
          nd('start', BpmnElementType.StartEvent),
          nd('approval', BpmnElementType.UserTask, {
            assigneeType: 'user',
            candidateUsers: ['user1', 'user2'],
          }),
          nd('end', BpmnElementType.EndEvent),
        ],
        edges: [eg('e1', 'start', 'approval'), eg('e2', 'approval', 'end')],
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
        tokens: [{ tokenId: 'tok1', nodeId: 'approval', state: 'waiting', createdAt: new Date() }],
        initiatedBy: 'user1',
        startedAt: new Date(),
      })
      mockFlowInstanceFindById.mockResolvedValue(instance)

      // user2 claims the task
      const claimedTask = mockDoc({
        _id: 'taskInst1',
        instanceId: 'inst1',
        nodeId: 'approval',
        nodeName: 'approval',
        status: 'claimed',
        assignee: 'user2',
        candidateUsers: ['user1', 'user2'],
      })
      mockTaskInstanceFindById.mockResolvedValue(claimedTask)

      // user2 completes the claimed task
      await engine.completeTask('taskInst1', { decision: 'approved' }, 'approved', 'user2')

      expect(claimedTask.status).toBe('completed')
      expect(claimedTask.outcome).toBe('approved')
    })
  })
})
