/**
 * FlowPersistence — MongoDB 持久化适配器
 *
 * 实现 FlowEngine 的 FlowPersistence 接口，连接 MongoDB。
 */
import { v4 as uuidv4 } from 'uuid'
import type { FlowPersistence } from '@schema-form/flow-shared'
import type {
  FlowInstanceData,
  TaskInstanceData,
  ApprovalLogEntry,
} from '@schema-form/flow-shared'
import type { FlowGraph } from '@schema-form/flow-shared'
import { FlowDefinitionModel } from '../models/FlowDefinition.js'
import { FlowInstanceModel } from '../models/FlowInstance.js'
import { TaskInstanceModel } from '../models/TaskInstance.js'
import { ApprovalLogModel } from '../models/ApprovalLog.js'

export class MongoFlowPersistence implements FlowPersistence {
  // ────── 流程定义 ──────

  async getDefinition(id: string): Promise<FlowGraph | null> {
    const doc = await FlowDefinitionModel.findOne({ id }).lean()
    if (!doc) return null
    return doc.graph as unknown as FlowGraph
  }

  // ────── 流程实例 ──────

  async createInstance(
    data: Omit<FlowInstanceData, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<FlowInstanceData> {
    const id = uuidv4()
    const doc = new FlowInstanceModel({
      id,
      ...data,
    })
    await doc.save()
    return this.toInstanceData(doc.toObject())
  }

  async getInstance(id: string): Promise<FlowInstanceData | null> {
    const doc = await FlowInstanceModel.findOne({ id }).lean()
    if (!doc) return null
    return this.toInstanceData(doc)
  }

  async updateInstance(id: string, patch: Partial<FlowInstanceData>): Promise<void> {
    await FlowInstanceModel.findOneAndUpdate({ id }, { $set: patch })
  }

  async listInstances(params?: {
    page?: number
    pageSize?: number
    status?: string
    definitionId?: string
    initiatedBy?: string
  }): Promise<{ items: FlowInstanceData[]; total: number }> {
    const { page = 1, pageSize = 20, status, definitionId, initiatedBy } = params ?? {}

    const filter: Record<string, unknown> = {}
    if (status) filter.status = status
    if (definitionId) filter.definitionId = definitionId
    if (initiatedBy) filter.initiatedBy = initiatedBy

    const [docs, total] = await Promise.all([
      FlowInstanceModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      FlowInstanceModel.countDocuments(filter),
    ])

    return {
      items: docs.map(doc => this.toInstanceData(doc)),
      total,
    }
  }

  // ────── 任务实例 ──────

  async createTask(
    data: Omit<TaskInstanceData, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<TaskInstanceData> {
    const id = uuidv4()
    const doc = new TaskInstanceModel({
      id,
      ...data,
    })
    await doc.save()
    return this.toTaskData(doc.toObject())
  }

  async getTask(id: string): Promise<TaskInstanceData | null> {
    const doc = await TaskInstanceModel.findOne({ id }).lean()
    if (!doc) return null
    return this.toTaskData(doc)
  }

  async updateTask(id: string, patch: Partial<TaskInstanceData>): Promise<void> {
    await TaskInstanceModel.findOneAndUpdate({ id }, { $set: patch })
  }

  async getTasksByInstance(instanceId: string): Promise<TaskInstanceData[]> {
    const docs = await TaskInstanceModel.find({ instanceId }).lean()
    return docs.map(doc => this.toTaskData(doc))
  }

  async listTasks(params?: {
    page?: number
    pageSize?: number
    assignee?: string
    status?: string
    search?: string
  }): Promise<{ items: TaskInstanceData[]; total: number }> {
    const { page = 1, pageSize = 20, assignee, status, search } = params ?? {}

    const filter: Record<string, unknown> = {}
    if (assignee) filter.assignee = assignee
    if (status) filter.status = status
    if (search) {
      filter.$or = [
        { nodeName: { $regex: search, $options: 'i' } },
        { instanceId: { $regex: search, $options: 'i' } },
      ]
    }

    const [docs, total] = await Promise.all([
      TaskInstanceModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      TaskInstanceModel.countDocuments(filter),
    ])

    return {
      items: docs.map(doc => this.toTaskData(doc)),
      total,
    }
  }

  // ────── 审批日志 ──────

  async createLog(data: Omit<ApprovalLogEntry, 'id' | 'createdAt'>): Promise<void> {
    const doc = new ApprovalLogModel({
      id: uuidv4(),
      ...data,
    })
    await doc.save()
  }

  async getLogsByInstance(instanceId: string): Promise<ApprovalLogEntry[]> {
    const docs = await ApprovalLogModel.find({ instanceId })
      .sort({ createdAt: -1 })
      .lean()
    return docs.map(doc => this.toLogData(doc))
  }

  // ────── 数据转换 ──────

  private toInstanceData(doc: any): FlowInstanceData {
    return {
      id: doc.id,
      definitionId: doc.definitionId,
      versionId: doc.versionId ?? 'v1',
      version: String(doc.version ?? 1),
      status: doc.status,
      variables: doc.variables ?? {},
      tokens: doc.tokens ?? [],
      initiatedBy: doc.initiatedBy,
      startedAt: doc.startedAt,
      completedAt: doc.completedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }
  }

  private toTaskData(doc: any): TaskInstanceData {
    return {
      id: doc.id,
      instanceId: doc.instanceId,
      nodeId: doc.nodeId,
      nodeName: doc.nodeName,
      status: doc.status,
      assignee: doc.assignee,
      candidateUsers: doc.candidateUsers,
      candidateRoles: doc.candidateRoles,
      formData: doc.formData,
      formSchemaId: doc.formSchemaId,
      formPublishId: doc.formPublishId,
      formVersion: doc.formVersion,
      formMode: doc.formMode,
      editableFields: doc.editableFields,
      readonlyFields: doc.readonlyFields,
      hostMethods: doc.hostMethods,
      outcome: doc.outcome,
      dueDate: doc.dueDate,
      priority: doc.priority ?? 5,
      multiInstanceIndex: doc.multiInstanceIndex,
      multiInstanceItem: doc.multiInstanceItem,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }
  }

  private toLogData(doc: any): ApprovalLogEntry {
    return {
      id: doc.id,
      instanceId: doc.instanceId,
      nodeId: doc.nodeId,
      nodeName: doc.nodeName,
      taskId: doc.taskId,
      action: doc.action,
      operator: doc.operator,
      comment: doc.comment,
      outcome: doc.outcome,
      createdAt: doc.createdAt,
    }
  }
}

// 单例导出
export const flowPersistence = new MongoFlowPersistence()
