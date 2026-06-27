/**
 * Parallel Gateway Deadlock Timeout Tests
 *
 * Tests the join timeout mechanism that prevents deadlock when a parallel
 * gateway branch fails to complete:
 *
 * 1. Tokens record waitingSince when entering waiting state at join
 * 2. checkJoinTimeouts detects expired tokens in advance()
 * 3. Instances are marked 'failed' when timeout is exceeded
 * 4. checkParallelGatewayTimeouts() scans all running instances
 * 5. Edge cases: no timeout configured, zero timeout, boundary conditions
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BpmnElementType } from '@schema-form/flow-shared'
import type { FlowToken, FlowGraph, FlowNodeData, FlowEdgeData } from '@schema-form/flow-shared'

// ── Mock all Mongoose models ──

vi.mock('../../flow-models/FlowInstance.js', () => ({
  FlowInstanceModel: {
    findById: vi.fn(),
    find: vi.fn(),
  },
}))

vi.mock('../../flow-models/FlowVersion.js', () => ({
  FlowVersionModel: {
    findById: vi.fn(),
  },
}))

vi.mock('../../flow-models/FlowDefinition.js', () => ({
  FlowDefinitionModel: {
    findById: vi.fn(),
  },
}))

vi.mock('../../flow-models/TaskInstance.js', () => ({
  TaskInstanceModel: {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('../../flow-models/TimerJob.js', () => ({
  TimerJobModel: {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    findById: vi.fn(),
  },
}))

vi.mock('../../flow-models/ApprovalLog.js', () => ({
  ApprovalLogModel: {
    create: vi.fn(),
  },
}))

vi.mock('../TimerService.js', () => ({
  parseTimerValue: vi.fn(),
}))

vi.mock('../MessageQueue.js', () => ({
  messageQueue: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../NotificationService.js', () => ({
  notificationService: {
    sendNotification: vi.fn().mockResolvedValue(undefined),
    sendBatchNotifications: vi.fn().mockResolvedValue(undefined),
    createTaskAssignedNotification: vi.fn().mockResolvedValue(undefined),
    createTaskRejectedNotification: vi.fn().mockResolvedValue(undefined),
    createFlowCompletedNotification: vi.fn().mockResolvedValue(undefined),
  },
}))

import { FlowEngine } from '../FlowEngine.js'
import { FlowInstanceModel } from '../../flow-models/FlowInstance.js'
import { FlowVersionModel } from '../../flow-models/FlowVersion.js'

// ── Helpers ──

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

function eg(id: string, source: string, target: string, data: Record<string, unknown> = {}): FlowEdgeData {
  return {
    id,
    shape: 'bpmn-edge',
    source: { cell: source },
    target: { cell: target },
    data: { label: id, ...data },
  }
}

function createMockInstance(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'inst-1',
    definitionId: 'def-1',
    versionId: 'ver-1',
    version: '1',
    status: 'running',
    variables: {},
    tokens: [] as FlowToken[],
    initiatedBy: 'user-1',
    startedAt: new Date(),
    completedAt: undefined as Date | undefined,
    parentInstanceId: null,
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function createMockVersion(joinTimeout?: number) {
  const graph: FlowGraph = {
    nodes: [
      nd('start', BpmnElementType.StartEvent),
      nd('gw-fork', BpmnElementType.ParallelGateway),
      nd('task-a', BpmnElementType.UserTask, { assignee: 'user1', assigneeType: 'user', candidateUsers: ['user1'] }),
      nd('task-b', BpmnElementType.UserTask, { assignee: 'user2', assigneeType: 'user', candidateUsers: ['user2'] }),
      nd('gw-join', BpmnElementType.ParallelGateway, { joinTimeout }),
      nd('end', BpmnElementType.EndEvent),
    ],
    edges: [
      eg('e1', 'start', 'gw-fork'),
      eg('e2', 'gw-fork', 'task-a'),
      eg('e3', 'gw-fork', 'task-b'),
      eg('e4', 'task-a', 'gw-join'),
      eg('e5', 'task-b', 'gw-join'),
      eg('e6', 'gw-join', 'end'),
    ],
  }

  return {
    _id: 'ver-1',
    definitionId: 'def-1',
    version: '1',
    graph,
    metadata: {},
  }
}

function mockFind(result: unknown[]) {
  const chainable = {
    limit: vi.fn().mockResolvedValue(result),
  }
  vi.mocked(FlowInstanceModel.find).mockReturnValue(chainable as never)
  return chainable
}

let engine: FlowEngine

beforeEach(() => {
  vi.clearAllMocks()
  engine = new FlowEngine()
})

// ─────────────────────────────────────
// 1. Token waitingSince tracking
// ─────────────────────────────────────

describe('Token waitingSince tracking', () => {
  it('records waitingSince when token enters waiting at parallel gateway join', async () => {
    const tokenA: FlowToken = {
      tokenId: 'tok-a',
      nodeId: 'gw-join',
      state: 'active',
      createdAt: new Date(),
    }
    const tokenB: FlowToken = {
      tokenId: 'tok-b',
      nodeId: 'task-b',
      state: 'active',
      createdAt: new Date(),
    }

    const instance = createMockInstance({ tokens: [tokenA, tokenB] })
    vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(30) as never)
    mockFind([])

    // Mock TaskInstance for task-b (UserTask)
    const { TaskInstanceModel } = await import('../../flow-models/TaskInstance.js')
    vi.mocked(TaskInstanceModel.findOne).mockResolvedValue(null)
    vi.mocked(TaskInstanceModel.find).mockResolvedValue([])
    vi.mocked(TaskInstanceModel.create).mockResolvedValue({} as never)

    await engine.advance('inst-1')

    expect(tokenA.state).toBe('waiting')
    expect(tokenA.waitingSince).toBeInstanceOf(Date)
  })

  it('preserves existing waitingSince on subsequent advances', async () => {
    const originalTime = new Date('2026-01-01T10:00:00Z')
    const tokenA: FlowToken = {
      tokenId: 'tok-a',
      nodeId: 'gw-join',
      state: 'waiting',
      createdAt: new Date(),
      waitingSince: originalTime,
    }
    const tokenB: FlowToken = {
      tokenId: 'tok-b',
      nodeId: 'task-b',
      state: 'waiting',
      createdAt: new Date(),
    }

    const instance = createMockInstance({ tokens: [tokenA, tokenB] })
    vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(60) as never)
    mockFind([])

    await engine.advance('inst-1')

    // waitingSince should be preserved (not overwritten)
    expect(tokenA.waitingSince).toEqual(originalTime)
  })

  it('does not set waitingSince on non-gateway waiting tokens', async () => {
    const tokenA: FlowToken = {
      tokenId: 'tok-a',
      nodeId: 'task-a',
      state: 'active',
      createdAt: new Date(),
    }

    const instance = createMockInstance({ tokens: [tokenA] })
    vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(30) as never)

    const { TaskInstanceModel } = await import('../../flow-models/TaskInstance.js')
    vi.mocked(TaskInstanceModel.findOne).mockResolvedValue(null)
    vi.mocked(TaskInstanceModel.create).mockResolvedValue({} as never)

    await engine.advance('inst-1')

    // task-a token becomes waiting (UserTask) but no waitingSince for non-gateway
    expect(tokenA.state).toBe('waiting')
    expect(tokenA.waitingSince).toBeUndefined()
  })
})

// ─────────────────────────────────────
// 2. checkJoinTimeouts in advance()
// ─────────────────────────────────────

describe('checkJoinTimeouts in advance()', () => {
  it('fails instance when join timeout is exceeded', async () => {
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000)
    const tokenA: FlowToken = {
      tokenId: 'tok-a',
      nodeId: 'gw-join',
      state: 'waiting',
      createdAt: new Date(),
      waitingSince: sixtyMinutesAgo,
    }
    const tokenB: FlowToken = {
      tokenId: 'tok-b',
      nodeId: 'task-b',
      state: 'active',
      createdAt: new Date(),
    }

    const instance = createMockInstance({ tokens: [tokenA, tokenB] })
    vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(30) as never)
    mockFind([])

    await engine.advance('inst-1')

    expect(instance.status).toBe('failed')
    expect(instance.completedAt).toBeInstanceOf(Date)
    expect(instance.save).toHaveBeenCalled()
  })

  it('does not fail when timeout is not exceeded', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    const tokenA: FlowToken = {
      tokenId: 'tok-a',
      nodeId: 'gw-join',
      state: 'waiting',
      createdAt: new Date(),
      waitingSince: tenMinutesAgo,
    }
    const tokenB: FlowToken = {
      tokenId: 'tok-b',
      nodeId: 'task-b',
      state: 'active',
      createdAt: new Date(),
    }

    const instance = createMockInstance({ tokens: [tokenA, tokenB] })
    vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(30) as never)

    const { TaskInstanceModel } = await import('../../flow-models/TaskInstance.js')
    vi.mocked(TaskInstanceModel.findOne).mockResolvedValue(null)
    vi.mocked(TaskInstanceModel.find).mockResolvedValue([])
    vi.mocked(TaskInstanceModel.create).mockResolvedValue({} as never)

    await engine.advance('inst-1')

    expect(instance.status).not.toBe('failed')
  })

  it('does not apply timeout when joinTimeout is 0', async () => {
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000)
    const tokenA: FlowToken = {
      tokenId: 'tok-a',
      nodeId: 'gw-join',
      state: 'waiting',
      createdAt: new Date(),
      waitingSince: sixtyMinutesAgo,
    }
    const tokenB: FlowToken = {
      tokenId: 'tok-b',
      nodeId: 'task-b',
      state: 'active',
      createdAt: new Date(),
    }

    const instance = createMockInstance({ tokens: [tokenA, tokenB] })
    vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(0) as never)

    const { TaskInstanceModel } = await import('../../flow-models/TaskInstance.js')
    vi.mocked(TaskInstanceModel.findOne).mockResolvedValue(null)
    vi.mocked(TaskInstanceModel.find).mockResolvedValue([])
    vi.mocked(TaskInstanceModel.create).mockResolvedValue({} as never)

    await engine.advance('inst-1')

    expect(instance.status).not.toBe('failed')
  })

  it('does not apply timeout when joinTimeout is undefined', async () => {
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000)
    const tokenA: FlowToken = {
      tokenId: 'tok-a',
      nodeId: 'gw-join',
      state: 'waiting',
      createdAt: new Date(),
      waitingSince: sixtyMinutesAgo,
    }

    const instance = createMockInstance({ tokens: [tokenA] })
    vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
    // createMockVersion() with no argument = undefined joinTimeout
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion() as never)

    const { TaskInstanceModel } = await import('../../flow-models/TaskInstance.js')
    vi.mocked(TaskInstanceModel.findOne).mockResolvedValue(null)
    vi.mocked(TaskInstanceModel.find).mockResolvedValue([])
    vi.mocked(TaskInstanceModel.create).mockResolvedValue({} as never)

    await engine.advance('inst-1')

    expect(instance.status).not.toBe('failed')
  })

  it('fails instance at exact timeout boundary', async () => {
    // Token has been waiting exactly 30 minutes (= timeout)
    const exactlyThirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)
    const tokenA: FlowToken = {
      tokenId: 'tok-a',
      nodeId: 'gw-join',
      state: 'waiting',
      createdAt: new Date(),
      waitingSince: exactlyThirtyMinutesAgo,
    }

    const instance = createMockInstance({ tokens: [tokenA] })
    vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(30) as never)
    mockFind([])

    await engine.advance('inst-1')

    // elapsedMinutes >= joinTimeout -> should fail
    expect(instance.status).toBe('failed')
  })

  it('does not fail just before timeout boundary', async () => {
    // Token has been waiting 29.9 minutes (< 30 min timeout)
    const justBeforeTimeout = new Date(Date.now() - 29.9 * 60 * 1000)
    const tokenA: FlowToken = {
      tokenId: 'tok-a',
      nodeId: 'gw-join',
      state: 'waiting',
      createdAt: new Date(),
      waitingSince: justBeforeTimeout,
    }
    const tokenB: FlowToken = {
      tokenId: 'tok-b',
      nodeId: 'task-b',
      state: 'active',
      createdAt: new Date(),
    }

    const instance = createMockInstance({ tokens: [tokenA, tokenB] })
    vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(30) as never)

    const { TaskInstanceModel } = await import('../../flow-models/TaskInstance.js')
    vi.mocked(TaskInstanceModel.findOne).mockResolvedValue(null)
    vi.mocked(TaskInstanceModel.find).mockResolvedValue([])
    vi.mocked(TaskInstanceModel.create).mockResolvedValue({} as never)

    await engine.advance('inst-1')

    expect(instance.status).not.toBe('failed')
  })

  it('fails when both tokens are waiting and timed out', async () => {
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000)
    const tokenA: FlowToken = {
      tokenId: 'tok-a',
      nodeId: 'gw-join',
      state: 'waiting',
      createdAt: new Date(),
      waitingSince: sixtyMinutesAgo,
    }
    const tokenB: FlowToken = {
      tokenId: 'tok-b',
      nodeId: 'gw-join',
      state: 'waiting',
      createdAt: new Date(),
      waitingSince: sixtyMinutesAgo,
    }

    const instance = createMockInstance({ tokens: [tokenA, tokenB] })
    vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(30) as never)
    mockFind([])

    await engine.advance('inst-1')

    expect(instance.status).toBe('failed')
    expect(instance.completedAt).toBeInstanceOf(Date)
  })

  it('skips tokens without waitingSince', async () => {
    const tokenA: FlowToken = {
      tokenId: 'tok-a',
      nodeId: 'gw-join',
      state: 'waiting',
      createdAt: new Date(),
      // no waitingSince
    }

    const instance = createMockInstance({ tokens: [tokenA] })
    vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(30) as never)

    const { TaskInstanceModel } = await import('../../flow-models/TaskInstance.js')
    vi.mocked(TaskInstanceModel.findOne).mockResolvedValue(null)
    vi.mocked(TaskInstanceModel.find).mockResolvedValue([])
    vi.mocked(TaskInstanceModel.create).mockResolvedValue({} as never)

    await engine.advance('inst-1')

    // No waitingSince -> skip timeout check
    expect(instance.status).not.toBe('failed')
  })

  it('ignores waiting tokens at non-ParallelGateway nodes', async () => {
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000)
    const tokenA: FlowToken = {
      tokenId: 'tok-a',
      nodeId: 'task-a',
      state: 'waiting',
      createdAt: new Date(),
      waitingSince: sixtyMinutesAgo,
    }

    const instance = createMockInstance({ tokens: [tokenA] })
    vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(30) as never)

    const { TaskInstanceModel } = await import('../../flow-models/TaskInstance.js')
    vi.mocked(TaskInstanceModel.findOne).mockResolvedValue(null)
    vi.mocked(TaskInstanceModel.find).mockResolvedValue([])
    vi.mocked(TaskInstanceModel.create).mockResolvedValue({} as never)

    await engine.advance('inst-1')

    // task-a is a UserTask, not a ParallelGateway -> no timeout
    expect(instance.status).not.toBe('failed')
  })

  it('completes join successfully when both tokens arrive before timeout', async () => {
    const tokenA: FlowToken = {
      tokenId: 'tok-a',
      nodeId: 'gw-join',
      state: 'active',
      createdAt: new Date(),
    }
    const tokenB: FlowToken = {
      tokenId: 'tok-b',
      nodeId: 'gw-join',
      state: 'active',
      createdAt: new Date(),
    }

    const instance = createMockInstance({ tokens: [tokenA, tokenB] })
    vi.mocked(FlowInstanceModel.findById).mockResolvedValue(instance as never)
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(30) as never)
    mockFind([])

    await engine.advance('inst-1')

    // Both tokens at join -> merge -> new token at end -> completed
    const endTokens = instance.tokens.filter((t: FlowToken) => t.nodeId === 'end')
    expect(endTokens.length).toBeGreaterThanOrEqual(1)
  })
})

// ─────────────────────────────────────
// 3. checkParallelGatewayTimeouts() scan
// ─────────────────────────────────────

describe('checkParallelGatewayTimeouts()', () => {
  it('fails instances with timed-out parallel gateway joins', async () => {
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000)
    const mockInstance = createMockInstance({
      tokens: [{
        tokenId: 'tok-a',
        nodeId: 'gw-join',
        state: 'waiting',
        createdAt: new Date(),
        waitingSince: sixtyMinutesAgo,
      }],
    })

    mockFind([mockInstance])
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(30) as never)

    const result = await engine.checkParallelGatewayTimeouts()

    expect(result.checked).toBe(1)
    expect(result.timedOut).toBe(1)
    expect(mockInstance.status).toBe('failed')
    expect(mockInstance.save).toHaveBeenCalled()
  })

  it('skips instances where timeout is not exceeded', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    const mockInstance = createMockInstance({
      tokens: [{
        tokenId: 'tok-a',
        nodeId: 'gw-join',
        state: 'waiting',
        createdAt: new Date(),
        waitingSince: tenMinutesAgo,
      }],
    })

    mockFind([mockInstance])
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(30) as never)

    const result = await engine.checkParallelGatewayTimeouts()

    expect(result.checked).toBe(1)
    expect(result.timedOut).toBe(0)
    expect(mockInstance.status).toBe('running')
  })

  it('skips instances where joinTimeout is not configured', async () => {
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000)
    const mockInstance = createMockInstance({
      tokens: [{
        tokenId: 'tok-a',
        nodeId: 'gw-join',
        state: 'waiting',
        createdAt: new Date(),
        waitingSince: sixtyMinutesAgo,
      }],
    })

    mockFind([mockInstance])
    // undefined joinTimeout
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion() as never)

    const result = await engine.checkParallelGatewayTimeouts()

    expect(result.timedOut).toBe(0)
    expect(mockInstance.status).toBe('running')
  })

  it('handles empty running instances', async () => {
    mockFind([])

    const result = await engine.checkParallelGatewayTimeouts()

    expect(result.checked).toBe(0)
    expect(result.timedOut).toBe(0)
  })

  it('processes multiple instances correctly', async () => {
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)

    const timedOutInstance = createMockInstance({
      _id: 'inst-timed-out',
      tokens: [{
        tokenId: 'tok-a',
        nodeId: 'gw-join',
        state: 'waiting',
        createdAt: new Date(),
        waitingSince: sixtyMinutesAgo,
      }],
    })
    const okInstance = createMockInstance({
      _id: 'inst-ok',
      tokens: [{
        tokenId: 'tok-b',
        nodeId: 'gw-join',
        state: 'waiting',
        createdAt: new Date(),
        waitingSince: tenMinutesAgo,
      }],
    })

    mockFind([timedOutInstance, okInstance])
    vi.mocked(FlowVersionModel.findById).mockResolvedValue(createMockVersion(30) as never)

    const result = await engine.checkParallelGatewayTimeouts()

    expect(result.checked).toBe(2)
    expect(result.timedOut).toBe(1)
    expect(timedOutInstance.status).toBe('failed')
    expect(okInstance.status).toBe('running')
  })
})
