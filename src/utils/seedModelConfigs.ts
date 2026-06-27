import { v4 as uuidv4 } from 'uuid'
import { encrypt } from '../services/credentialService.js'
import { ModelConfigModel, type IModelConfig, type IModelParameters } from '../models/ModelConfig.js'

interface SeedModelConfig {
  name: string
  provider: IModelConfig['provider']
  model: string
  apiKeyPlain: string
  baseUrl: string
  parameters: IModelParameters
  isDefault: boolean
}

const seedConfigs: SeedModelConfig[] = [
  {
    name: 'DeepSeek V3',
    provider: 'deepseek',
    model: 'deepseek-chat',
    apiKeyPlain: '',
    baseUrl: 'https://api.deepseek.com',
    parameters: { temperature: 0.7, maxTokens: 4096, topP: 1 },
    isDefault: true,
  },
  {
    name: 'GPT-4o',
    provider: 'openai',
    model: 'gpt-4o',
    apiKeyPlain: '',
    baseUrl: 'https://api.openai.com/v1',
    parameters: { temperature: 0.7, maxTokens: 4096, topP: 1 },
    isDefault: false,
  },
  {
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    apiKeyPlain: '',
    baseUrl: 'https://api.anthropic.com',
    parameters: { temperature: 0.7, maxTokens: 4096, topP: 1 },
    isDefault: false,
  },
]

/**
 * Seed model configurations for AI providers.
 * Skips existing entries by name match.
 */
export async function seedModelConfigs(): Promise<void> {
  for (const config of seedConfigs) {
    const existing = await ModelConfigModel.findOne({ name: config.name })
    if (existing) {
      console.log(`[seed] Model config "${config.name}" already exists, skipping.`)
      continue
    }

    const apiKey = config.apiKeyPlain ? encrypt({ apiKey: config.apiKeyPlain }) : ''

    await ModelConfigModel.create({
      _id: uuidv4(),
      name: config.name,
      provider: config.provider,
      model: config.model,
      apiKey,
      baseUrl: config.baseUrl,
      parameters: config.parameters,
      isDefault: config.isDefault,
    })
    console.log(`[seed] Model config created: ${config.name} (${config.provider}/${config.model})`)
  }
}
