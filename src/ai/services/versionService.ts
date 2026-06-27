/**
 * AI 生成物版本服务
 *
 * 提供版本的 CRUD 操作，支持自动版本号递增。
 */

import { v4 as uuidv4 } from 'uuid'
import { AIVersionModel, type IAIVersion } from '../models/version.js'

/**
 * 创建新版本
 *
 * 自动获取当前对话的最大版本号并递增。
 */
export async function createVersion(params: {
  conversationId: string
  messageId: string
  type: 'schema' | 'flow'
  content: Record<string, unknown>[] | Record<string, unknown>
  description?: string
}): Promise<IAIVersion> {
  const maxVersionDoc = await AIVersionModel.findOne({ conversationId: params.conversationId })
    .sort({ version: -1 })
    .select('version')

  const nextVersion = ((maxVersionDoc?.version as number) ?? 0) + 1

  return AIVersionModel.create({
    _id: uuidv4(),
    conversationId: params.conversationId,
    messageId: params.messageId,
    type: params.type,
    content: params.content,
    version: nextVersion,
    description: params.description,
  })
}

/**
 * 获取对话的所有版本（按版本号降序）
 */
export async function getVersions(conversationId: string): Promise<IAIVersion[]> {
  return AIVersionModel.find({ conversationId })
    .sort({ version: -1 })
}

/**
 * 获取单个版本
 */
export async function getVersion(id: string): Promise<IAIVersion | null> {
  return AIVersionModel.findById(id)
}

/**
 * 删除对话的所有版本
 */
export async function deleteVersionsByConversation(conversationId: string): Promise<number> {
  const result = await AIVersionModel.deleteMany({ conversationId })
  return result.deletedCount
}
