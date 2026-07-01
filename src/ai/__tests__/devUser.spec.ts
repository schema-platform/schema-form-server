/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findOne = vi.fn()

vi.mock('../../models/User.js', () => ({
  UserModel: { findOne: (...args: unknown[]) => findOne(...args) },
}))

import { resolveDevelopmentUser, DevAuthUserNotFoundError } from '../../utils/devUser.js'

describe('resolveDevelopmentUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.DEV_AUTH_USERNAME
    delete process.env.DEV_AUTH_TENANT_ID
  })

  it('returns real admin user from database', async () => {
    findOne.mockReturnValue({
      lean: async () => ({
        _id: '507f1f77bcf86cd799439099',
        username: 'admin',
        roles: ['admin'],
        tenantId: '000000',
        status: 'active',
        deptId: null,
      }),
    })

    const user = await resolveDevelopmentUser()
    expect(user.id).toBe('507f1f77bcf86cd799439099')
    expect(user.username).toBe('admin')
    expect(user.id).not.toBe('dev')
  })

  it('throws when user missing instead of fake dev id', async () => {
    findOne.mockReturnValue({ lean: async () => null })
    await expect(resolveDevelopmentUser()).rejects.toBeInstanceOf(DevAuthUserNotFoundError)
  })

  it('respects DEV_AUTH_USERNAME', async () => {
    process.env.DEV_AUTH_USERNAME = 'tester'
    findOne.mockReturnValue({
      lean: async () => ({
        _id: '507f1f77bcf86cd799439088',
        username: 'tester',
        roles: [],
        tenantId: '000000',
        status: 'active',
        deptId: null,
      }),
    })

    const user = await resolveDevelopmentUser()
    expect(user.username).toBe('tester')
    expect(findOne).toHaveBeenCalledWith({ username: 'tester', tenantId: '000000' })
  })
})
