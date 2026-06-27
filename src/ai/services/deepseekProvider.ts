/**
 * DeepSeek LLM Provider.
 *
 * Implements the LLMProvider interface for DeepSeek API.
 * Supports both direct API calls and LangChain integration.
 */

import OpenAI from 'openai'
import { ChatOpenAI } from '@langchain/openai'
import type {
  LLMProvider,
  Message,
  ChatOptions,
  ChatResponse,
  Chunk,
  ProviderConfig,
  LangChainModelOptions,
  UsageStats,
} from './llmProvider.js'

export class DeepSeekProvider implements LLMProvider {
  readonly name = 'deepseek'
  readonly models = [
    'deepseek-v4-pro',
    'deepseek-v4',
    'deepseek-r1',
    'deepseek-v3',
  ]
  readonly defaultModel = 'deepseek-v4-pro'
  readonly costPer1kPromptTokens = 0.0002
  readonly costPer1kCompletionTokens = 0.0008
  readonly qualityScore = 85
  readonly speedScore = 90

  private client: OpenAI
  private config: ProviderConfig
  private usage: UsageStats = {
    totalTokens: 0,
    totalCost: 0,
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
  }

  constructor(config: ProviderConfig) {
    this.config = config
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.deepseek.com',
    })
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create({
      model: options?.model || this.config.defaultModel || this.defaultModel,
      messages,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      tools: options?.tools,
      response_format: options?.responseFormat,
    })

    const choice = response.choices[0]
    if (!choice) {
      throw new Error('No response from DeepSeek API')
    }

    const promptTokens = response.usage?.prompt_tokens || 0
    const completionTokens = response.usage?.completion_tokens || 0
    const totalTokens = response.usage?.total_tokens || 0

    this.trackUsage(promptTokens, completionTokens, totalTokens)

    return {
      content: choice.message.content || '',
      toolCalls: choice.message.tool_calls || undefined,
      usage: {
        prompt: promptTokens,
        completion: completionTokens,
        total: totalTokens,
      },
    }
  }

  async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<Chunk> {
    const stream = await this.client.chat.completions.create({
      model: options?.model || this.config.defaultModel || this.defaultModel,
      messages,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      tools: options?.tools,
      stream: true,
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (!delta) continue

      // DeepSeek reasoning_content is in additional_kwargs
      const chunkData = chunk as unknown as Record<string, unknown>
      const reasoningContent = chunkData.reasoning_content as string | undefined

      yield {
        content: delta.content || undefined,
        reasoningContent: reasoningContent || undefined,
        toolCalls: delta.tool_calls || undefined,
      }
    }
  }

  createLangChainModel(options?: LangChainModelOptions): ChatOpenAI {
    return new ChatOpenAI({
      model: options?.model || this.config.defaultModel || this.defaultModel,
      apiKey: this.config.apiKey,
      configuration: {
        baseURL: this.config.baseURL || 'https://api.deepseek.com',
      },
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens,
      streaming: options?.streaming ?? true,
      modelKwargs: options?.responseFormat
        ? { response_format: options.responseFormat }
        : undefined,
    })
  }

  getUsage(): UsageStats {
    return { ...this.usage }
  }

  private trackUsage(promptTokens: number, completionTokens: number, totalTokens: number): void {
    this.usage.promptTokens += promptTokens
    this.usage.completionTokens += completionTokens
    this.usage.totalTokens += totalTokens
    this.usage.requestCount += 1
    this.usage.totalCost +=
      (promptTokens / 1000) * this.costPer1kPromptTokens +
      (completionTokens / 1000) * this.costPer1kCompletionTokens
  }
}
