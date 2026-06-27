import { v4 as uuidv4 } from 'uuid'
import { TaskInstanceModel } from '../flow-models/TaskInstance.js'
import { FlowInstanceModel } from '../flow-models/FlowInstance.js'
import { ApprovalLogModel } from '../flow-models/ApprovalLog.js'
import { UserModel } from '../models/User.js'

export class TaskService {
  async getMyTasks(
    userId: string,
    page = 1,
    pageSize = 20,
    opts?: { status?: string; q?: string; instanceOwnerFilter?: Record<string, unknown> },
  ) {
    const skip = (page - 1) * pageSize

    // Fetch user roles for role-based matching
    const user = await UserModel.findById(userId).select('roles').lean()
    const userRoles = (user as { roles?: string[] } | null)?.roles ?? []

    const filter: Record<string, unknown> = {
      $or: [
        { assignee: userId },
        { candidateUsers: userId },
        { candidateRoles: { $in: userRoles } },
      ],
    }

    // Status filter: if provided use it, otherwise default to pending+claimed
    if (opts?.status) {
      filter.status = opts.status
    } else {
      filter.status = { $in: ['pending', 'claimed'] }
    }

    // Keyword search on nodeName
    if (opts?.q) {
      const escaped = opts.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      filter.nodeName = { $regex: escaped, $options: 'i' }
    }

    // Data scope: restrict by flow instance owner
    if (opts?.instanceOwnerFilter) {
      const scopedInstances = await FlowInstanceModel.find(opts.instanceOwnerFilter).select('_id').lean()
      const instanceIds = scopedInstances.map(i => (i as { _id: string })._id)
      filter.instanceId = { $in: instanceIds }
    }

    const [items, total] = await Promise.all([
      TaskInstanceModel.find(filter).skip(skip).limit(pageSize).sort({ createdAt: -1 }),
      TaskInstanceModel.countDocuments(filter),
    ])

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
  }

  async getTasksForInstance(instanceId: string) {
    return TaskInstanceModel.find({ instanceId }).sort({ createdAt: 1 })
  }

  async claimTask(taskId: string, userId: string) {
    const task = await TaskInstanceModel.findById(taskId)
    if (!task) throw new Error('Task not found')
    if (task.status !== 'pending') throw new Error('Task is not pending')

    // Authorization: verify user is eligible to claim
    const hasCandidateUsers = task.candidateUsers && task.candidateUsers.length > 0
    const hasCandidateRoles = task.candidateRoles && task.candidateRoles.length > 0
    if (hasCandidateUsers || hasCandidateRoles) {
      const inCandidateUsers = hasCandidateUsers && task.candidateUsers!.includes(userId)
      if (!inCandidateUsers) {
        if (hasCandidateRoles) {
          // Role-based matching: fetch user roles and check intersection
          const user = await UserModel.findById(userId).select('roles').lean()
          const userRoles = (user as { roles?: string[] } | null)?.roles ?? []
          const hasMatchingRole = userRoles.some(role => task.candidateRoles!.includes(role))
          if (!hasMatchingRole) {
            throw new Error('You are not authorized to claim this task')
          }
        } else {
          throw new Error('You are not authorized to claim this task')
        }
      }
    }

    task.status = 'claimed'
    task.assignee = userId
    await task.save()

    await ApprovalLogModel.create({
      _id: uuidv4(),
      instanceId: task.instanceId,
      nodeId: task.nodeId,
      nodeName: task.nodeName,
      taskId: task._id,
      action: 'claim',
      operator: userId,
    })

    return task
  }

  async delegateTask(taskId: string, targetUserId: string) {
    const task = await TaskInstanceModel.findById(taskId)
    if (!task) throw new Error('Task not found')
    if (task.status !== 'pending' && task.status !== 'claimed') {
      throw new Error('Task cannot be delegated')
    }

    const operator = task.assignee ?? task.candidateUsers?.[0] ?? 'unknown'
    task.status = 'delegated'
    task.assignee = targetUserId
    await task.save()

    await ApprovalLogModel.create({
      _id: uuidv4(),
      instanceId: task.instanceId,
      nodeId: task.nodeId,
      nodeName: task.nodeName,
      taskId: task._id,
      action: 'delegate',
      operator,
      outcome: targetUserId,
    })

    return task
  }

  async approveTask(taskId: string, userId: string) {
    const task = await TaskInstanceModel.findById(taskId)
    if (!task) throw new Error('Task not found')
    if (task.status !== 'pending' && task.status !== 'claimed') {
      throw new Error('Task cannot be approved')
    }

    task.status = 'completed'
    task.outcome = 'approved'
    await task.save()

    await ApprovalLogModel.create({
      _id: uuidv4(),
      instanceId: task.instanceId,
      nodeId: task.nodeId,
      nodeName: task.nodeName,
      taskId: task._id,
      action: 'approve',
      operator: userId,
      outcome: 'approved',
    })

    return task
  }

  async rejectTask(taskId: string, userId: string, opts?: { reason?: string }) {
    const task = await TaskInstanceModel.findById(taskId)
    if (!task) throw new Error('Task not found')
    if (task.status !== 'pending' && task.status !== 'claimed') {
      throw new Error('Task cannot be rejected')
    }

    task.status = 'cancelled'
    task.outcome = 'rejected'
    await task.save()

    await ApprovalLogModel.create({
      _id: uuidv4(),
      instanceId: task.instanceId,
      nodeId: task.nodeId,
      nodeName: task.nodeName,
      taskId: task._id,
      action: 'reject',
      operator: userId,
      outcome: opts?.reason ?? 'rejected',
    })

    return task
  }
}

export const taskService = new TaskService()
