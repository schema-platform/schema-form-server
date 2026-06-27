/**
 * TaskInstance — 任务实例模型
 */
import mongoose, { Schema, type Document } from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface ITaskInstance extends Document {
  id: string
  tenantId: string
  instanceId: string
  nodeId: string
  nodeName: string
  status: 'pending' | 'claimed' | 'completed' | 'cancelled' | 'delegated'
  assignee?: string
  candidateUsers?: string[]
  candidateRoles?: string[]
  formData?: Record<string, unknown>
  formSchemaId?: string
  formPublishId?: string
  formVersion?: string
  formMode?: 'edit' | 'view' | 'readonly' | 'editable' | 'partial'
  editableFields?: string[]
  readonlyFields?: string[]
  hostMethods?: string[]
  outcome?: string
  dueDate?: Date
  priority: number
  multiInstanceIndex?: number
  multiInstanceItem?: string
  createdAt: Date
  updatedAt: Date
}

const TaskInstanceSchema = new Schema<ITaskInstance>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, default: '000000', index: true },
    instanceId: { type: String, required: true, index: true },
    nodeId: { type: String, required: true },
    nodeName: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'claimed', 'completed', 'cancelled', 'delegated'],
      default: 'pending',
      index: true,
    },
    assignee: { type: String, index: true },
    candidateUsers: [String],
    candidateRoles: [String],
    formData: { type: Schema.Types.Mixed },
    formSchemaId: String,
    formPublishId: String,
    formVersion: String,
    formMode: {
      type: String,
      enum: ['edit', 'view', 'readonly', 'editable', 'partial'],
      default: 'edit',
    },
    editableFields: [String],
    readonlyFields: [String],
    hostMethods: [String],
    outcome: String,
    dueDate: Date,
    priority: { type: Number, default: 5 },
    multiInstanceIndex: Number,
    multiInstanceItem: String,
  },
  {
    timestamps: true,
  },
)

TaskInstanceSchema.plugin(tenantPlugin)

export const TaskInstanceModel = mongoose.model<ITaskInstance>('TaskInstance', TaskInstanceSchema)
