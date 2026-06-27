import mongoose from 'mongoose'
import type { TaskInstanceStatus } from '@schema-form/flow-shared'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface ITaskInstance {
  _id: string
  tenantId: string
  instanceId: string
  nodeId: string
  nodeName: string
  status: TaskInstanceStatus
  assignee?: string
  candidateUsers?: string[]
  candidateRoles?: string[]
  formData?: Record<string, unknown>
  formSchemaId?: string
  formPublishId?: string
  formVersion?: string
  formMode?: string
  editableFields?: string[]
  readonlyFields?: string[]
  hostMethods?: string[]
  outcome?: string
  dueDate?: Date
  priority: number
  multiInstanceIndex?: number | null
  multiInstanceItem?: unknown
  createdAt: Date
  updatedAt: Date
}

const taskInstanceSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    instanceId: { type: String, required: true, index: true },
    nodeId: { type: String, required: true },
    nodeName: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'claimed', 'completed', 'cancelled', 'delegated'],
      default: 'pending',
    },
    assignee: { type: String, default: null },
    candidateUsers: { type: [String], default: [] },
    candidateRoles: { type: [String], default: [] },
    formData: { type: mongoose.Schema.Types.Mixed, default: null },
    formSchemaId: { type: String, default: null },
    formPublishId: { type: String, default: null },
    formVersion: { type: String, default: null },
    formMode: { type: String, default: null },
    editableFields: { type: [String], default: null },
    readonlyFields: { type: [String], default: null },
    hostMethods: { type: [String], default: null },
    outcome: { type: String, default: null },
    dueDate: { type: Date, default: null },
    priority: { type: Number, default: 1 },
    multiInstanceIndex: { type: Number, default: null },
    multiInstanceItem: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
      },
    },
  },
)

taskInstanceSchema.index({ assignee: 1, status: 1 })
taskInstanceSchema.index({ candidateUsers: 1, status: 1 })
taskInstanceSchema.index({ instanceId: 1, nodeId: 1, status: 1 })

taskInstanceSchema.plugin(tenantPlugin)

export const TaskInstanceModel =
  mongoose.models.TaskInstance ??
  mongoose.model<ITaskInstance>('TaskInstance', taskInstanceSchema)
