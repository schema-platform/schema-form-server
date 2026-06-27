import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export type SubmissionStatus = 'submitted' | 'approved' | 'rejected'

export interface IFormSubmission {
  _id: string
  schemaId: string
  data: Record<string, unknown>
  submitterId: string | null
  tenantId: string
  status: SubmissionStatus
  flowInstanceId: string | null
  createdAt: Date
  updatedAt: Date
}

const formSubmissionDef = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    schemaId: { type: String, required: true, index: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    submitterId: { type: String, default: null, index: true },
    tenantId: { type: String, default: '000000', index: true },
    status: { type: String, enum: ['submitted', 'approved', 'rejected'], default: 'submitted' },
    flowInstanceId: { type: String, default: null, index: true },
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

// 复合索引：按 schemaId + createdAt 排序查询（列表页核心查询）
formSubmissionDef.index({ schemaId: 1, createdAt: -1 })
// 复合索引：按 schemaId + status 筛选
formSubmissionDef.index({ schemaId: 1, status: 1 })
// 复合索引：租户 + schemaId（tenantPlugin 会自动注入 tenantId，但显式索引更优）
formSubmissionDef.index({ tenantId: 1, schemaId: 1 })

formSubmissionDef.plugin(tenantPlugin)

export const FormSubmissionModel =
  mongoose.models.FormSubmission ?? mongoose.model<IFormSubmission>('FormSubmission', formSubmissionDef)
