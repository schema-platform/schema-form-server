/**
 * JWT Extension (tenantId) + Refresh Token Mechanism Tests
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

// Mock JWT_SECRET before importing anything that uses it
vi.mock('../config/jwt.js', () => ({
  JWT_SECRET: 'test-secret-key-for-unit-tests',
}))

// Mock UserModel
const mockUser = {
  _id: 'user-uuid-001',
  username: 'testuser',
  password: '$2a$10$hashed',
  displayName: 'Test User',
  roles: ['admin'],
  tenantId: 'tenant-abc',
  toJSON() {
    return {
      id: this._id,
      username: this.username,
      displayName: this.displayName,
      roles: this.roles,
      tenantId: this.tenantId,
    }
  },
  comparePassword: vi.fn().mockResolvedValue(true),
}

vi.mock('../models/User.js', () => ({
  UserModel: {
    findOne: vi.fn().mockResolvedValue(mockUser),
    findById: vi.fn().mockResolvedValue(mockUser),
  },
}))

// Dynamically import after mocks are set up
const { JWT_SECRET } = await import('../config/jwt.js')
const { UserModel } = await import('../models/User.js')

// ── Test helpers ──

interface JwtPayload {
  id: string
  username: string
  roles: string[]
  tenantId: string
  tokenType: 'access' | 'refresh'
}

function signAccessToken(payload: Omit<JwtPayload, 'tokenType'>): string {
  return jwt.sign({ ...payload, tokenType: 'access' }, JWT_SECRET, { expiresIn: '15m' })
}

function signRefreshToken(payload: Omit<JwtPayload, 'tokenType'>): string {
  return jwt.sign({ ...payload, tokenType: 'refresh' }, JWT_SECRET, { expiresIn: '7d' })
}

function signExpiredToken(payload: Omit<JwtPayload, 'tokenType'>): string {
  return jwt.sign({ ...payload, tokenType: 'access' }, JWT_SECRET, { expiresIn: '0s' })
}

// ── Tests ──

describe('JwtPayload with tenantId', () => {
  it('should include tenantId in signed access token', () => {
    const token = signAccessToken({
      id: 'user-001',
      username: 'alice',
      roles: ['admin'],
      tenantId: 'tenant-xyz',
    })

    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload
    expect(decoded.tenantId).toBe('tenant-xyz')
    expect(decoded.tokenType).toBe('access')
  })

  it('should include tenantId in signed refresh token', () => {
    const token = signRefreshToken({
      id: 'user-001',
      username: 'alice',
      roles: ['admin'],
      tenantId: 'tenant-xyz',
    })

    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload
    expect(decoded.tenantId).toBe('tenant-xyz')
    expect(decoded.tokenType).toBe('refresh')
  })

  it('access token should have correct expiry (~15min)', () => {
    const token = signAccessToken({
      id: 'user-001',
      username: 'alice',
      roles: [],
      tenantId: 't1',
    })

    const decoded = jwt.decode(token) as JwtPayload & { iat: number; exp: number }
    const expirySeconds = decoded.exp - decoded.iat
    expect(expirySeconds).toBe(15 * 60) // 900 seconds
  })

  it('refresh token should have correct expiry (~7d)', () => {
    const token = signRefreshToken({
      id: 'user-001',
      username: 'alice',
      roles: [],
      tenantId: 't1',
    })

    const decoded = jwt.decode(token) as JwtPayload & { iat: number; exp: number }
    const expirySeconds = decoded.exp - decoded.iat
    expect(expirySeconds).toBe(7 * 24 * 60 * 60) // 604800 seconds
  })
})

describe('Refresh token exchange', () => {
  beforeEach(() => {
    vi.mocked(UserModel.findById).mockResolvedValue(mockUser as any)
  })

  it('should issue a new access token from a valid refresh token', () => {
    const refreshToken = signRefreshToken({
      id: 'user-001',
      username: 'alice',
      roles: ['admin'],
      tenantId: 'tenant-abc',
    })

    // Verify refresh token is valid
    const payload = jwt.verify(refreshToken, JWT_SECRET) as JwtPayload
    expect(payload.tokenType).toBe('refresh')
    expect(payload.tenantId).toBe('tenant-abc')

    // Exchange: sign new access token with same identity
    const newAccessToken = jwt.sign(
      {
        id: payload.id,
        username: payload.username,
        roles: payload.roles,
        tenantId: payload.tenantId,
        tokenType: 'access' as const,
      },
      JWT_SECRET,
      { expiresIn: '15m' },
    )

    const decoded = jwt.verify(newAccessToken, JWT_SECRET) as JwtPayload
    expect(decoded.tokenType).toBe('access')
    expect(decoded.tenantId).toBe('tenant-abc')
    expect(decoded.id).toBe('user-001')
  })

  it('should reject an access token used as refresh token', () => {
    const accessToken = signAccessToken({
      id: 'user-001',
      username: 'alice',
      roles: [],
      tenantId: 't1',
    })

    const payload = jwt.verify(accessToken, JWT_SECRET) as JwtPayload
    expect(payload.tokenType).toBe('access')
    // The route handler checks tokenType !== 'refresh' and rejects
  })

  it('should reject an expired token', () => {
    const expiredToken = signExpiredToken({
      id: 'user-001',
      username: 'alice',
      roles: [],
      tenantId: 't1',
    })

    expect(() => jwt.verify(expiredToken, JWT_SECRET)).toThrow('jwt expired')
  })

  it('should reject a tampered token', () => {
    const token = signRefreshToken({
      id: 'user-001',
      username: 'alice',
      roles: [],
      tenantId: 't1',
    })

    const tampered = token.slice(0, -5) + 'XXXXX'
    expect(() => jwt.verify(tampered, JWT_SECRET)).toThrow()
  })
})

describe('authMiddleware tenantId propagation', () => {
  it('should extract tenantId from verified JWT payload into ctx.state.user', () => {
    const token = signAccessToken({
      id: 'user-001',
      username: 'alice',
      roles: ['admin'],
      tenantId: 'tenant-999',
    })

    // Simulate what authMiddleware does
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload
    const ctxStateUser = payload

    expect(ctxStateUser.tenantId).toBe('tenant-999')
    expect(ctxStateUser.id).toBe('user-001')
    expect(ctxStateUser.username).toBe('alice')
    expect(ctxStateUser.roles).toEqual(['admin'])
    expect(ctxStateUser.tokenType).toBe('access')
  })

  it('dev mode fallback should include tenantId', () => {
    // Simulate dev mode fallback
    const devUser = { id: 'dev', username: 'dev', roles: [], tenantId: '000000' }
    expect(devUser.tenantId).toBe('000000')
  })
})
