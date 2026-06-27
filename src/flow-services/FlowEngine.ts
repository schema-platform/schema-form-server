import { v4 as uuidv4 } from 'uuid'
import { parseBpmnGraph, BpmnElementType, evaluateScript } from '@schema-form/flow-shared'
import type { FlowToken, FlowInstanceStatus, RejectPolicy } from '@schema-form/flow-shared'
import type { AssigneeType, FlowApiConfig, NodeFormDataMap, UpstreamNodeData } from '@schema-form/flow-shared'

/**
 * Evaluate an assignee expression against instance variables.
 * Returns the raw value (string, string[], or null) instead of boolean.
 */
function evaluateAssigneeExpression(
  expression: string,
  variables: Record<string, unknown>,
): string | string[] | null {
  if (!expression || expression.trim().length === 0) return null

  const keys = Object.keys(variables)
  const values = keys.map((k) => variables[k])
  const fn = new Function(...keys, `return (${expression})`)
  const result = fn(...values)

  if (Array.isArray(result)) {
    return result.map(String)
  }
  if (result != null) {
    return [String(result)]
  }
  return null
}
import { FlowInstanceModel } from '../flow-models/FlowInstance.js'
import { FlowVersionModel } from '../flow-models/FlowVersion.js'
import { FlowDefinitionModel } from '../flow-models/FlowDefinition.js'
import { TaskInstanceModel } from '../flow-models/TaskInstance.js'
import { TimerJobModel } from '../flow-models/TimerJob.js'
import { ApprovalLogModel } from '../flow-models/ApprovalLog.js'
import { parseTimerValue } from './TimerService.js'
import { messageQueue } from './MessageQueue.js'
import { notificationService } from './NotificationService.js'
import { eventBus } from '../services/eventBus.js'
import { logNodeStart, logNodeComplete, logNodeFail } from '../services/executionLogger.js'
import type { RejectTargetNode } from '@schema-form/flow-shared'

export class FlowEngine {
  private async getRejectPolicy(instance: { versionId: string }, nodeId: string): Promise<RejectPolicy> {
    const flowVersion = await FlowVersionModel.findById(instance.versionId)
    const globalPolicy: RejectPolicy = flowVersion?.metadata?.defaultRejectPolicy ?? 'reject-on-all'

    const model = parseBpmnGraph(flowVersion!.graph)
    const node = model.getNode(nodeId)
    const nodePolicy = node?.config?.rejectPolicy

    if (!nodePolicy || nodePolicy === 'follow-global') return globalPolicy
    return nodePolicy
  }

  private async logApproval(params: {
    instanceId: string
    nodeId: string
    nodeName: string
    taskId: string
    action: string
    operator: string
    comment?: string
    outcome?: string
  }): Promise<void> {
    await ApprovalLogModel.create({
      _id: uuidv4(),
      ...params,
    })
  }

  /**
   * Find all upstream UserTask nodes reachable by traversing incoming edges backwards.
   * Used to determine valid reject-to-node targets.
   */
  getUpstreamUserTasks(
    model: ReturnType<typeof parseBpmnGraph>,
    fromNodeId: string,
  ): RejectTargetNode[] {
    const visited = new Set<string>()
    const queue = [fromNodeId]
    const results: RejectTargetNode[] = []

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (visited.has(nodeId)) continue
      visited.add(nodeId)

      const inEdges = model.getIncoming(nodeId)
      for (const edge of inEdges) {
        const sourceNode = model.getNode(edge.sourceNodeId)
        if (!sourceNode) continue

        if (sourceNode.bpmnType === BpmnElementType.UserTask) {
          results.push({
            nodeId: sourceNode.id,
            nodeName: sourceNode.config.label ?? sourceNode.id,
            nodeType: sourceNode.bpmnType,
          })
        }
        // Always traverse backwards through any node type
        queue.push(edge.sourceNodeId)
      }
    }

    return results
  }

  /**
   * Get valid reject-to-node targets for a given task.
   * Returns upstream UserTask nodes that the task could be rejected back to.
   */
  async getRejectTargets(taskId: string): Promise<RejectTargetNode[]> {
    const task = await TaskInstanceModel.findById(taskId)
    if (!task) throw new Error('Task not found')

    const instance = await FlowInstanceModel.findById(task.instanceId)
    if (!instance) throw new Error('Instance not found')

    const flowVersion = await FlowVersionModel.findById(instance.versionId)
    if (!flowVersion) throw new Error('Flow version not found')

    const model = parseBpmnGraph(flowVersion.graph)
    return this.getUpstreamUserTasks(model, task.nodeId)
  }

  /**
   * Reject a task back to a specific upstream UserTask node.
   * Cancels all pending tasks at the current node, moves the token to the target node,
   * and creates a new task there.
   */
  async rejectToNode(
    taskId: string,
    targetNodeId: string,
    comment?: string,
    userId?: string,
  ): Promise<void> {
    const task = await TaskInstanceModel.findById(taskId)
    if (!task) throw new Error('Task not found')
    if (task.status !== 'pending' && task.status !== 'claimed') {
      throw new Error('Task is not in a rejectable state')
    }

    // Authorization: verify user is eligible to reject
    if (userId) {
      const isAssignee = task.assignee === userId
      const inCandidateUsers = task.candidateUsers && task.candidateUsers.includes(userId)
      if (!isAssignee && !inCandidateUsers) {
        throw new Error('You are not authorized to reject this task')
      }
    }

    const instance = await FlowInstanceModel.findById(task.instanceId)
    if (!instance) throw new Error('Instance not found')
    if (instance.status !== 'running') throw new Error('Instance is not running')

    const flowVersion = await FlowVersionModel.findById(instance.versionId)
    if (!flowVersion) throw new Error('Flow version not found')

    const model = parseBpmnGraph(flowVersion.graph)

    // Validate target node exists and is a UserTask
    const targetNode = model.getNode(targetNodeId)
    if (!targetNode) throw new Error('Target node not found')
    if (targetNode.bpmnType !== BpmnElementType.UserTask) {
      throw new Error('Target node must be a UserTask')
    }

    // Validate target is upstream of current node
    const upstreamTargets = this.getUpstreamUserTasks(model, task.nodeId)
    const isValidTarget = upstreamTargets.some(t => t.nodeId === targetNodeId)
    if (!isValidTarget) {
      throw new Error('Target node is not reachable upstream from the current task')
    }

    // Mark current task as completed with rejected outcome
    task.status = 'completed'
    task.outcome = 'rejected'
    await task.save()

    // Cancel all remaining pending/claimed tasks at the current node
    await TaskInstanceModel.updateMany(
      {
        instanceId: instance._id,
        nodeId: task.nodeId,
        _id: { $ne: task._id },
        status: { $in: ['pending', 'claimed'] },
      },
      { status: 'cancelled' },
    )

    // Find the token at the current node and move it to the target node
    const token = instance.tokens.find(
      (t: FlowToken) => t.nodeId === task.nodeId && (t.state === 'waiting' || t.state === 'active'),
    )
    if (!token) throw new Error('No active token found at the current node')

    token.nodeId = targetNodeId
    token.state = 'active'
    await instance.save()

    // Log the rejection
    const operator = task.assignee ?? task.candidateUsers?.[0] ?? 'unknown'
    await this.logApproval({
      instanceId: instance._id,
      nodeId: task.nodeId,
      nodeName: task.nodeName,
      taskId: task._id,
      action: 'reject-to-node',
      operator: userId ?? operator,
      comment,
      outcome: `rejected to ${targetNode.config.label} (${targetNodeId})`,
    })

    // Advance the instance to create a new task at the target node
    await this.advance(instance._id)
  }
  async startFlow(
    definitionId: string,
    variables: Record<string, unknown> = {},
    initiatedBy: string,
  ) {
    const definition = await FlowDefinitionModel.findById(definitionId)
    if (!definition) throw new Error('Flow definition not found')

    const version = definition.currentVersionId
      ? await FlowVersionModel.findById(definition.currentVersionId)
      : await FlowVersionModel.findOne({ definitionId }).sort({ version: -1 })

    if (!version) throw new Error('No flow version found')

    const model = parseBpmnGraph(version.graph)

    const instance = await FlowInstanceModel.create({
      _id: uuidv4(),
      definitionId,
      versionId: version._id,
      version: version.version,
      status: 'running' as FlowInstanceStatus,
      variables,
      tokens: [
        {
          tokenId: uuidv4(),
          nodeId: model.startNodeId,
          state: 'active' as const,
          createdAt: new Date(),
        },
      ],
      initiatedBy,
      startedAt: new Date(),
    })

    await this.advance(instance._id)

    return FlowInstanceModel.findById(instance._id)
  }

  /**
   * Check if any waiting token at a ParallelGateway join has exceeded its timeout.
   * Returns true if the instance was failed, false otherwise.
   */
  private checkJoinTimeouts(instance: { tokens: FlowToken[]; status: string; completedAt?: Date; save: () => Promise<unknown> }, model: ReturnType<typeof parseBpmnGraph>): boolean {
    for (const token of instance.tokens) {
      if (token.state !== 'waiting' || !token.waitingSince) continue
      const node = model.getNode(token.nodeId)
      if (!node || node.bpmnType !== BpmnElementType.ParallelGateway) continue
      const joinTimeout: number | undefined = node.config.joinTimeout
      if (!joinTimeout || joinTimeout <= 0) continue
      const elapsedMinutes = (Date.now() - new Date(token.waitingSince).getTime()) / 60_000
      if (elapsedMinutes >= joinTimeout) {
        instance.status = 'failed'
        instance.completedAt = new Date()
        return true
      }
    }
    return false
  }

  async advance(instanceId: string) {
    const instance = await FlowInstanceModel.findById(instanceId)
    if (!instance || instance.status !== 'running') return

    const flowVersion = await FlowVersionModel.findById(instance.versionId)
    if (!flowVersion) throw new Error('Flow version not found')

    const model = parseBpmnGraph(flowVersion.graph)

    // Pre-scan: fail instance if any parallel gateway join has timed out
    if (this.checkJoinTimeouts(instance, model)) {
      await instance.save()
      return
    }

    let changed = true
    const maxIterations = 100
    let iterations = 0

    while (changed && iterations < maxIterations) {
      changed = false
      iterations++

      const activeTokens = instance.tokens.filter((t: FlowToken) => t.state === 'active')

      for (const token of activeTokens) {
        const node = model.getNode(token.nodeId)
        if (!node) continue

        switch (node.bpmnType) {
          case BpmnElementType.StartEvent: {
            const outEdges = model.getOutgoing(token.nodeId)
            if (outEdges.length > 0) {
              token.nodeId = outEdges[0].targetNodeId
              changed = true
            }
            break
          }

          case BpmnElementType.EndEvent: {
            token.state = 'completed'
            changed = true
            break
          }

          case BpmnElementType.UserTask: {
            const outEdges = model.getOutgoing(token.nodeId)
            const approvalMode = node.config.approvalMode ?? 'single'

            // Resolve assignees based on assigneeType
            let candidateUsers: string[] = []
            let candidateRoles: string[] = []

            const assigneeType: AssigneeType | undefined = node.config.assigneeType
            switch (assigneeType) {
              case 'user':
                candidateUsers = node.config.candidateUsers ?? []
                break
              case 'role':
                candidateRoles = node.config.candidateRoles ?? []
                break
              case 'expression': {
                const result = evaluateAssigneeExpression(node.config.assignee ?? '', instance.variables)
                if (Array.isArray(result)) {
                  candidateUsers = result
                } else if (result) {
                  candidateUsers = [result]
                }
                break
              }
              default:
                // Legacy: single assignee string
                if (node.config.assignee) {
                  candidateUsers = [node.config.assignee]
                }
                break
            }

            if (approvalMode === 'single') {
              const existingTask = await TaskInstanceModel.findOne({
                instanceId: instance._id,
                nodeId: token.nodeId,
                status: { $in: ['pending', 'claimed'] },
              })
              if (!existingTask) {
                token.state = 'waiting'
                await TaskInstanceModel.create({
                  _id: uuidv4(),
                  instanceId: instance._id,
                  nodeId: token.nodeId,
                  nodeName: node.config.label,
                  status: 'pending',
                  candidateUsers,
                  candidateRoles,
                  formSchemaId: node.config.formSchemaId,
                  formPublishId: node.config.formPublishId,
                  formVersion: node.config.formVersion,
                  formMode: node.config.formMode,
                  editableFields: node.config.editableFields,
                  readonlyFields: node.config.readonlyFields,
                  hostMethods: node.config.hostMethods,
                  priority: 1,
                })

                // Notify assigned users
                const notifyUsers = candidateUsers.length > 0
                  ? candidateUsers
                  : []
                for (const uid of notifyUsers) {
                  await notificationService.createTaskAssignedNotification(
                    token.nodeId,
                    uid,
                    node.config.label,
                  ).catch((err) => { console.error('[notification] failed:', err) })
                }

                changed = true
              }
              break
            }

            // Multi-assignee modes (countersign / or-sign)
            const collection = node.config.assigneeCollection ?? node.config.multiInstance?.collection
            const assignees = collection
              ? ((instance.variables[collection] as string[]) ?? [])
              : candidateUsers.length > 0
                ? candidateUsers
                : []

            if (assignees.length === 0) {
              if (outEdges.length > 0) {
                token.nodeId = outEdges[0].targetNodeId
                changed = true
              }
              break
            }

            const existingTasks = await TaskInstanceModel.find({
              instanceId: instance._id,
              nodeId: token.nodeId,
              status: { $in: ['pending', 'claimed', 'completed'] },
            })

            if (existingTasks.length === 0) {
              token.state = 'waiting'
              for (let i = 0; i < assignees.length; i++) {
                await TaskInstanceModel.create({
                  _id: uuidv4(),
                  instanceId: instance._id,
                  nodeId: token.nodeId,
                  nodeName: node.config.label,
                  status: 'pending',
                  candidateUsers: [assignees[i]],
                  formSchemaId: node.config.formSchemaId,
                  formPublishId: node.config.formPublishId,
                  formVersion: node.config.formVersion,
                  formMode: node.config.formMode,
                  editableFields: node.config.editableFields,
                  readonlyFields: node.config.readonlyFields,
                  hostMethods: node.config.hostMethods,
                  priority: 1,
                  multiInstanceIndex: i,
                  multiInstanceItem: assignees[i],
                })

                // Notify each assignee
                await notificationService.createTaskAssignedNotification(
                  token.nodeId,
                  assignees[i],
                  node.config.label,
                ).catch((err) => { console.error('[notification] failed:', err) })
              }
              changed = true
              break
            }

            const completedTasks = existingTasks.filter(t => t.status === 'completed')

            if (approvalMode === 'countersign') {
              const required = node.config.minApprovalCount ?? assignees.length
              if (completedTasks.length >= required) {
                await TaskInstanceModel.updateMany(
                  { instanceId: instance._id, nodeId: token.nodeId, status: { $in: ['pending', 'claimed'] } },
                  { status: 'cancelled' },
                )
                token.state = 'active'
                token.nodeId = outEdges[0]?.targetNodeId ?? token.nodeId
                changed = true
              }
            } else if (approvalMode === 'or-sign') {
              if (completedTasks.length >= 1) {
                const approvedTask = completedTasks.find(t => t.outcome === 'approved' || !t.outcome)
                if (approvedTask) {
                  await TaskInstanceModel.updateMany(
                    { instanceId: instance._id, nodeId: token.nodeId, status: { $in: ['pending', 'claimed'] } },
                    { status: 'cancelled' },
                  )
                  token.state = 'active'
                  token.nodeId = outEdges[0]?.targetNodeId ?? token.nodeId
                  changed = true
                }
              }
            }
            break
          }

          case BpmnElementType.ServiceTask: {
            await logNodeStart(instance._id, token.nodeId, node.config.label ?? 'ServiceTask', { ...instance.variables })

            // Execute service task based on serviceConfig
            const serviceConfig = node.config.serviceConfig as Record<string, unknown> | undefined
            const serviceType = (serviceConfig?.type ?? node.config.serviceType) as string | undefined

            if (serviceType === 'dataUpdate') {
              // Data update service task: placeholder for future implementation
              console.warn('[FlowEngine] dataUpdate service type is not yet implemented')
            }

            await logNodeComplete(instance._id, token.nodeId, { serviceType })

            token.state = 'completed'
            const outEdges = model.getOutgoing(token.nodeId)
            if (outEdges.length > 0) {
              const newToken: FlowToken = {
                tokenId: uuidv4(),
                nodeId: outEdges[0].targetNodeId,
                state: 'active',
                createdAt: new Date(),
              }
              instance.tokens.push(newToken)
            }
            changed = true
            break
          }

          case BpmnElementType.ExclusiveGateway: {
            const outEdges = model.getOutgoing(token.nodeId)
            let targetEdge = outEdges.find((e) => e.isDefault)

            for (const edge of outEdges) {
              if (edge.conditionExpression && !edge.isDefault) {
                const { evaluateExpression } = await import('@schema-form/flow-shared')
                const result = evaluateExpression(edge.conditionExpression, instance.variables)
                if (result) {
                  targetEdge = edge
                  break
                }
              }
            }

            if (targetEdge) {
              token.nodeId = targetEdge.targetNodeId
              changed = true
            }
            break
          }

          case BpmnElementType.TimerEvent: {
            const existingJob = await TimerJobModel.findOne({
              instanceId: instance._id,
              nodeId: token.nodeId,
              status: 'pending',
            })

            if (!existingJob) {
              const timerType = node.config.timerType ?? 'duration'
              const timerValue = node.config.timerValue ?? 'PT1M'
              const fireAt = parseTimerValue(timerType, timerValue)

              await TimerJobModel.create({
                _id: uuidv4(),
                instanceId: instance._id,
                tokenId: token.tokenId,
                nodeId: token.nodeId,
                fireAt,
                status: 'pending',
                timerType,
                timerValue,
              })
              token.state = 'waiting'
              changed = true
            }
            break
          }

          case BpmnElementType.ScriptTask: {
            await logNodeStart(instance._id, token.nodeId, node.config.label ?? 'ScriptTask', { ...instance.variables })

            const scriptContent: string = node.config.scriptContent ?? ''
            const result = evaluateScript(scriptContent, instance.variables)
            if (result !== undefined) {
              const resultKey: string = node.config.label ?? `scriptResult_${token.nodeId}`
              instance.variables[resultKey] = result
            }

            await logNodeComplete(instance._id, token.nodeId, { result })

            token.state = 'completed'
            const outEdges = model.getOutgoing(token.nodeId)
            if (outEdges.length > 0) {
              const newToken: FlowToken = {
                tokenId: uuidv4(),
                nodeId: outEdges[0].targetNodeId,
                state: 'active',
                createdAt: new Date(),
              }
              instance.tokens.push(newToken)
            }
            changed = true
            break
          }

          case BpmnElementType.SendTask: {
            await logNodeStart(instance._id, token.nodeId, node.config.label ?? 'SendTask', { ...instance.variables })

            // Message channel mode: send via MessageQueue
            const messageRef = node.config.messageRef as string | undefined
            if (messageRef) {
              await messageQueue.send({
                channel: messageRef,
                payload: {
                  instanceId: instance._id,
                  nodeId: token.nodeId,
                  variables: { ...instance.variables },
                },
                senderInstanceId: instance._id,
                senderNodeId: token.nodeId,
              })

              await logNodeComplete(instance._id, token.nodeId, { channel: messageRef })

              token.state = 'completed'
              const outEdges = model.getOutgoing(token.nodeId)
              if (outEdges.length > 0) {
                instance.tokens.push({
                  tokenId: uuidv4(),
                  nodeId: outEdges[0].targetNodeId,
                  state: 'active',
                  createdAt: new Date(),
                })
              }
              changed = true
              break
            }

            const apiConfig = node.config.apiConfig as FlowApiConfig | undefined

            if (!apiConfig?.url) {
              // No HTTP config — pass through (backwards compatible)
              await logNodeComplete(instance._id, token.nodeId, { mode: 'passthrough' })

              token.state = 'completed'
              const outEdges = model.getOutgoing(token.nodeId)
              if (outEdges.length > 0) {
                instance.tokens.push({
                  tokenId: uuidv4(),
                  nodeId: outEdges[0].targetNodeId,
                  state: 'active',
                  createdAt: new Date(),
                })
              }
              changed = true
              break
            }

            const method = (apiConfig.method ?? 'post').toUpperCase()
            let url = apiConfig.url

            // For GET: append params as query string
            if (method === 'GET' && apiConfig.params) {
              const qs = new URLSearchParams(
                Object.entries(apiConfig.params).map(([k, v]) => [k, String(v ?? '')]),
              ).toString()
              url += (url.includes('?') ? '&' : '?') + qs
            }

            const headers: Record<string, string> = { ...apiConfig.headers }
            if (method !== 'GET' && apiConfig.body) {
              headers['Content-Type'] ??= 'application/json'
            }

            const controller = new AbortController()
            const timeoutMs = apiConfig.timeout ?? 30_000
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

            try {
              const response = await fetch(url, {
                method,
                headers,
                body: method !== 'GET' && apiConfig.body
                  ? JSON.stringify(apiConfig.body)
                  : undefined,
                signal: controller.signal,
              })
              clearTimeout(timeoutId)

              if (!response.ok) {
                const text = await response.text().catch(() => '')
                throw new Error(
                  `SendTask HTTP ${response.status}: ${response.statusText}${text ? ` — ${text}` : ''}`,
                )
              }

              // Extract response data via dataPath if configured
              if (apiConfig.dataPath) {
                const json = await response.json() as Record<string, unknown>
                const segments = apiConfig.dataPath.split('.')
                let value: unknown = json
                for (const seg of segments) {
                  if (value == null || typeof value !== 'object') { value = undefined; break }
                  value = (value as Record<string, unknown>)[seg]
                }
                instance.variables[`${node.config.label}_response`] = value
              }
            } catch (err) {
              clearTimeout(timeoutId)
              const errMsg = err instanceof Error ? err.message : String(err)
              await logNodeFail(instance._id, token.nodeId, errMsg)
              instance.status = 'failed'
              instance.completedAt = new Date()
              await instance.save()
              throw err
            }

            await logNodeComplete(instance._id, token.nodeId, { url, method })

            token.state = 'completed'
            const outEdges = model.getOutgoing(token.nodeId)
            if (outEdges.length > 0) {
              instance.tokens.push({
                tokenId: uuidv4(),
                nodeId: outEdges[0].targetNodeId,
                state: 'active',
                createdAt: new Date(),
              })
            }
            changed = true
            break
          }

          case BpmnElementType.ReceiveTask: {
            // Message channel mode: try to consume from MessageQueue
            const messageRef = node.config.messageRef as string | undefined
            if (messageRef) {
              const existingMessage = await messageQueue.tryConsume({
                channel: messageRef,
                receiverInstanceId: instance._id,
                receiverNodeId: token.nodeId,
              })

              if (existingMessage) {
                // Message already available — consume and advance past ReceiveTask
                instance.variables[`${node.config.label}_message`] = existingMessage.payload
                token.state = 'completed'
                const outEdges = model.getOutgoing(token.nodeId)
                if (outEdges.length > 0) {
                  instance.tokens.push({
                    tokenId: uuidv4(),
                    nodeId: outEdges[0].targetNodeId,
                    state: 'active',
                    createdAt: new Date(),
                  })
                }
                changed = true
              } else {
                // No message yet — create pending task and subscribe for real-time delivery
                token.state = 'waiting'
                await TaskInstanceModel.create({
                  _id: uuidv4(),
                  instanceId: instance._id,
                  nodeId: token.nodeId,
                  nodeName: node.config.label,
                  status: 'pending',
                  priority: 1,
                })
                messageQueue.subscribe(messageRef, async () => {
                  await this.advance(instance._id)
                })
                changed = true
              }
              break
            }

            // Task-based waiting (no messageRef)
            const existingTask = await TaskInstanceModel.findOne({
              instanceId: instance._id,
              nodeId: token.nodeId,
              status: { $in: ['pending', 'claimed'] },
            })
            if (!existingTask) {
              token.state = 'waiting'
              await TaskInstanceModel.create({
                _id: uuidv4(),
                instanceId: instance._id,
                nodeId: token.nodeId,
                nodeName: node.config.label,
                status: 'pending',
                candidateUsers: node.config.assignee ? [node.config.assignee] : [],
                formSchemaId: node.config.formSchemaId,
                formPublishId: node.config.formPublishId,
                formVersion: node.config.formVersion,
                formMode: node.config.formMode,
                editableFields: node.config.editableFields,
                readonlyFields: node.config.readonlyFields,
                hostMethods: node.config.hostMethods,
                priority: 1,
              })
              changed = true
            }
            break
          }

          case BpmnElementType.InclusiveGateway: {
            const inEdges = model.getIncoming(token.nodeId)
            const outEdges = model.getOutgoing(token.nodeId)

            // Join behavior (converging): same as ParallelGateway
            if (inEdges.length > 1) {
              const waitingTokens = instance.tokens.filter(
                (t: FlowToken) =>
                  t.nodeId === token.nodeId &&
                  t.state === 'active' &&
                  t.tokenId !== token.tokenId,
              )
              if (waitingTokens.length < inEdges.length - 1) {
                token.state = 'waiting'
                changed = true
                break
              }
              for (const wt of waitingTokens) {
                wt.state = 'completed'
              }
              token.state = 'completed'

              for (const edge of outEdges) {
                instance.tokens.push({
                  tokenId: uuidv4(),
                  nodeId: edge.targetNodeId,
                  state: 'active',
                  createdAt: new Date(),
                })
              }
              changed = true
            } else {
              // Fork behavior (diverging): evaluate all conditions, fork to every matching edge
              token.state = 'completed'
              const { evaluateExpression } = await import('@schema-form/flow-shared')
              const matchingEdges = outEdges.filter((edge) => {
                if (!edge.conditionExpression) return false
                return evaluateExpression(edge.conditionExpression, instance.variables)
              })

              if (matchingEdges.length > 0) {
                for (const edge of matchingEdges) {
                  instance.tokens.push({
                    tokenId: uuidv4(),
                    nodeId: edge.targetNodeId,
                    state: 'active',
                    createdAt: new Date(),
                  })
                }
              } else {
                // No condition matched — fall back to defaultFlow
                const defaultEdge = outEdges.find((e) => e.isDefault)
                if (defaultEdge) {
                  instance.tokens.push({
                    tokenId: uuidv4(),
                    nodeId: defaultEdge.targetNodeId,
                    state: 'active',
                    createdAt: new Date(),
                  })
                }
              }
              changed = true
            }
            break
          }

          case BpmnElementType.ParallelGateway: {
            const inEdges = model.getIncoming(token.nodeId)
            const outEdges = model.getOutgoing(token.nodeId)

            if (inEdges.length > 1) {
              const waitingTokens = instance.tokens.filter(
                (t: FlowToken) => t.nodeId === token.nodeId && t.state === 'active' && t.tokenId !== token.tokenId,
              )
              if (waitingTokens.length < inEdges.length - 1) {
                token.state = 'waiting'
                if (!token.waitingSince) {
                  token.waitingSince = new Date()
                }
                changed = true
                break
              }
              for (const wt of waitingTokens) {
                wt.state = 'completed'
              }
              token.state = 'completed'

              for (const edge of outEdges) {
                instance.tokens.push({
                  tokenId: uuidv4(),
                  nodeId: edge.targetNodeId,
                  state: 'active',
                  createdAt: new Date(),
                })
              }
              changed = true
            } else {
              token.state = 'completed'
              for (const edge of outEdges) {
                instance.tokens.push({
                  tokenId: uuidv4(),
                  nodeId: edge.targetNodeId,
                  state: 'active',
                  createdAt: new Date(),
                })
              }
              changed = true
            }
            break
          }

          case BpmnElementType.SubProcess: {
            const outEdges = model.getOutgoing(token.nodeId)
            if (!node.config.subProcessDefinitionId) {
              token.nodeId = outEdges[0]?.targetNodeId ?? token.nodeId
              changed = true
              break
            }

            const existingChild = await FlowInstanceModel.findOne({
              parentInstanceId: instance._id,
              parentTokenId: token.tokenId,
              status: { $in: ['running', 'suspended'] },
            })

            if (!existingChild) {
              const childInstance = await this.startFlow(
                node.config.subProcessDefinitionId,
                instance.variables,
                instance.initiatedBy,
              )

              if (childInstance) {
                childInstance.parentInstanceId = instance._id
                childInstance.parentTokenId = token.tokenId
                await childInstance.save()
              }

              token.state = 'waiting'
              changed = true
            } else if (existingChild.status === 'completed') {
              if (existingChild.variables) {
                Object.assign(instance.variables, existingChild.variables)
              }
              token.state = 'active'
              if (outEdges.length > 0) {
                token.nodeId = outEdges[0].targetNodeId
              }
              changed = true
            }
            break
          }

          default: {
            const outEdges = model.getOutgoing(token.nodeId)
            if (outEdges.length > 0) {
              token.nodeId = outEdges[0].targetNodeId
              changed = true
            }
            break
          }
        }
      }
    }

    const remainingActive = instance.tokens.filter(
      (t: FlowToken) => t.state === 'active' || t.state === 'waiting',
    )
    if (remainingActive.length === 0) {
      instance.status = 'completed'
      instance.completedAt = new Date()
    }

    const isCompleted = instance.status === 'completed'
    await instance.save()

    // Notify the flow initiator when the flow completes
    if (isCompleted && instance.initiatedBy) {
      const flowDef = await FlowDefinitionModel.findById(instance.definitionId)
      await notificationService.createFlowCompletedNotification(
        instance._id,
        instance.initiatedBy,
        flowDef?.name,
      ).catch((err) => { console.error('[notification] failed:', err) })
    }

    // Emit webhook event for flow completion
    if (isCompleted) {
      eventBus.emit('flow.completed', {
        instanceId: instance._id,
        definitionId: instance.definitionId,
      }).catch((err) => console.error('[flow.completed] emit failed:', err))
    }

    if (instance.status === 'completed' && instance.parentInstanceId) {
      await this.advance(instance.parentInstanceId)
    }
  }

  async completeTask(taskId: string, formData?: Record<string, unknown>, outcome?: string, userId?: string) {
    const task = await TaskInstanceModel.findById(taskId)
    if (!task) throw new Error('Task not found')
    if (task.status !== 'pending' && task.status !== 'claimed') {
      throw new Error('Task is not in a completable state')
    }

    // Authorization: verify user is eligible to complete
    if (userId) {
      const isAssignee = task.assignee === userId
      const inCandidateUsers = task.candidateUsers && task.candidateUsers.includes(userId)
      if (!isAssignee && !inCandidateUsers) {
        throw new Error('You are not authorized to complete this task')
      }
    }

    task.status = 'completed'
    if (formData) task.formData = formData
    if (outcome) task.outcome = outcome
    await task.save()

    const instance = await FlowInstanceModel.findById(task.instanceId)
    if (!instance) throw new Error('Instance not found')

    // Log approval action
    const operator = task.assignee ?? task.candidateUsers?.[0] ?? 'unknown'
    await this.logApproval({
      instanceId: instance._id,
      nodeId: task.nodeId,
      nodeName: task.nodeName,
      taskId: task._id,
      action: outcome === 'rejected' ? 'reject' : 'approve',
      operator,
      outcome: outcome ?? undefined,
    })

    // Notify flow initiator when a task is rejected
    if (outcome === 'rejected' && instance.initiatedBy) {
      await notificationService.createTaskRejectedNotification(
        task._id,
        instance.initiatedBy,
        task.nodeName,
        operator,
      ).catch((err) => { console.error('[notification] failed:', err) })

      // Emit webhook event for flow rejection
      eventBus.emit('flow.rejected', {
        instanceId: instance._id,
        definitionId: instance.definitionId,
        reason: `Task "${task.nodeName}" rejected by ${operator}`,
      }).catch((err) => console.error('[flow.rejected] emit failed:', err))
    }

    // Write form data to instance variables only if formVariable is configured
    const flowVersion = await FlowVersionModel.findById(instance.versionId)
    if (flowVersion && formData) {
      const model = parseBpmnGraph(flowVersion.graph)
      const node = model.getNode(task.nodeId)
      if (node?.config.formVariable) {
        instance.variables[node.config.formVariable] = formData
      }
    }

    const token = instance.tokens.find(
      (t: FlowToken) => t.nodeId === task.nodeId && t.state === 'waiting',
    )
    if (!token) {
      await instance.save()
      return
    }

    // Handle rejection policy for or-sign nodes
    if (outcome === 'rejected' && flowVersion) {
      const model = parseBpmnGraph(flowVersion.graph)
      const node = model.getNode(task.nodeId)
      if (node?.config.approvalMode === 'or-sign') {
        const rejectPolicy = await this.getRejectPolicy(instance, task.nodeId)
        if (rejectPolicy === 'reject-on-any') {
          // Cancel all remaining tasks for this node
          await TaskInstanceModel.updateMany(
            { instanceId: instance._id, nodeId: task.nodeId, status: { $in: ['pending', 'claimed'] } },
            { status: 'cancelled' },
          )
          // Advance token past the node (treat as completed despite rejection)
          token.state = 'active'
          const outEdges = model.getOutgoing(task.nodeId)
          if (outEdges.length > 0) {
            token.nodeId = outEdges[0].targetNodeId
          }
          await instance.save()
          await this.advance(instance._id)
          return
        }
        // reject-on-all: let remaining tasks complete normally (current behavior)
      }
    }

    token.state = 'active'
    // For single-mode UserTasks (not multi-instance), move the token past the completed node
    // before advancing. Without this, advance() re-enters the same UserTask and creates a
    // duplicate task. For multi-instance modes (countersign/or-sign/sequential/parallel),
    // advance() handles the completion logic and token stays at the same node.
    if (flowVersion) {
      const completeModel = parseBpmnGraph(flowVersion.graph)
      const completedNode = completeModel.getNode(task.nodeId)
      const approvalMode = (completedNode?.config?.approvalMode as string) ?? 'single'
      const multiInstanceType = completedNode?.config?.multiInstance?.type
      const isMultiInstance = approvalMode !== 'single' || (multiInstanceType && multiInstanceType !== 'none')
      if (!isMultiInstance) {
        const outEdgesForComplete = completeModel.getOutgoing(task.nodeId)
        if (outEdgesForComplete.length > 0) {
          token.nodeId = outEdgesForComplete[0].targetNodeId
        }
      }
    }
    await instance.save()
    await this.advance(instance._id)
  }

  /**
   * Collect form data from all upstream completed UserTask nodes for a given task.
   * Traverses the flow graph backwards from the current node following incoming edges.
   * Returns a NodeFormDataMap keyed by nodeId.
   */
  async getUpstreamNodeData(taskId: string): Promise<UpstreamNodeData> {
    const task = await TaskInstanceModel.findById(taskId)
    if (!task) throw new Error('Task not found')

    const instance = await FlowInstanceModel.findById(task.instanceId)
    if (!instance) throw new Error('Instance not found')

    const flowVersion = await FlowVersionModel.findById(instance.versionId)
    if (!flowVersion) throw new Error('Flow version not found')

    const model = parseBpmnGraph(flowVersion.graph)

    // BFS backwards from current node to find all upstream UserTask nodes
    const visited = new Set<string>()
    const queue = [task.nodeId]
    const upstreamUserTaskNodeIds: string[] = []
    const hasStartEventUpstream = new Set<string>()

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (visited.has(nodeId)) continue
      visited.add(nodeId)

      const inEdges = model.getIncoming(nodeId)
      for (const edge of inEdges) {
        const sourceNode = model.getNode(edge.sourceNodeId)
        if (!sourceNode) continue

        if (sourceNode.bpmnType === BpmnElementType.UserTask) {
          upstreamUserTaskNodeIds.push(sourceNode.id)
        } else if (sourceNode.bpmnType === BpmnElementType.StartEvent) {
          hasStartEventUpstream.add(nodeId)
        }
        queue.push(edge.sourceNodeId)
      }
    }

    // Query completed tasks at those upstream nodes to get their formData
    const nodeData: NodeFormDataMap = {}

    if (upstreamUserTaskNodeIds.length > 0) {
      const completedTasks = await TaskInstanceModel.find({
        instanceId: instance._id,
        nodeId: { $in: upstreamUserTaskNodeIds },
        status: 'completed',
        formData: { $ne: null },
      }).lean()

      for (const completedTask of completedTasks) {
        const t = completedTask as unknown as { nodeId: string; formData?: Record<string, unknown> }
        if (t.formData && !nodeData[t.nodeId]) {
          // Use the first completed task's data per node (most recent is sufficient)
          nodeData[t.nodeId] = t.formData
        }
      }
    }

    // If startEvent is upstream, include instance variables as startEvent data
    // This allows {{startEvent.fieldName}} to reference flow initiator's data
    if (hasStartEventUpstream.size > 0 && instance.variables && Object.keys(instance.variables).length > 0) {
      nodeData['startEvent'] = instance.variables
    }

    return {
      taskId: task._id,
      currentNodeId: task.nodeId,
      nodeData,
    }
  }

  async terminateInstance(instanceId: string) {
    const instance = await FlowInstanceModel.findById(instanceId)
    if (!instance) throw new Error('Instance not found')
    if (instance.status !== 'running' && instance.status !== 'suspended') {
      throw new Error('Instance is not in a terminable state')
    }

    const children = await FlowInstanceModel.find({
      parentInstanceId: instanceId,
      status: { $in: ['running', 'suspended'] },
    })
    for (const child of children) {
      await this.terminateInstance(child._id)
    }

    instance.status = 'terminated'
    instance.completedAt = new Date()
    await instance.save()

    await TaskInstanceModel.updateMany(
      { instanceId, status: { $in: ['pending', 'claimed'] } },
      { status: 'cancelled' },
    )

    await TimerJobModel.updateMany(
      { instanceId, status: 'pending' },
      { status: 'cancelled' },
    )
  }

  async suspendInstance(instanceId: string) {
    const instance = await FlowInstanceModel.findById(instanceId)
    if (!instance || instance.status !== 'running') {
      throw new Error('Instance not found or not running')
    }
    instance.status = 'suspended'
    await instance.save()
  }

  async resumeInstance(instanceId: string) {
    const instance = await FlowInstanceModel.findById(instanceId)
    if (!instance || instance.status !== 'suspended') {
      throw new Error('Instance not found or not suspended')
    }
    instance.status = 'running'
    await instance.save()
    await this.advance(instance._id)
  }

  async fireTimerJob(jobId: string): Promise<boolean> {
    const job = await TimerJobModel.findById(jobId)
    if (!job || job.status !== 'pending') return false

    job.status = 'fired'
    await job.save()

    const instance = await FlowInstanceModel.findById(job.instanceId)
    if (!instance || instance.status !== 'running') return false

    const token = instance.tokens.find(
      (t: FlowToken) => t.tokenId === job.tokenId && t.state === 'waiting',
    )
    if (!token) return false

    // Move token past the timer event to the next node
    const flowVersion = await FlowVersionModel.findById(instance.versionId)
    if (!flowVersion) return false

    const model = parseBpmnGraph(flowVersion.graph)
    const outEdges = model.getOutgoing(job.nodeId)
    if (outEdges.length > 0) {
      token.nodeId = outEdges[0].targetNodeId
    }
    token.state = 'active'
    await instance.save()

    await this.advance(instance._id)
    return true
  }

  async fireDueTimers(): Promise<{ checked: number; fired: number }> {
    const now = new Date()
    const pendingJobs = await TimerJobModel.find({
      status: 'pending',
      fireAt: { $lte: now },
    }).limit(100)

    let fired = 0
    for (const job of pendingJobs) {
      const success = await this.fireTimerJob(job._id)
      if (success) fired++
    }

    return { checked: pendingJobs.length, fired }
  }

  async checkParallelGatewayTimeouts(): Promise<{ checked: number; timedOut: number }> {
    // Find all running instances that have waiting tokens at parallel gateways
    const runningInstances = await FlowInstanceModel.find({
      status: 'running',
      'tokens.state': 'waiting',
    }).limit(100)

    let timedOut = 0
    for (const instance of runningInstances) {
      const flowVersion = await FlowVersionModel.findById(instance.versionId)
      if (!flowVersion) continue

      const model = parseBpmnGraph(flowVersion.graph)
      if (this.checkJoinTimeouts(instance, model)) {
        await instance.save()
        timedOut++
      }
    }

    return { checked: runningInstances.length, timedOut }
  }
}

export const flowEngine = new FlowEngine()
