/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import mongoose from 'mongoose'

const mockExecute = vi.fn().mockResolvedValue(undefined)

vi.mock('../services/agentWorkflowExecutor.js', () => ({
  executeAgentWorkflow: (...args: unknown[]) => mockExecute(...args),
}))

const workflowFind = vi.fn()
const workflowFindOne = vi.fn()
const workflowCreate = vi.fn()
const workflowFindOneAndUpdate = vi.fn()
const workflowDeleteOne = vi.fn()
const executionFind = vi.fn()
const executionFindOne = vi.fn()
const executionCreate = vi.fn()
const executionCount = vi.fn()

vi.mock('../models/agentWorkflow.js', () => ({
  AgentWorkflowModel: {
    find: (...args: unknown[]) => workflowFind(...args),
    findOne: (...args: unknown[]) => workflowFindOne(...args),
    create: (...args: unknown[]) => workflowCreate(...args),
    findOneAndUpdate: (...args: unknown[]) => workflowFindOneAndUpdate(...args),
    deleteOne: (...args: unknown[]) => workflowDeleteOne(...args),
    findById: (...args: unknown[]) => workflowFindOne(...args),
  },
  AgentWorkflowExecutionModel: {
    find: (...args: unknown[]) => executionFind(...args),
    findOne: (...args: unknown[]) => executionFindOne(...args),
    create: (...args: unknown[]) => executionCreate(...args),
    countDocuments: (...args: unknown[]) => executionCount(...args),
    updateOne: vi.fn(),
  },
}))

import {
  publishAgentWorkflow,
  findPublishedWorkflowByWebhook,
} from '../services/agentWorkflowService.js'

describe('agentWorkflowService publish + webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('publishAgentWorkflow injects webhookSecret into webhook-trigger nodes', async () => {
    const save = vi.fn()
    const draftGraph = {
      entryNodeId: 'wh-1',
      nodes: [
        {
          id: 'wh-1',
          type: 'webhook-trigger',
          data: { webhookPath: '/doc', webhookMethod: 'POST' },
        },
      ],
      edges: [],
    }
    const workflow = {
      _id: '507f1f77bcf86cd799439012',
      name: 'WF',
      status: 'draft',
      version: '20260701090000',
      publishId: null,
      draftGraph,
      save,
    }
    workflowFindOne.mockReturnValue(workflow)

    await publishAgentWorkflow('507f1f77bcf86cd799439012', 'user1')

    const secret = (workflow.draftGraph.nodes[0].data as { webhookSecret?: string }).webhookSecret
    expect(secret).toMatch(/^[a-f0-9]{64}$/)
    expect(save).toHaveBeenCalled()
  })

  it('findPublishedWorkflowByWebhook returns secret from published graph', async () => {
    workflowFind.mockReturnValue({
      lean: async () => [
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'Published',
          createdBy: 'user1',
          status: 'published',
          publishedGraph: {
            entryNodeId: 'wh-1',
            nodes: [
              {
                id: 'wh-1',
                type: 'webhook-trigger',
                data: {
                  webhookPath: '/verify-hook',
                  webhookMethod: 'POST',
                  webhookSecret: 'deadbeef',
                },
              },
            ],
          },
        },
      ],
    })

    const match = await findPublishedWorkflowByWebhook('/verify-hook', 'POST')
    expect(match?.webhookSecret).toBe('deadbeef')
    expect(match?.createdBy).toBe('user1')
  })
})
