import { v4 as uuidv4 } from 'uuid'
import { NodeExecutionLogModel, type INodeExecutionLog } from '../models/NodeExecutionLog.js'

/**
 * Record the start of a node execution.
 * Returns the created log document so callers can track it.
 */
export async function logNodeStart(
  instanceId: string,
  nodeId: string,
  nodeName: string,
  input: Record<string, unknown> = {},
): Promise<INodeExecutionLog> {
  return NodeExecutionLogModel.create({
    _id: uuidv4(),
    instanceId,
    nodeId,
    nodeName,
    status: 'running',
    input,
    startedAt: new Date(),
  })
}

/**
 * Record successful completion of a node execution.
 * Finds the most recent 'running' log for this instance+node and marks it completed.
 */
export async function logNodeComplete(
  instanceId: string,
  nodeId: string,
  output: Record<string, unknown> = {},
): Promise<void> {
  const log = await NodeExecutionLogModel.findOne({
    instanceId,
    nodeId,
    status: 'running',
  }).sort({ startedAt: -1 })

  if (!log) return

  const now = new Date()
  log.status = 'completed'
  log.output = output
  log.completedAt = now
  log.duration = now.getTime() - log.startedAt.getTime()
  await log.save()
}

/**
 * Record a failed node execution.
 * Finds the most recent 'running' log for this instance+node and marks it failed.
 */
export async function logNodeFail(
  instanceId: string,
  nodeId: string,
  error: string,
): Promise<void> {
  const log = await NodeExecutionLogModel.findOne({
    instanceId,
    nodeId,
    status: 'running',
  }).sort({ startedAt: -1 })

  if (!log) return

  const now = new Date()
  log.status = 'failed'
  log.error = error
  log.completedAt = now
  log.duration = now.getTime() - log.startedAt.getTime()
  await log.save()
}

/**
 * Get all execution logs for a flow instance, ordered by start time.
 */
export async function getInstanceLogs(instanceId: string): Promise<INodeExecutionLog[]> {
  return NodeExecutionLogModel.find({ instanceId }).sort({ startedAt: 1 }).lean<INodeExecutionLog[]>()
}
