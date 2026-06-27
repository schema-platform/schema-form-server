/**
 * Collaboration Service
 *
 * Manages real-time collaboration sessions for AI conversations.
 * Handles participant tracking, message broadcasting, and session persistence.
 */

import { v4 as uuidv4 } from 'uuid'
import { CollaborationSessionModel, type ICollaborationSession } from '../models/collaboration.js'

// ────────────────────────────────────────────
// In-memory participant tracking
// ────────────────────────────────────────────

/** Map<conversationId, Map<socketId, userId>> */
const activeSessions = new Map<string, Map<string, string>>()

// ────────────────────────────────────────────
// Service functions
// ────────────────────────────────────────────

/**
 * Add a participant to a collaboration session.
 * Creates a DB record if this is the first participant.
 * Returns the updated participant list.
 */
export async function joinSession(
  conversationId: string,
  socketId: string,
  userId: string,
): Promise<string[]> {
  // In-memory tracking
  if (!activeSessions.has(conversationId)) {
    activeSessions.set(conversationId, new Map())
  }
  activeSessions.get(conversationId)!.set(socketId, userId)

  // Persist to DB (upsert)
  await CollaborationSessionModel.findOneAndUpdate(
    { conversationId },
    {
      $addToSet: { participants: userId },
      $setOnInsert: { _id: uuidv4(), conversationId },
    },
    { upsert: true, new: true },
  )

  return getParticipants(conversationId)
}

/**
 * Remove a participant from a collaboration session.
 * Returns the updated participant list.
 */
export async function leaveSession(
  conversationId: string,
  socketId: string,
): Promise<string[]> {
  const session = activeSessions.get(conversationId)
  if (session) {
    session.delete(socketId)
    if (session.size === 0) {
      activeSessions.delete(conversationId)
    }
  }

  return getParticipants(conversationId)
}

/**
 * Handle socket disconnect: remove from all sessions.
 * Returns affected conversationIds.
 */
export function handleDisconnect(socketId: string): string[] {
  const affectedConversations: string[] = []

  for (const [conversationId, session] of activeSessions.entries()) {
    if (session.has(socketId)) {
      session.delete(socketId)
      if (session.size === 0) {
        activeSessions.delete(conversationId)
      }
      affectedConversations.push(conversationId)
    }
  }

  return affectedConversations
}

/**
 * Get current participant user IDs for a conversation.
 */
export function getParticipants(conversationId: string): string[] {
  const session = activeSessions.get(conversationId)
  if (!session) return []
  return [...new Set(session.values())]
}

/**
 * Get active session info for a conversation.
 */
export function getSessionInfo(conversationId: string): {
  active: boolean
  participantCount: number
  participants: string[]
} {
  const participants = getParticipants(conversationId)
  return {
    active: participants.length > 0,
    participantCount: participants.length,
    participants,
  }
}

/**
 * Get all active collaboration sessions.
 */
export function getActiveSessions(): Array<{
  conversationId: string
  participantCount: number
  participants: string[]
}> {
  const sessions: Array<{
    conversationId: string
    participantCount: number
    participants: string[]
  }> = []

  for (const [conversationId, session] of activeSessions.entries()) {
    const participants = [...new Set(session.values())]
    sessions.push({
      conversationId,
      participantCount: participants.length,
      participants,
    })
  }

  return sessions
}

/**
 * Persist a message to conversation history.
 * Returns the message object for broadcasting.
 */
export function createCollaborationMessage(
  userId: string,
  content: string,
  conversationId: string,
): {
  id: string
  userId: string
  content: string
  conversationId: string
  timestamp: Date
} {
  return {
    id: uuidv4(),
    userId,
    content,
    conversationId,
    timestamp: new Date(),
  }
}
