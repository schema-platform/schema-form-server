import { v4 as uuidv4 } from 'uuid'
import { type NotificationType, type INotification, NotificationModel } from '../flow-models/Notification.js'
import { getIO } from '../socket.js'

interface TaskNotificationData {
  taskId: string
  taskName: string
  instanceId?: string
  assignee?: string
  delegatedBy?: string
  rejector?: string
  flowName?: string
}

export class NotificationService {
  private get model() {
    return NotificationModel
  }

  private getTitle(type: NotificationType, data: TaskNotificationData): string {
    switch (type) {
      case 'task_created':
        return `新任务: ${data.taskName}`
      case 'task_timeout':
        return `任务即将超时: ${data.taskName}`
      case 'task_completed':
        return `任务已完成: ${data.taskName}`
      case 'task_delegated':
        return `任务已委派: ${data.taskName}`
      case 'task_rejected':
        return `任务已驳回: ${data.taskName}`
      case 'flow_completed':
        return `流程已完成: ${data.flowName ?? data.taskName}`
      default:
        return `任务通知: ${data.taskName}`
    }
  }

  private getContent(type: NotificationType, data: TaskNotificationData): string {
    switch (type) {
      case 'task_created':
        return `您有一个新的待办任务「${data.taskName}」，请及时处理。`
      case 'task_timeout':
        return `任务「${data.taskName}」即将到达截止时间，请尽快处理。`
      case 'task_completed':
        return `任务「${data.taskName}」已被完成。`
      case 'task_delegated':
        return `任务「${data.taskName}」已由 ${data.delegatedBy ?? '未知用户'} 委派给您。`
      case 'task_rejected':
        return `您提交的任务「${data.taskName}」已被 ${data.rejector ?? '审批人'} 驳回，请查看并修改。`
      case 'flow_completed':
        return `流程「${data.flowName ?? data.taskName}」已全部完成。`
      default:
        return ''
    }
  }

  async sendNotification(userId: string, type: NotificationType, data: TaskNotificationData): Promise<INotification> {
    const doc = await this.model.create({
      _id: uuidv4(),
      userId,
      type,
      title: this.getTitle(type, data),
      content: this.getContent(type, data),
      relatedId: data.taskId,
      relatedType: 'task',
    })

    const notification = doc.toObject() as INotification
    this.pushToClient(userId, notification)
    return notification
  }

  private pushToClient(userId: string, notification: INotification): void {
    const io = getIO()
    if (!io) return
    // Emit to the user's personal room
    io.to(`user:${userId}`).emit('flow:notification', {
      id: notification._id,
      userId: notification.userId,
      type: notification.type,
      title: notification.title,
      content: notification.content,
      relatedId: notification.relatedId,
      relatedType: notification.relatedType,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
    })
  }

  async sendBatchNotifications(userIds: string[], type: NotificationType, data: TaskNotificationData): Promise<void> {
    const notifications = userIds.map((userId) => ({
      _id: uuidv4(),
      userId,
      type,
      title: this.getTitle(type, data),
      content: this.getContent(type, data),
      relatedId: data.taskId,
      relatedType: 'task' as const,
    }))

    await this.model.insertMany(notifications)
  }

  /**
   * Create a notification when a task is assigned to a user.
   */
  async createTaskAssignedNotification(taskId: string, userId: string, taskName?: string): Promise<INotification> {
    return this.sendNotification(userId, 'task_created', {
      taskId,
      taskName: taskName ?? '待办任务',
    })
  }

  /**
   * Create a notification when a task is rejected — sent to the original task submitter.
   */
  async createTaskRejectedNotification(
    taskId: string,
    submitterUserId: string,
    taskName?: string,
    rejector?: string,
  ): Promise<INotification> {
    return this.sendNotification(submitterUserId, 'task_rejected', {
      taskId,
      taskName: taskName ?? '待办任务',
      rejector,
    })
  }

  /**
   * Create a notification when the entire flow instance is completed — sent to the initiator.
   */
  async createFlowCompletedNotification(
    instanceId: string,
    initiatorUserId: string,
    flowName?: string,
  ): Promise<INotification> {
    return this.sendNotification(initiatorUserId, 'flow_completed', {
      taskId: instanceId,
      taskName: flowName ?? '流程',
      instanceId,
      flowName,
    })
  }

  async getNotifications(
    userId: string,
    options: { page?: number; pageSize?: number; unreadOnly?: boolean } = {},
  ): Promise<{ items: INotification[]; total: number; unreadCount: number }> {
    const { page = 1, pageSize = 20, unreadOnly = false } = options
    const skip = (page - 1) * pageSize

    const filter: Record<string, unknown> = { userId }
    if (unreadOnly) {
      filter.isRead = false
    }

    const [items, total, unreadCount] = await Promise.all([
      this.model.find(filter).skip(skip).limit(pageSize).sort({ createdAt: -1 }).lean(),
      this.model.countDocuments(filter),
      this.model.countDocuments({ userId, isRead: false }),
    ])

    return { items: items as unknown as INotification[], total, unreadCount }
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.model.countDocuments({ userId, isRead: false })
  }

  async markAsRead(notificationId: string, userId: string): Promise<INotification | null> {
    return this.model.findOneAndUpdate(
      { _id: notificationId, userId },
      { isRead: true },
      { new: true },
    ).lean() as Promise<INotification | null>
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.model.updateMany(
      { userId, isRead: false },
      { isRead: true },
    )
    return result.modifiedCount
  }

  async markBatchAsRead(ids: string[], userId: string): Promise<number> {
    const result = await this.model.updateMany(
      { _id: { $in: ids }, userId, isRead: false },
      { isRead: true },
    )
    return result.modifiedCount
  }
}

export const notificationService = new NotificationService()
