/**
 * Message Sync Service
 *
 * Handles real-time message synchronization between collaboration participants.
 * Uses Socket.io to broadcast SSE events to all users in a conversation room.
 */

import { getIO } from '../../socket.js'

// ────────────────────────────────────────────
// SSE event types
// ────────────────────────────────────────────

export type SSEEventType =
  | 'message_delta'
  | 'message_complete'
  | 'tool_start'
  | 'tool_end'
  | 'error'
  | 'done'

export interface SSEEvent {
  type: SSEEventType
  data: Record<string, unknown>
}

// ────────────────────────────────────────────
// Message status types
// ────────────────────────────────────────────

export type MessageStatus = 'sending' | 'sent' | 'streaming' | 'received' | 'error'

export interface MessageStatusUpdate {
  conversationId: string
  messageIndex: number
  status: MessageStatus
  error?: string
}

// ────────────────────────────────────────────
// Broadcast functions
// ────────────────────────────────────────────

/**
 * Broadcast an SSE event to all collaboration participants in a conversation room.
 *
 * The sender (initiating the SSE stream) will receive events directly via SSE.
 * This function broadcasts to OTHER participants via Socket.io.
 */
export function broadcastSSEEvent(
  conversationId: string,
  event: SSEEvent,
  excludeSocketId?: string,
): void {
  const io = getIO()
  if (!io) return

  const room = `collab:${conversationId}`

  // Broadcast to room, excluding the sender if socketId provided
  if (excludeSocketId) {
    io.to(room).except(excludeSocketId).emit('collab:ai-sync', {
      conversationId,
      event,
    })
  } else {
    io.to(room).emit('collab:ai-sync', {
      conversationId,
      event,
    })
  }
}

/**
 * Broadcast message status update to collaboration participants.
 */
export function broadcastMessageStatus(
  conversationId: string,
  update: MessageStatusUpdate,
): void {
  const io = getIO()
  if (!io) return

  const room = `collab:${conversationId}`
  io.to(room).emit('collab:message-status', update)
}

/**
 * Broadcast that a new message is being generated.
 * Used to show "typing" or "generating" indicators to other participants.
 */
export function broadcastGenerationStart(
  conversationId: string,
  userMessage: string,
): void {
  const io = getIO()
  if (!io) return

  const room = `collab:${conversationId}`
  io.to(room).emit('collab:generation-start', {
    conversationId,
    userMessage,
    timestamp: new Date(),
  })
}

/**
 * Broadcast that generation has completed.
 */
export function broadcastGenerationEnd(
  conversationId: string,
  success: boolean,
): void {
  const io = getIO()
  if (!io) return

  const room = `collab:${conversationId}`
  io.to(room).emit('collab:generation-end', {
    conversationId,
    success,
    timestamp: new Date(),
  })
}
