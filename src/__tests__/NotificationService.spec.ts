import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the NotificationModel directly instead of mocking mongoose
const mockModel = {
  create: vi.fn(),
  insertMany: vi.fn(),
  find: vi.fn(),
  countDocuments: vi.fn(),
  findOneAndUpdate: vi.fn(),
  updateMany: vi.fn(),
}

vi.mock('../flow-models/Notification.js', () => ({
  NotificationModel: mockModel,
}))

vi.mock('../socket.js', () => ({
  getIO: vi.fn().mockReturnValue(null),
}))

// Import after mock setup
const { NotificationService } = await import('../flow-services/NotificationService.js')

describe('NotificationService', () => {
  let service: InstanceType<typeof NotificationService>

  beforeEach(() => {
    service = new NotificationService()
    vi.clearAllMocks()
  })

  describe('sendNotification', () => {
    it('should create a notification with correct fields', async () => {
      const mockNotification = {
        _id: 'test-id',
        userId: 'user-1',
        type: 'task_created',
        title: '新任务: Test Task',
        content: '您有一个新的待办任务「Test Task」，请及时处理。',
        relatedId: 'task-1',
        relatedType: 'task',
        isRead: false,
        toObject: () => mockNotification,
      }

      mockModel.create.mockResolvedValue(mockNotification)

      const result = await service.sendNotification('user-1', 'task_created', {
        taskId: 'task-1',
        taskName: 'Test Task',
      })

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'task_created',
          title: '新任务: Test Task',
          content: '您有一个新的待办任务「Test Task」，请及时处理。',
          relatedId: 'task-1',
          relatedType: 'task',
        }),
      )
      expect(result).toEqual(mockNotification)
    })

    it('should generate correct title for task_timeout', async () => {
      mockModel.create.mockResolvedValue({
        toObject: () => ({}),
      })

      await service.sendNotification('user-1', 'task_timeout', {
        taskId: 'task-1',
        taskName: 'Urgent Task',
      })

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '任务即将超时: Urgent Task',
        }),
      )
    })

    it('should generate correct title for task_delegated', async () => {
      mockModel.create.mockResolvedValue({
        toObject: () => ({}),
      })

      await service.sendNotification('user-2', 'task_delegated', {
        taskId: 'task-1',
        taskName: 'Delegated Task',
        delegatedBy: 'user-1',
      })

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '任务已委派: Delegated Task',
          content: expect.stringContaining('user-1'),
        }),
      )
    })
  })

  describe('sendBatchNotifications', () => {
    it('should create notifications for multiple users', async () => {
      mockModel.insertMany.mockResolvedValue([])

      await service.sendBatchNotifications(['user-1', 'user-2', 'user-3'], 'task_created', {
        taskId: 'task-1',
        taskName: 'Batch Task',
      })

      expect(mockModel.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ userId: 'user-1', type: 'task_created' }),
          expect.objectContaining({ userId: 'user-2', type: 'task_created' }),
          expect.objectContaining({ userId: 'user-3', type: 'task_created' }),
        ]),
      )
    })
  })

  describe('getNotifications', () => {
    it('should return paginated notifications', async () => {
      const mockItems = [
        { _id: '1', userId: 'user-1', type: 'task_created', title: 'Test 1' },
        { _id: '2', userId: 'user-1', type: 'task_timeout', title: 'Test 2' },
      ]

      mockModel.find.mockReturnValue({
        skip: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnValue({
              lean: vi.fn().mockResolvedValue(mockItems),
            }),
          }),
        }),
      })
      mockModel.countDocuments.mockResolvedValue(5)

      const result = await service.getNotifications('user-1', { page: 1, pageSize: 2 })

      expect(result.items).toEqual(mockItems)
      expect(result.total).toBe(5)
    })

    it('should filter by unreadOnly when specified', async () => {
      mockModel.find.mockReturnValue({
        skip: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnValue({
              lean: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      })
      mockModel.countDocuments.mockResolvedValue(0)

      await service.getNotifications('user-1', { unreadOnly: true })

      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ isRead: false }),
      )
    })
  })

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const mockNotification = { _id: 'notif-1', isRead: true }
      mockModel.findOneAndUpdate.mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockNotification),
      })

      const result = await service.markAsRead('notif-1', 'user-1')

      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'notif-1', userId: 'user-1' },
        { isRead: true },
        { new: true },
      )
      expect(result).toEqual(mockNotification)
    })

    it('should return null if notification not found', async () => {
      mockModel.findOneAndUpdate.mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      })

      const result = await service.markAsRead('nonexistent', 'user-1')

      expect(result).toBeNull()
    })
  })

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read', async () => {
      mockModel.updateMany.mockResolvedValue({ modifiedCount: 5 })

      const count = await service.markAllAsRead('user-1')

      expect(mockModel.updateMany).toHaveBeenCalledWith(
        { userId: 'user-1', isRead: false },
        { isRead: true },
      )
      expect(count).toBe(5)
    })
  })

  describe('getUnreadCount', () => {
    it('should return unread notification count', async () => {
      mockModel.countDocuments.mockResolvedValue(3)

      const count = await service.getUnreadCount('user-1')

      expect(mockModel.countDocuments).toHaveBeenCalledWith({
        userId: 'user-1',
        isRead: false,
      })
      expect(count).toBe(3)
    })
  })
})
