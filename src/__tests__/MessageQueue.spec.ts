/**
 * MessageQueue Service Unit Tests
 *
 * Tests the channel-based pub/sub message queue for flow SendTask/ReceiveTask.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock FlowMessageModel ──

const mockFlowMessageCreate = vi.fn()
const mockFlowMessageFindOneAndUpdate = vi.fn()
const mockFlowMessageCountDocuments = vi.fn()
const mockFlowMessageFind = vi.fn()

vi.mock('../flow-models/FlowMessage.js', () => ({
  FlowMessageModel: {
    create: mockFlowMessageCreate,
    findOneAndUpdate: mockFlowMessageFindOneAndUpdate,
    countDocuments: mockFlowMessageCountDocuments,
    find: mockFlowMessageFind,
  },
}))

// Import after mocks
const { MessageQueue } = await import('../flow-services/MessageQueue.js')

describe('MessageQueue', () => {
  let queue: InstanceType<typeof MessageQueue>

  beforeEach(() => {
    vi.clearAllMocks()
    queue = new MessageQueue()
    mockFlowMessageFind.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── send ──

  describe('send', () => {
    it('persists message to FlowMessageModel and returns it', async () => {
      const mockMessage = {
        _id: 'msg1',
        channel: 'order-approved',
        payload: { orderId: '123' },
        senderInstanceId: 'inst1',
        senderNodeId: 'node1',
        status: 'pending',
      }
      mockFlowMessageCreate.mockResolvedValue(mockMessage)

      const result = await queue.send({
        channel: 'order-approved',
        payload: { orderId: '123' },
        senderInstanceId: 'inst1',
        senderNodeId: 'node1',
      })

      expect(mockFlowMessageCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'order-approved',
          payload: { orderId: '123' },
          senderInstanceId: 'inst1',
          senderNodeId: 'node1',
          status: 'pending',
        }),
      )
      expect(result).toEqual(mockMessage)
    })

    it('emits event to in-memory subscribers', async () => {
      const mockMessage = {
        _id: 'msg1',
        channel: 'test-channel',
        payload: { data: 'hello' },
        senderInstanceId: 'inst1',
        senderNodeId: 'node1',
        status: 'pending',
      }
      mockFlowMessageCreate.mockResolvedValue(mockMessage)

      const handler = vi.fn()
      queue.subscribe('test-channel', handler)

      await queue.send({
        channel: 'test-channel',
        payload: { data: 'hello' },
        senderInstanceId: 'inst1',
        senderNodeId: 'node1',
      })

      expect(handler).toHaveBeenCalledWith(mockMessage)
    })

    it('does not emit to subscribers on other channels', async () => {
      const mockMessage = {
        _id: 'msg1',
        channel: 'channel-a',
        payload: {},
        senderInstanceId: 'inst1',
        senderNodeId: 'node1',
        status: 'pending',
      }
      mockFlowMessageCreate.mockResolvedValue(mockMessage)

      const handlerA = vi.fn()
      const handlerB = vi.fn()
      queue.subscribe('channel-a', handlerA)
      queue.subscribe('channel-b', handlerB)

      await queue.send({
        channel: 'channel-a',
        payload: {},
        senderInstanceId: 'inst1',
        senderNodeId: 'node1',
      })

      expect(handlerA).toHaveBeenCalledTimes(1)
      expect(handlerB).not.toHaveBeenCalled()
    })
  })

  // ── tryConsume ──

  describe('tryConsume', () => {
    it('atomically finds and consumes the oldest pending message', async () => {
      const mockMessage = {
        _id: 'msg1',
        channel: 'test-channel',
        payload: { data: 'hello' },
        status: 'consumed',
        receiverInstanceId: 'inst2',
        receiverNodeId: 'node2',
      }
      mockFlowMessageFindOneAndUpdate.mockResolvedValue(mockMessage)

      const result = await queue.tryConsume({
        channel: 'test-channel',
        receiverInstanceId: 'inst2',
        receiverNodeId: 'node2',
      })

      expect(mockFlowMessageFindOneAndUpdate).toHaveBeenCalledWith(
        { channel: 'test-channel', status: 'pending' },
        { $set: { status: 'consumed', receiverInstanceId: 'inst2', receiverNodeId: 'node2' } },
        { new: true, sort: { createdAt: 1 } },
      )
      expect(result).toEqual(mockMessage)
    })

    it('returns null when no pending messages exist', async () => {
      mockFlowMessageFindOneAndUpdate.mockResolvedValue(null)

      const result = await queue.tryConsume({
        channel: 'empty-channel',
        receiverInstanceId: 'inst2',
        receiverNodeId: 'node2',
      })

      expect(result).toBeNull()
    })
  })

  // ── subscribe / unsubscribe ──

  describe('subscribe', () => {
    it('registers a handler that receives messages', async () => {
      const handler = vi.fn()
      queue.subscribe('my-channel', handler)

      const mockMessage = { _id: 'msg1', channel: 'my-channel' }
      mockFlowMessageCreate.mockResolvedValue(mockMessage)

      await queue.send({
        channel: 'my-channel',
        payload: {},
        senderInstanceId: 'inst1',
        senderNodeId: 'node1',
      })

      expect(handler).toHaveBeenCalledWith(mockMessage)
    })

    it('returns an unsubscribe function', async () => {
      const handler = vi.fn()
      const unsubscribe = queue.subscribe('my-channel', handler)

      unsubscribe()

      const mockMessage = { _id: 'msg1', channel: 'my-channel' }
      mockFlowMessageCreate.mockResolvedValue(mockMessage)

      await queue.send({
        channel: 'my-channel',
        payload: {},
        senderInstanceId: 'inst1',
        senderNodeId: 'node1',
      })

      expect(handler).not.toHaveBeenCalled()
    })

    it('supports multiple subscribers on the same channel', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      queue.subscribe('shared-channel', handler1)
      queue.subscribe('shared-channel', handler2)

      const mockMessage = { _id: 'msg1', channel: 'shared-channel' }
      mockFlowMessageCreate.mockResolvedValue(mockMessage)

      await queue.send({
        channel: 'shared-channel',
        payload: {},
        senderInstanceId: 'inst1',
        senderNodeId: 'node1',
      })

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
    })
  })

  // ── getPendingCount ──

  describe('getPendingCount', () => {
    it('returns count of pending messages', async () => {
      mockFlowMessageCountDocuments.mockResolvedValue(3)

      const count = await queue.getPendingCount('test-channel')

      expect(count).toBe(3)
      expect(mockFlowMessageCountDocuments).toHaveBeenCalledWith({
        channel: 'test-channel',
        status: 'pending',
      })
    })
  })

  // ── getPendingMessages ──

  describe('getPendingMessages', () => {
    it('returns sorted pending messages', async () => {
      const messages = [
        { _id: 'msg1', channel: 'ch1', status: 'pending' },
        { _id: 'msg2', channel: 'ch1', status: 'pending' },
      ]
      const sortFn = vi.fn().mockResolvedValue(messages)
      mockFlowMessageFind.mockReturnValue({ sort: sortFn })

      const result = await queue.getPendingMessages('ch1')

      expect(result).toEqual(messages)
      expect(mockFlowMessageFind).toHaveBeenCalledWith({ channel: 'ch1', status: 'pending' })
      expect(sortFn).toHaveBeenCalledWith({ createdAt: 1 })
    })
  })
})
