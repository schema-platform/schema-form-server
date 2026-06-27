/**
 * Socket.io 服务端
 *
 * 挂载在 Koa HTTP server 上，提供 AI ↔ 宿主的实时通信。
 *
 * 事件协议：
 * - ai:apply       — AI 推送生成结果到宿主（Editor/Flow）
 * - ai:published   — AI 通知发布完成
 * - join / leave   — 客户端加入/离开房间
 */

import { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from './config/jwt.js'
import type { JwtPayload } from './middleware/auth.js'
import { registerChatHandlers } from './ai/chatStreamHandler.js'

let io: Server | null = null

export function initSocket(httpServer: HttpServer): Server {
  const origins = process.env.CORS_ORIGINS || 'http://localhost:4000,http://localhost:5051,http://localhost:5100,http://localhost:5200,http://localhost:5300,http://localhost:5400,http://127.0.0.1:4000,https://schema-form-platform.vercel.app'

  io = new Server(httpServer, {
    path: '/ws',
    cors: {
      origin: origins.split(',').map((s) => s.trim()),
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  })

  // JWT authentication middleware for Socket.io
  io.use((socket, next) => {
    // Skip auth in development
    if (process.env.NODE_ENV !== 'production') {
      socket.data.user = { id: 'dev', username: 'dev', roles: [], tenantId: '000000' }
      next()
      return
    }

    const token = socket.handshake.auth?.token as string | undefined
      ?? socket.handshake.query?.token as string | undefined

    if (!token) {
      next(new Error('Authentication required'))
      return
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as JwtPayload
      if (payload.tokenType === 'refresh') {
        next(new Error('Access token required'))
        return
      }
      socket.data.user = payload
      next()
    } catch {
      next(new Error('Invalid or expired token'))
    }
  })

  io.on('connection', (socket) => {
    console.log(`[socket] client connected: ${socket.id}`)

    // 注册 AI Chat 事件处理器
    if (io) registerChatHandlers(socket, io)

    // 加入房间（editor:{schemaId} 或 flow:{flowId} 或 user:{userId}）
    socket.on('join', (room: string) => {
      socket.join(room)
      console.log(`[socket] ${socket.id} joined room: ${room}`)
    })

    // 用户身份注册（加入个人房间以接收通知）
    socket.on('identify', (userId: string) => {
      if (userId) {
        socket.join(`user:${userId}`)
        console.log(`[socket] ${socket.id} identified as user: ${userId}`)
      }
    })

    // 离开房间
    socket.on('leave', (room: string) => {
      socket.leave(room)
      console.log(`[socket] ${socket.id} left room: ${room}`)
    })

    // AI → 宿主：应用生成结果
    // 客户端 emit 时带 room 字段，服务端转发到该房间
    socket.on('ai:apply', (data: { room?: string; [key: string]: unknown }) => {
      const { room, ...payload } = data
      if (room) {
        socket.to(room).emit('ai:apply', payload)
      } else {
        // 无 room 则广播给所有非发送者
        socket.broadcast.emit('ai:apply', payload)
      }
    })

    // AI → 宿主：发布完成
    socket.on('ai:published', (data: { room?: string; [key: string]: unknown }) => {
      const { room, ...payload } = data
      if (room) {
        socket.to(room).emit('ai:published', payload)
      } else {
        socket.broadcast.emit('ai:published', payload)
      }
    })

    socket.on('disconnect', () => {
      console.log(`[socket] client disconnected: ${socket.id}`)
    })
  })

  console.log('[socket] Socket.io server initialized on path /ws')
  return io
}

export function getIO(): Server | null {
  return io
}
