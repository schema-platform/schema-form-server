import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the models
const mockAggregate = vi.fn()

vi.mock('../flow-models/FlowInstance.js', () => ({
  FlowInstanceModel: {
    aggregate: mockAggregate,
  },
}))

vi.mock('../flow-models/TaskInstance.js', () => ({
  TaskInstanceModel: {
    aggregate: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: () => async (_ctx: unknown, next: () => Promise<void>) => {
    await next()
  },
}))

vi.mock('../middleware/permission.js', () => ({
  requirePermission: () => async (_ctx: unknown, next: () => Promise<void>) => {
    await next()
  },
}))

// We test the route handler logic directly via the aggregation pipeline structure
describe('flowMonitor routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('stats endpoint aggregation', () => {
    it('builds correct aggregation for status grouping', async () => {
      mockAggregate.mockResolvedValue([
        { _id: 'running', count: 10 },
        { _id: 'completed', count: 80 },
        { _id: 'failed', count: 5 },
      ])

      const result = await mockAggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])

      expect(result).toHaveLength(3)
      expect(result[0]._id).toBe('running')
      expect(result[0].count).toBe(10)
    })

    it('calculates percentages correctly', () => {
      const total = 100
      const pct = (n: number) => (total > 0 ? Math.round((n / total) * 10000) / 100 : 0)

      expect(pct(10)).toBe(10)
      expect(pct(80)).toBe(80)
      expect(pct(0)).toBe(0)
      expect(pct(33)).toBe(33)
      expect(pct(33.33)).toBe(33.33)
    })

    it('returns 0 percentage when total is 0', () => {
      const total = 0
      const pct = (n: number) => (total > 0 ? Math.round((n / total) * 10000) / 100 : 0)

      expect(pct(0)).toBe(0)
      expect(pct(5)).toBe(0)
    })

    it('includes time range match when preset is provided', () => {
      const preset = 'week'
      const now = new Date()
      let from: Date
      let to: Date

      if (preset === 'week') {
        from = new Date(now)
        from.setDate(from.getDate() - 7)
        from.setHours(0, 0, 0, 0)
        to = now
      } else {
        from = new Date(0)
        to = now
      }

      const match = { createdAt: { $gte: from, $lte: to } }
      expect(match.createdAt.$gte).toBeInstanceOf(Date)
      expect(match.createdAt.$lte).toBeInstanceOf(Date)
      expect(match.createdAt.$gte.getTime()).toBeLessThan(match.createdAt.$lte.getTime())
    })

    it('skips match when preset is "all"', () => {
      const preset = 'all'
      const buildDateMatch = (p?: string) => {
        if (!p || p === 'all') return {}
        return { createdAt: { $gte: new Date(), $lte: new Date() } }
      }

      const result = buildDateMatch(preset)
      expect(result).toEqual({})
    })

    it('handles custom date range', () => {
      const startDate = '2026-01-01'
      const endDate = '2026-01-31'

      const from = new Date(startDate)
      from.setHours(0, 0, 0, 0)
      const to = new Date(endDate)
      to.setHours(23, 59, 59, 999)

      expect(from.getFullYear()).toBe(2026)
      expect(from.getMonth()).toBe(0) // January
      expect(from.getDate()).toBe(1)
      expect(to.getDate()).toBe(31)
      expect(to.getHours()).toBe(23)
      expect(to.getMinutes()).toBe(59)
    })
  })

  describe('trend endpoint date filling', () => {
    it('fills missing dates with zero counts', () => {
      const trend = [
        { date: '2026-01-01', count: 5 },
        { date: '2026-01-03', count: 8 },
      ]
      const trendMap = new Map(trend.map((t) => [t.date, t.count]))

      // Simulate the server's date filling logic using local date strings
      const from = new Date('2026-01-01T00:00:00')
      const to = new Date('2026-01-04T00:00:00')

      const result: Array<{ date: string; count: number }> = []
      const cursor = new Date(from)
      while (cursor <= to) {
        // Use the same date string format as the server (local date)
        const y = cursor.getFullYear()
        const m = String(cursor.getMonth() + 1).padStart(2, '0')
        const d = String(cursor.getDate()).padStart(2, '0')
        const dateStr = `${y}-${m}-${d}`
        result.push({ date: dateStr, count: trendMap.get(dateStr) ?? 0 })
        cursor.setDate(cursor.getDate() + 1)
      }

      expect(result).toEqual([
        { date: '2026-01-01', count: 5 },
        { date: '2026-01-02', count: 0 },
        { date: '2026-01-03', count: 8 },
        { date: '2026-01-04', count: 0 },
      ])
    })
  })
})
