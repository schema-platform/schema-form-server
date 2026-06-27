import { EventEmitter } from 'node:events'
import { v4 as uuidv4 } from 'uuid'
import { FlowMessageModel } from '../flow-models/FlowMessage.js'
import type { IFlowMessage } from '../flow-models/FlowMessage.js'

export interface SendMessageInput {
  channel: string
  payload: Record<string, unknown>
  senderInstanceId: string
  senderNodeId: string
}

export interface ConsumeMessageInput {
  channel: string
  receiverInstanceId: string
  receiverNodeId: string
}

/**
 * MessageQueue provides channel-based pub/sub for flow SendTask/ReceiveTask.
 *
 * Architecture:
 * - MongoDB (FlowMessage) for persistence — survives restarts, handles race conditions
 * - EventEmitter for real-time in-process notification
 *
 * When SendTask sends a message:
 *   1. Persist to FlowMessage collection
 *   2. Emit event so any in-memory ReceiveTask listeners wake up
 *
 * When ReceiveTask needs a message:
 *   1. Check FlowMessage for existing unconsumed messages on the channel
 *   2. If found: consume immediately
 *   3. If not found: register an in-memory listener for real-time delivery
 */
export class MessageQueue {
  private emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(200)
  }

  /**
   * Send a message to a channel.
   * Persists to DB, then notifies any in-memory subscribers.
   */
  async send(input: SendMessageInput): Promise<IFlowMessage> {
    const message = await FlowMessageModel.create({
      _id: uuidv4(),
      channel: input.channel,
      payload: input.payload,
      senderInstanceId: input.senderInstanceId,
      senderNodeId: input.senderNodeId,
      status: 'pending',
    })

    // Notify any in-memory listeners
    this.emitter.emit(`channel:${input.channel}`, message)

    return message
  }

  /**
   * Try to consume a pending message from a channel.
   * Returns the consumed message, or null if no message available.
   */
  async tryConsume(input: ConsumeMessageInput): Promise<IFlowMessage | null> {
    const message = await FlowMessageModel.findOneAndUpdate(
      {
        channel: input.channel,
        status: 'pending',
      },
      {
        $set: {
          status: 'consumed',
          receiverInstanceId: input.receiverInstanceId,
          receiverNodeId: input.receiverNodeId,
        },
      },
      { new: true, sort: { createdAt: 1 } },
    )

    return message
  }

  /**
   * Subscribe to a channel for real-time message delivery.
   * Returns an unsubscribe function.
   */
  subscribe(
    channel: string,
    handler: (message: IFlowMessage) => void,
  ): () => void {
    const wrappedHandler = (message: IFlowMessage) => {
      handler(message)
    }
    this.emitter.on(`channel:${channel}`, wrappedHandler)
    return () => {
      this.emitter.off(`channel:${channel}`, wrappedHandler)
    }
  }

  /**
   * Get pending message count for a channel.
   */
  async getPendingCount(channel: string): Promise<number> {
    return FlowMessageModel.countDocuments({ channel, status: 'pending' })
  }

  /**
   * Get all pending messages for a channel (for debugging / monitoring).
   */
  async getPendingMessages(channel: string): Promise<IFlowMessage[]> {
    return FlowMessageModel.find({ channel, status: 'pending' })
      .sort({ createdAt: 1 })
  }
}

export const messageQueue = new MessageQueue()
