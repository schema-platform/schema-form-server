/**
 * Structured logger utility.
 *
 * Provides consistent logging format across the server.
 * In development: pretty-printed JSON to stdout.
 * In production: structured JSON for log aggregation.
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

interface LogEntry {
  level: LogLevel
  msg?: string
  timestamp: string
  [key: string]: unknown
}

function formatLog(level: LogLevel, data: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    ...data,
  }

  const output = process.env.NODE_ENV === 'production'
    ? JSON.stringify(entry)
    : JSON.stringify(entry, null, 2)

  switch (level) {
    case 'error':
      console.error(output)
      break
    case 'warn':
      console.warn(output)
      break
    default:
      console.log(output)
  }
}

export const logger = {
  info(data: Record<string, unknown> & { msg: string }): void {
    formatLog('info', data)
  },

  warn(data: Record<string, unknown> & { msg: string }): void {
    formatLog('warn', data)
  },

  error(data: Record<string, unknown> & { msg: string }): void {
    formatLog('error', data)
  },

  debug(data: Record<string, unknown> & { msg: string }): void {
    if (process.env.NODE_ENV === 'development') {
      formatLog('debug', data)
    }
  },
}
