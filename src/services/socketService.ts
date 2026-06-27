/**
 * Socket Service - Socket.IO 服务封装
 *
 * 提供向用户/房间发送消息的能力
 */

let io: unknown = null

export function setSocketInstance(socketIo: unknown) {
  io = socketIo
}

export const socketService = {
  /**
   * 向指定用户发送事件
   */
  emitToUser(userId: string, event: string, data: unknown) {
    if (!io) return
    // 用户加入自己的房间（在连接时自动完成）
    // 这里通过用户房间发送
    ;(io as { to: (room: string) => { emit: (event: string, data: unknown) => void } })
      .to(`user:${userId}`)
      .emit(event, data)
  },

  /**
   * 向指定房间发送事件
   */
  emitToRoom(room: string, event: string, data: unknown) {
    if (!io) return
    ;(io as { to: (room: string) => { emit: (event: string, data: unknown) => void } })
      .to(room)
      .emit(event, data)
  },

  /**
   * 向所有客户端发送事件
   */
  emitAll(event: string, data: unknown) {
    if (!io) return
    ;(io as { emit: (event: string, data: unknown) => void })
      .emit(event, data)
  },

  /**
   * 获取 Socket.IO 实例
   */
  getIO() {
    return io
  },
}
