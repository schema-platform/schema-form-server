import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export type ModelProvider = 'deepseek' | 'openai' | 'anthropic' | 'ollama'

export interface IModelParameters {
  temperature: number
  maxTokens: number
  topP: number
}

export interface IModelConfig {
  _id: string
  name: string
  provider: ModelProvider
  model: string
  apiKey: string
  baseUrl: string
  parameters: IModelParameters
  isDefault: boolean
  tenantId: string
  createdAt: Date
  updatedAt: Date
}

const modelParametersSchema = new mongoose.Schema<IModelParameters>(
  {
    temperature: { type: Number, default: 0.7, min: 0, max: 2 },
    maxTokens: { type: Number, default: 4096, min: 1 },
    topP: { type: Number, default: 1, min: 0, max: 1 },
  },
  { _id: false },
)

const modelConfigSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    name: { type: String, required: true, trim: true },
    provider: {
      type: String,
      required: true,
      enum: ['deepseek', 'openai', 'anthropic', 'ollama'],
    },
    model: { type: String, required: true, trim: true },
    apiKey: { type: String, default: '' },
    baseUrl: { type: String, default: '' },
    parameters: { type: modelParametersSchema, default: () => ({}) },
    isDefault: { type: Boolean, default: false, index: true },
    tenantId: { type: String, default: '000000', index: true },
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

modelConfigSchema.index({ tenantId: 1, provider: 1 })
modelConfigSchema.index({ tenantId: 1, isDefault: 1 })

modelConfigSchema.plugin(tenantPlugin)

export const ModelConfigModel =
  mongoose.models.ModelConfig ??
  mongoose.model<IModelConfig>('ModelConfig', modelConfigSchema)
