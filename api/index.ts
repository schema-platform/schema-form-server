import app from '../src/app.js'
import { connectDatabase, mongoose } from '../src/config/database.js'

let dbReady = false
let connectionError: Error | null = null

export default async function handler(req: any, res: any) {
  // Recover from previous connection error if mongoose reconnected
  if (connectionError && mongoose.connection.readyState === 1) {
    connectionError = null
    dbReady = true
  }

  // Initial connection
  try {
    if (!dbReady) {
      await connectDatabase()
      dbReady = true
      connectionError = null
    }
  } catch (err) {
    connectionError = err instanceof Error ? err : new Error(String(err))
    console.error('[serverless] MongoDB connection failed:', connectionError.message)
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      success: false,
      error: { message: 'Database unavailable. Please try again later.' },
    }))
    return
  }

  // Reconnect if mongoose disconnected between invocations
  if (mongoose.connection.readyState !== 1) {
    dbReady = false
    try {
      await connectDatabase()
      dbReady = true
      connectionError = null
    } catch (err) {
      connectionError = err instanceof Error ? err : new Error(String(err))
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        success: false,
        error: { message: 'Database connection lost. Please retry.' },
      }))
      return
    }
  }

  app.callback()(req, res)
}
