/**
 * AI Chat WebSocket handler
 *
 * 监听 socket 事件，桥接到 chatStreamRunner 核心逻辑。
 * 复用 shared/socket 连接，不创建新的 HTTP 连接。
 */

import type { Socket, Server } from 'socket.io'
import {
  executeChatStream,
  executeResumeStream,
  getInterruptedThread,
  clearInterruptedThread,
  type ChatRequest,
  type StreamHandle,
} from './chatStreamRunner.js'
import { logger } from '../utils/logger.js'

/** 每个 socket 的活跃流，用于断连时清理 */
const activeStreams = new Map<string, StreamHandle>()

/**
 * 注册 AI Chat 相关的 socket 事件。
 * 在 io.on('connection') 中调用。
 */
export function registerChatHandlers(socket: Socket, _io: Server): void {
  const socketId = socket.id

  // ── chat:send — 发送消息，启动流式响应 ──
  socket.on('chat:send', (data: ChatRequest) => {
    logger.info({ msg: `[WS:chat] chat:send from ${socketId}`, conversationId: data.conversationId ?? 'new' })

    // 取消该 socket 上的活跃流
    const existing = activeStreams.get(socketId)
    if (existing) {
      existing.abort()
      activeStreams.delete(socketId)
    }

    const threadId = data.conversationId ?? `ws-${socketId}-${Date.now()}`
    socket.join(`chat:${threadId}`)

    const handle = executeChatStream(
      data,
      (event) => {
        if (socket.connected) {
          socket.emit('chat:event', { threadId, ...event })
        }
      },
      () => {
        activeStreams.delete(socketId)
        socket.leave(`chat:${threadId}`)
      },
    )

    activeStreams.set(socketId, handle)

    handle.promise.catch((err) => {
      logger.error({ msg: `[WS:chat] Stream error for ${socketId}`, error: err.message })
      activeStreams.delete(socketId)
    })
  })

  // ── chat:cancel — 取消当前流 ──
  socket.on('chat:cancel', (_data: { threadId?: string } = {}) => {
    logger.info({ msg: `[WS:chat] chat:cancel from ${socketId}` })
    const handle = activeStreams.get(socketId)
    if (handle) {
      handle.abort()
      activeStreams.delete(socketId)
    }
  })

  // ── chat:resume — HITL 恢复 ──
  socket.on('chat:resume', (data: { threadId: string; confirmed: boolean }) => {
    logger.info({ msg: `[WS:chat] chat:resume from ${socketId}`, threadId: data.threadId, confirmed: data.confirmed })

    const interrupted = getInterruptedThread(data.threadId)
    if (!interrupted) {
      socket.emit('chat:event', {
        threadId: data.threadId,
        type: 'error',
        content: 'No interrupted thread found',
      })
      return
    }

    clearInterruptedThread(data.threadId)
    socket.join(`chat:${data.threadId}`)

    const handle = executeResumeStream(
      data.threadId,
      data.confirmed,
      (event) => {
        if (socket.connected) {
          socket.emit('chat:event', { threadId: data.threadId, ...event })
        }
      },
      () => {
        activeStreams.delete(socketId)
        socket.leave(`chat:${data.threadId}`)
      },
    )

    activeStreams.set(socketId, handle)

    handle.promise.catch((err) => {
      logger.error({ msg: `[WS:chat] Resume error for ${socketId}`, error: err.message })
      activeStreams.delete(socketId)
    })
  })

  // ── 断连时清理活跃流 ──
  socket.on('disconnect', () => {
    const handle = activeStreams.get(socketId)
    if (handle) {
      handle.abort()
      activeStreams.delete(socketId)
      logger.info({ msg: `[WS:chat] Aborted stream for disconnected socket ${socketId}` })
    }
  })
}
