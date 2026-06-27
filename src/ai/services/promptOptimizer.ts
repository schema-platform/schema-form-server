/**
 * Prompt Optimizer Service.
 *
 * Three main capabilities:
 * 1. Analyze — Evaluate prompt quality (clarity, specificity, completeness)
 * 2. Optimize — Use feedback data to improve prompts via LLM
 * 3. Test — Run test cases against a prompt and score results
 *
 * Optimization workflow:
 * 1. Collect feedback data (likes/dislikes) for a prompt
 * 2. Analyze success/failure patterns
 * 3. Use LLM to generate improved prompt
 * 4. Save new version with optimization metadata
 */

import { v4 as uuidv4 } from 'uuid'
import { AIFeedbackModel } from '../../models/AIFeedback.js'
import { PromptVersionModel } from '../models/promptVersion.js'
import type { IPromptVersion } from '../models/promptVersion.js'
import { llmManager } from './llmManager.js'
import { logger } from '../../utils/logger.js'

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export interface PromptAnalysis {
  promptId: string
  totalFeedback: number
  successRate: number
  successCases: FeedbackCase[]
  failureCases: FeedbackCase[]
  commonPatterns: string[]
}

export interface FeedbackCase {
  input: string
  output: string
  rating: 1 | -1
  comment?: string
}

export interface OptimizationResult {
  promptId: string
  previousVersion: number
  newVersion: number
  previousSuccessRate: number
  optimizedContent: string
  optimizationReason: string
}

/** Quality analysis result for a prompt string. */
export interface QualityAnalysis {
  /** Overall quality score 0-100 */
  score: number
  /** Score breakdown */
  dimensions: {
    clarity: { score: number; issues: string[] }
    specificity: { score: number; issues: string[] }
    completeness: { score: number; issues: string[] }
    structure: { score: number; issues: string[] }
  }
  /** Actionable improvement suggestions */
  suggestions: string[]
}

/** Single test case for prompt testing. */
export interface TestCase {
  input: string
  /** Expected output or pattern (optional — for scoring) */
  expected?: string
}

/** Result of a single test case execution. */
export interface TestResult {
  input: string
  expected?: string
  actual: string
  /** Similarity score 0-1 (only when expected is provided) */
  score?: number
  /** Execution duration in ms */
  duration: number
}

/** Aggregated test report. */
export interface TestReport {
  totalCases: number
  passed: number
  failed: number
  averageScore: number
  results: TestResult[]
}

// ────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────

/** Minimum feedback count before optimization is attempted */
const MIN_FEEDBACK_FOR_OPTIMIZATION = 10

/** Success rate threshold - only optimize if below this */
const SUCCESS_RATE_THRESHOLD = 0.8

// ────────────────────────────────────────────
// Prompt Optimizer Service
// ────────────────────────────────────────────

export class PromptOptimizer {
  // ────────────────────────────────────────────
  // Quality Analysis
  // ────────────────────────────────────────────

  /**
   * Analyze prompt quality without calling an LLM.
   *
   * Uses heuristic rules to evaluate clarity, specificity,
   * completeness, and structure.
   *
   * @param prompt - The prompt content to analyze
   * @returns Quality analysis with scores and suggestions
   */
  analyzeQuality(prompt: string): QualityAnalysis {
    const issues = {
      clarity: [] as string[],
      specificity: [] as string[],
      completeness: [] as string[],
      structure: [] as string[],
    }

    // ── Clarity checks ──
    const wordCount = prompt.trim().split(/\s+/).length
    if (wordCount < 20) {
      issues.clarity.push('Prompt 太短，可能无法提供足够的上下文')
    }
    if (wordCount > 2000) {
      issues.clarity.push('Prompt 过长，可能导致 LLM 注意力分散')
    }

    const sentences = prompt.split(/[。.!！?\?]/).filter((s) => s.trim().length > 0)
    const avgSentenceLength = sentences.length > 0 ? wordCount / sentences.length : 0
    if (avgSentenceLength > 50) {
      issues.clarity.push('句子过长，建议拆分为更短的句子')
    }

    // Check for ambiguous words
    const ambiguousWords = ['可能', '也许', '大概', '应该', 'some', 'maybe', 'perhaps', 'might']
    for (const word of ambiguousWords) {
      if (prompt.toLowerCase().includes(word)) {
        issues.clarity.push(`包含模糊词"${word}"，建议使用更精确的表述`)
      }
    }

    // ── Specificity checks ──
    const hasOutputFormat = /输出|格式|format|json|xml|markdown/i.test(prompt)
    if (!hasOutputFormat) {
      issues.specificity.push('未指定输出格式，建议明确期望的输出结构')
    }

    const hasExamples = /例如|比如|示例|example|e\.g\.|for instance/i.test(prompt)
    if (!hasExamples && wordCount > 100) {
      issues.specificity.push('缺少示例，添加示例可以提高输出质量')
    }

    const hasConstraints = /必须|禁止|不要|不能|要求|must|should|don't|require/i.test(prompt)
    if (!hasConstraints) {
      issues.specificity.push('未指定约束条件，建议添加明确的限制要求')
    }

    // ── Completeness checks ──
    const hasRole = /你是|作为|角色|role|you are|act as/i.test(prompt)
    if (!hasRole) {
      issues.completeness.push('未定义角色，建议在开头明确 AI 的角色定位')
    }

    const hasTask = /请|生成|创建|修改|分析|设计|please|generate|create|modify|analyze|design/i.test(prompt)
    if (!hasTask) {
      issues.completeness.push('未明确任务描述，建议清晰说明需要完成的任务')
    }

    const hasContext = /背景|context|场景|当前|目前/i.test(prompt)
    if (!hasContext && wordCount > 100) {
      issues.completeness.push('缺少背景信息，建议添加上下文说明')
    }

    // ── Structure checks ──
    const hasHeadings = /^#+\s/m.test(prompt)
    if (wordCount > 200 && !hasHeadings) {
      issues.structure.push('长 Prompt 缺少标题分段，建议使用 Markdown 标题组织结构')
    }

    const hasList = /^[\s]*[-*\d]+[.)]\s/m.test(prompt)
    if (wordCount > 150 && !hasList) {
      issues.structure.push('建议使用列表结构化关键要求')
    }

    const hasCodeBlock = /```/.test(prompt)
    if (/json|代码|code|schema/i.test(prompt) && !hasCodeBlock) {
      issues.structure.push('提到了代码/JSON 但未使用代码块，建议用 ``` 包裹示例')
    }

    // ── Calculate scores ──
    const clarityScore = Math.max(0, 100 - issues.clarity.length * 20)
    const specificityScore = Math.max(0, 100 - issues.specificity.length * 25)
    const completenessScore = Math.max(0, 100 - issues.completeness.length * 25)
    const structureScore = Math.max(0, 100 - issues.structure.length * 20)

    const overallScore = Math.round(
      clarityScore * 0.25 +
      specificityScore * 0.3 +
      completenessScore * 0.3 +
      structureScore * 0.15,
    )

    // Collect all suggestions
    const suggestions: string[] = [
      ...issues.clarity,
      ...issues.specificity,
      ...issues.completeness,
      ...issues.structure,
    ]

    return {
      score: overallScore,
      dimensions: {
        clarity: { score: clarityScore, issues: issues.clarity },
        specificity: { score: specificityScore, issues: issues.specificity },
        completeness: { score: completenessScore, issues: issues.completeness },
        structure: { score: structureScore, issues: issues.structure },
      },
      suggestions,
    }
  }

  // ────────────────────────────────────────────
  // Feedback-based Optimization
  // ────────────────────────────────────────────

  /**
   * Analyze feedback data for a specific prompt.
   *
   * @param promptId - The prompt identifier (e.g., 'editor', 'flow', 'router')
   * @returns Analysis with success rate, patterns, and case studies
   */
  async analyzeFeedback(promptId: string): Promise<PromptAnalysis> {
    // Get feedback for conversations using this prompt type
    const feedbacks = await AIFeedbackModel.find({
      conversationId: { $regex: `^${promptId}` },
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()

    const totalFeedback = feedbacks.length
    const likes = feedbacks.filter((f) => f.rating === 1)
    const dislikes = feedbacks.filter((f) => f.rating === -1)

    const successRate = totalFeedback > 0 ? likes.length / totalFeedback : 0

    // Extract success and failure cases
    const successCases: FeedbackCase[] = likes.map((f) => ({
      input: f.messageId,
      output: f.comment || '',
      rating: 1 as const,
      comment: f.comment,
    }))

    const failureCases: FeedbackCase[] = dislikes.map((f) => ({
      input: f.messageId,
      output: f.comment || '',
      rating: -1 as const,
      comment: f.comment,
    }))

    // Analyze common patterns from comments
    const commonPatterns = this.extractPatterns(dislikes.map((f) => f.comment).filter(Boolean))

    return {
      promptId,
      totalFeedback,
      successRate,
      successCases,
      failureCases,
      commonPatterns,
    }
  }

  /**
   * Optimize a prompt based on feedback analysis.
   *
   * @param promptId - The prompt identifier
   * @param currentPrompt - Current prompt content
   * @returns Optimization result with new version
   */
  async optimizePrompt(promptId: string, currentPrompt: string): Promise<OptimizationResult> {
    const analysis = await this.analyzeFeedback(promptId)

    // Get current version number
    const latestVersion = await PromptVersionModel.findOne({ promptId })
      .sort({ version: -1 })
      .lean<IPromptVersion | null>()

    const previousVersion = latestVersion?.version ?? 0

    // Check if optimization is needed
    if (analysis.totalFeedback < MIN_FEEDBACK_FOR_OPTIMIZATION) {
      logger.info({
        msg: 'Insufficient feedback for optimization',
        promptId,
        feedbackCount: analysis.totalFeedback,
        required: MIN_FEEDBACK_FOR_OPTIMIZATION,
      })

      return {
        promptId,
        previousVersion,
        newVersion: previousVersion,
        previousSuccessRate: analysis.successRate,
        optimizedContent: currentPrompt,
        optimizationReason: 'Insufficient feedback data',
      }
    }

    if (analysis.successRate >= SUCCESS_RATE_THRESHOLD) {
      logger.info({
        msg: 'Prompt already performing well, skipping optimization',
        promptId,
        successRate: analysis.successRate,
        threshold: SUCCESS_RATE_THRESHOLD,
      })

      return {
        promptId,
        previousVersion,
        newVersion: previousVersion,
        previousSuccessRate: analysis.successRate,
        optimizedContent: currentPrompt,
        optimizationReason: 'Success rate above threshold',
      }
    }

    // Use LLM to optimize prompt
    const optimizedContent = await this.callLLMForOptimization(
      currentPrompt,
      analysis.successCases,
      analysis.failureCases,
      analysis.commonPatterns,
    )

    // Save new version
    const newVersion = previousVersion + 1
    await PromptVersionModel.create({
      _id: uuidv4(),
      promptId,
      version: newVersion,
      content: optimizedContent,
      successRate: analysis.successRate,
      feedbackCount: analysis.totalFeedback,
      optimizationReason: `Optimized based on ${analysis.failureCases.length} failure cases`,
    })

    logger.info({
      msg: 'Prompt optimized and saved',
      promptId,
      previousVersion,
      newVersion,
      previousSuccessRate: analysis.successRate,
      feedbackCount: analysis.totalFeedback,
    })

    return {
      promptId,
      previousVersion,
      newVersion,
      previousSuccessRate: analysis.successRate,
      optimizedContent,
      optimizationReason: `Optimized based on ${analysis.failureCases.length} failure cases`,
    }
  }

  // ────────────────────────────────────────────
  // Prompt Testing
  // ────────────────────────────────────────────

  /**
   * Test a prompt against a set of test cases.
   *
   * For each test case:
   * 1. Substitute input into the prompt template
   * 2. Call LLM to get output
   * 3. Score output against expected (if provided)
   *
   * @param prompt - The prompt template to test (use {{input}} placeholder)
   * @param testCases - Array of test cases
   * @returns Test report with scores
   */
  async testPrompt(prompt: string, testCases: TestCase[]): Promise<TestReport> {
    if (testCases.length === 0) {
      return { totalCases: 0, passed: 0, failed: 0, averageScore: 0, results: [] }
    }

    const provider = llmManager.getProvider()
    const results: TestResult[] = []

    for (const testCase of testCases) {
      const renderedPrompt = prompt.replace(/\{\{input\}\}/g, testCase.input)
      const startTime = Date.now()

      try {
        const output = await provider.chat([
          { role: 'user', content: renderedPrompt },
        ], { temperature: 0.3 })

        const duration = Date.now() - startTime
        const actual = output.content

        let score: number | undefined
        if (testCase.expected) {
          score = this.calculateSimilarity(actual, testCase.expected)
        }

        results.push({
          input: testCase.input,
          expected: testCase.expected,
          actual,
          score,
          duration,
        })
      } catch (err) {
        results.push({
          input: testCase.input,
          expected: testCase.expected,
          actual: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          score: 0,
          duration: Date.now() - startTime,
        })
      }
    }

    const scoredResults = results.filter((r) => r.score !== undefined)
    const passed = scoredResults.filter((r) => (r.score ?? 0) >= 0.6).length
    const failed = scoredResults.filter((r) => (r.score ?? 0) < 0.6).length
    const averageScore = scoredResults.length > 0
      ? scoredResults.reduce((sum, r) => sum + (r.score ?? 0), 0) / scoredResults.length
      : 0

    return {
      totalCases: testCases.length,
      passed,
      failed,
      averageScore: Math.round(averageScore * 100) / 100,
      results,
    }
  }

  // ────────────────────────────────────────────
  // Version History
  // ────────────────────────────────────────────

  /**
   * Get version history for a prompt.
   *
   * @param promptId - The prompt identifier
   * @returns Array of prompt versions
   */
  async getVersionHistory(promptId: string) {
    return PromptVersionModel.find({ promptId })
      .sort({ version: -1 })
      .lean()
  }

  /**
   * Get a specific prompt version.
   *
   * @param promptId - The prompt identifier
   * @param version - Version number
   * @returns Prompt version or null
   */
  async getVersion(promptId: string, version: number) {
    return PromptVersionModel.findOne({ promptId, version }).lean()
  }

  /**
   * Restore a prompt to a specific version.
   *
   * @param promptId - The prompt identifier
   * @param version - Version to restore
   * @returns Restored prompt content or null
   */
  async restoreVersion(promptId: string, version: number) {
    const promptVersion = await PromptVersionModel.findOne({ promptId, version }).lean()
    if (!promptVersion) return null

    // Create new version based on restored content
    const latestVersion = await PromptVersionModel.findOne({ promptId })
      .sort({ version: -1 })
      .lean()

    const newVersion = (latestVersion?.version ?? 0) + 1
    const restored = await PromptVersionModel.create({
      _id: uuidv4(),
      promptId,
      version: newVersion,
      content: promptVersion.content,
      feedbackCount: 0,
      optimizationReason: `Restored from version ${version}`,
    })

    return restored
  }

  // ────────────────────────────────────────────
  // Private methods
  // ────────────────────────────────────────────

  /**
   * Extract common patterns from feedback comments.
   */
  private extractPatterns(comments: string[]): string[] {
    const patterns: string[] = []
    const keywords = [
      '格式错误',
      '不完整',
      '缺少',
      '多余',
      '不准确',
      '不符合',
      '没有理解',
      '理解错误',
      '没有按照',
      '位置错误',
    ]

    for (const comment of comments) {
      if (!comment) continue
      for (const keyword of keywords) {
        if (comment.includes(keyword)) {
          patterns.push(keyword)
        }
      }
    }

    // Deduplicate and count
    const patternCounts = patterns.reduce(
      (acc, pattern) => {
        acc[pattern] = (acc[pattern] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )

    return Object.entries(patternCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([pattern]) => pattern)
  }

  /**
   * Call LLM to optimize prompt based on feedback.
   */
  private async callLLMForOptimization(
    currentPrompt: string,
    successCases: FeedbackCase[],
    failureCases: FeedbackCase[],
    commonPatterns: string[],
  ): Promise<string> {
    // Prepare case summaries
    const successSummary = successCases
      .slice(0, 5)
      .map((c) => `- ${c.comment || 'No comment'}`)
      .join('\n')

    const failureSummary = failureCases
      .slice(0, 5)
      .map((c) => `- ${c.comment || 'No comment'}`)
      .join('\n')

    const patternsSummary = commonPatterns.length > 0 ? commonPatterns.join(', ') : 'None identified'

    const provider = llmManager.getProvider()
    const output = await provider.chat([
      {
        role: 'system',
        content: `你是一个 Prompt 优化专家。你的任务是根据用户反馈数据，优化给定的 Prompt。

优化原则：
1. 保持原有功能和格式要求
2. 针对失败案例添加更明确的指导
3. 避免过度复杂化
4. 使用简洁、清晰的语言
5. 保留原有结构，只修改需要改进的部分

输出要求：
- 直接输出优化后的 Prompt 文本
- 不要输出解释或说明
- 保持原有的 Markdown 格式`,
      },
      {
        role: 'user',
        content: `## 当前 Prompt

${currentPrompt}

## 用户反馈分析

### 成功案例（用户满意的输出）
${successSummary || '暂无'}

### 失败案例（用户不满意的输出）
${failureSummary || '暂无'}

### 常见问题模式
${patternsSummary}

请优化这个 Prompt，使其能够：
1. 减少失败案例中的问题
2. 保持成功案例的表现
3. 针对常见问题模式提供更明确的指导`,
      },
    ], { temperature: 0.3 })

    return output.content
  }

  /**
   * Calculate text similarity using simple token overlap (Jaccard index).
   */
  private calculateSimilarity(actual: string, expected: string): number {
    const tokenize = (text: string) => {
      const tokens = new Set<string>()
      // Split on whitespace and punctuation, keep meaningful tokens
      for (const token of text.split(/[\s,.:;!?()[\]{}'"`~@#$%^&*+=<>|\\\/-]+/)) {
        if (token.length > 1) {
          tokens.add(token.toLowerCase())
        }
      }
      return tokens
    }

    const actualTokens = tokenize(actual)
    const expectedTokens = tokenize(expected)

    if (actualTokens.size === 0 && expectedTokens.size === 0) return 1
    if (actualTokens.size === 0 || expectedTokens.size === 0) return 0

    let intersection = 0
    for (const token of actualTokens) {
      if (expectedTokens.has(token)) intersection++
    }

    const union = actualTokens.size + expectedTokens.size - intersection
    return intersection / union
  }
}

// Singleton instance
export const promptOptimizer = new PromptOptimizer()
