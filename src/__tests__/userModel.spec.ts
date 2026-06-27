/**
 * User Model Tests
 *
 * Covers:
 * - New field CRUD (tenantId, deptId, email, phone, avatar, status)
 * - Default values
 * - Status enum validation
 * - Filtering by tenantId/deptId/status
 * - tenantPlugin integration (tenant isolation)
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { tenantStorage } from '../middleware/tenantContext.js'

// We import the real UserModel to test the actual schema
import { UserModel } from '../models/User.js'

// ── Helpers ──

async function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    tenantStorage.run({ tenantId }, async () => {
      try {
        const result = await fn()
        resolve(result)
      } catch (err) {
        reject(err)
      }
    })
  })
}

const TEST_MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/test-user-model'

beforeAll(async () => {
  mongoose.set('strictQuery', false)
  await mongoose.connect(TEST_MONGO_URI, {
    maxPoolSize: 5,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  })
}, 30000)

afterAll(async () => {
  await mongoose.connection.db!.collection('users').deleteMany({})
  await mongoose.disconnect()
})

beforeEach(async () => {
  const db = mongoose.connection.db!
  try { await db.collection('users').drop() } catch { /* ignore if not exists */ }
})

// ── Tests ──

describe('User Model — default values', () => {
  it('creates user with default values for new fields', async () => {
    const user = await UserModel.create({
      username: 'testuser',
      password: 'pass1234',
      displayName: 'Test User',
    })

    expect(user.tenantId).toBe('000000')
    expect(user.deptId).toBeNull()
    expect(user.email).toBeNull()
    expect(user.phone).toBeNull()
    expect(user.avatar).toBe('')
    expect(user.status).toBe('active')
  })

  it('password is hashed on save', async () => {
    const user = await UserModel.create({
      username: 'hashuser',
      password: 'mypassword',
      displayName: 'Hash User',
    })

    expect(user.password).not.toBe('mypassword')
    const valid = await bcrypt.compare('mypassword', user.password)
    expect(valid).toBe(true)
  })
})

describe('User Model — new field CRUD', () => {
  it('creates user with all new fields set', async () => {
    const user = await UserModel.create({
      username: 'fulluser',
      password: 'pass1234',
      displayName: 'Full User',
      tenantId: 'tenant-abc',
      deptId: 'dept-001',
      email: 'full@example.com',
      phone: '13800138000',
      avatar: 'https://example.com/avatar.png',
      status: 'inactive',
    })

    expect(user.tenantId).toBe('tenant-abc')
    expect(user.deptId).toBe('dept-001')
    expect(user.email).toBe('full@example.com')
    expect(user.phone).toBe('13800138000')
    expect(user.avatar).toBe('https://example.com/avatar.png')
    expect(user.status).toBe('inactive')
  })

  it('reads new fields from database', async () => {
    await UserModel.create({
      username: 'readuser',
      password: 'pass1234',
      displayName: 'Read User',
      tenantId: 'tenant-read',
      deptId: 'dept-read',
      email: 'read@example.com',
      phone: '13900139000',
      avatar: 'https://example.com/read.png',
      status: 'disabled',
    })

    const found = await UserModel.findOne({ username: 'readuser' }).lean()
    expect(found).not.toBeNull()
    expect(found!.tenantId).toBe('tenant-read')
    expect(found!.deptId).toBe('dept-read')
    expect(found!.email).toBe('read@example.com')
    expect(found!.phone).toBe('13900139000')
    expect(found!.avatar).toBe('https://example.com/read.png')
    expect(found!.status).toBe('disabled')
  })

  it('updates new fields via findOneAndUpdate', async () => {
    const user = await UserModel.create({
      username: 'updateuser',
      password: 'pass1234',
      displayName: 'Update User',
    })

    const updated = await UserModel.findByIdAndUpdate(
      user._id,
      {
        $set: {
          deptId: 'dept-new',
          email: 'updated@example.com',
          phone: '13700137000',
          avatar: 'https://example.com/new.png',
          status: 'inactive',
        },
      },
      { new: true },
    )

    expect(updated).not.toBeNull()
    expect(updated!.deptId).toBe('dept-new')
    expect(updated!.email).toBe('updated@example.com')
    expect(updated!.phone).toBe('13700137000')
    expect(updated!.avatar).toBe('https://example.com/new.png')
    expect(updated!.status).toBe('inactive')
  })

  it('sets nullable fields to null', async () => {
    const user = await UserModel.create({
      username: 'nulluser',
      password: 'pass1234',
      displayName: 'Null User',
      deptId: 'dept-xxx',
      email: 'x@x.com',
    })

    // Clear nullable fields
    const updated = await UserModel.findByIdAndUpdate(
      user._id,
      { $set: { deptId: null, email: null, phone: null } },
      { new: true },
    )

    expect(updated!.deptId).toBeNull()
    expect(updated!.email).toBeNull()
    expect(updated!.phone).toBeNull()
  })

  it('deletes user with new fields', async () => {
    const user = await UserModel.create({
      username: 'deleteuser',
      password: 'pass1234',
      displayName: 'Delete User',
      tenantId: 'tenant-del',
      deptId: 'dept-del',
      status: 'disabled',
    })

    const deleted = await UserModel.findByIdAndDelete(user._id)
    expect(deleted).not.toBeNull()
    expect(deleted!.tenantId).toBe('tenant-del')

    const found = await UserModel.findById(user._id)
    expect(found).toBeNull()
  })
})

describe('User Model — status enum', () => {
  it('accepts valid status values', async () => {
    for (const status of ['active', 'inactive', 'disabled'] as const) {
      const user = await UserModel.create({
        username: `status-${status}`,
        password: 'pass1234',
        displayName: `Status ${status}`,
        status,
      })
      expect(user.status).toBe(status)
    }
  })

  it('rejects invalid status value', async () => {
    await expect(
      UserModel.create({
        username: 'badstatus',
        password: 'pass1234',
        displayName: 'Bad Status',
        status: 'unknown',
      }),
    ).rejects.toThrow()
  })
})

describe('User Model — filtering by new fields', () => {
  beforeEach(async () => {
    await UserModel.create([
      { username: 'u1', password: 'pass1234', displayName: 'U1', tenantId: 'T1', deptId: 'D1', status: 'active' },
      { username: 'u2', password: 'pass1234', displayName: 'U2', tenantId: 'T1', deptId: 'D2', status: 'inactive' },
      { username: 'u3', password: 'pass1234', displayName: 'U3', tenantId: 'T2', deptId: 'D1', status: 'active' },
      { username: 'u4', password: 'pass1234', displayName: 'U4', tenantId: 'T2', deptId: 'D2', status: 'disabled' },
    ])
  })

  it('filters by tenantId', async () => {
    const users = await UserModel.find({ tenantId: 'T1' }).lean()
    expect(users).toHaveLength(2)
    expect(users.map(u => u.username).sort()).toEqual(['u1', 'u2'])
  })

  it('filters by deptId', async () => {
    const users = await UserModel.find({ deptId: 'D1' }).lean()
    expect(users).toHaveLength(2)
    expect(users.map(u => u.username).sort()).toEqual(['u1', 'u3'])
  })

  it('filters by status', async () => {
    const users = await UserModel.find({ status: 'active' }).lean()
    expect(users).toHaveLength(2)
    expect(users.map(u => u.username).sort()).toEqual(['u1', 'u3'])
  })

  it('filters by tenantId + status combined', async () => {
    const users = await UserModel.find({ tenantId: 'T1', status: 'active' }).lean()
    expect(users).toHaveLength(1)
    expect(users[0].username).toBe('u1')
  })

  it('filters by tenantId + deptId combined', async () => {
    const users = await UserModel.find({ tenantId: 'T2', deptId: 'D2' }).lean()
    expect(users).toHaveLength(1)
    expect(users[0].username).toBe('u4')
  })
})

describe('User Model — tenantPlugin integration', () => {
  beforeEach(async () => {
    await UserModel.create([
      { username: 'ta1', password: 'pass1234', displayName: 'TA1', tenantId: 'tenant-A' },
      { username: 'ta2', password: 'pass1234', displayName: 'TA2', tenantId: 'tenant-A' },
      { username: 'tb1', password: 'pass1234', displayName: 'TB1', tenantId: 'tenant-B' },
    ])
  })

  it('find() returns only documents matching the current tenant', async () => {
    const resultsA = await withTenant('tenant-A', () => UserModel.find().lean())
    expect(resultsA).toHaveLength(2)
    expect(resultsA.map(u => u.username).sort()).toEqual(['ta1', 'ta2'])

    const resultsB = await withTenant('tenant-B', () => UserModel.find().lean())
    expect(resultsB).toHaveLength(1)
    expect(resultsB[0].username).toBe('tb1')
  })

  it('findOne() returns document only from current tenant', async () => {
    const found = await withTenant('tenant-A', () =>
      UserModel.findOne({ displayName: 'TA1' }).lean(),
    )
    expect(found).not.toBeNull()
    expect(found!.username).toBe('ta1')

    const notFound = await withTenant('tenant-B', () =>
      UserModel.findOne({ displayName: 'TA1' }).lean(),
    )
    expect(notFound).toBeNull()
  })

  it('countDocuments() counts only current tenant documents', async () => {
    const countA = await withTenant('tenant-A', () => UserModel.countDocuments())
    expect(countA).toBe(2)

    const countB = await withTenant('tenant-B', () => UserModel.countDocuments())
    expect(countB).toBe(1)
  })

  it('save() automatically sets tenantId on new documents in tenant context', async () => {
    const user = await withTenant('auto-tenant', async () => {
      return UserModel.create({
        username: 'autouser',
        password: 'pass1234',
        displayName: 'Auto User',
      })
    })

    expect(user.tenantId).toBe('auto-tenant')
  })

  it('save() does not overwrite explicit tenantId', async () => {
    const user = await withTenant('wrong-tenant', async () => {
      return UserModel.create({
        username: 'explicituser',
        password: 'pass1234',
        displayName: 'Explicit User',
        tenantId: 'correct-tenant',
      })
    })

    expect(user.tenantId).toBe('correct-tenant')
  })
})

describe('User Model — toJSON excludes password', () => {
  it('toJSON does not include password field', async () => {
    const user = await UserModel.create({
      username: 'jsonuser',
      password: 'pass1234',
      displayName: 'JSON User',
    })

    const json = user.toJSON()
    expect(json).not.toHaveProperty('password')
    expect(json).toHaveProperty('username', 'jsonuser')
    expect(json).toHaveProperty('displayName', 'JSON User')
    expect(json).toHaveProperty('tenantId', '000000')
    expect(json).toHaveProperty('status', 'active')
    expect(json).toHaveProperty('avatar', '')
    expect(json).toHaveProperty('id')
  })
})

describe('User Model — comparePassword', () => {
  it('returns true for correct password', async () => {
    const user = await UserModel.create({
      username: 'pwuser',
      password: 'correctpass',
      displayName: 'PW User',
    })

    const valid = await user.comparePassword('correctpass')
    expect(valid).toBe(true)
  })

  it('returns false for incorrect password', async () => {
    const user = await UserModel.create({
      username: 'pwuser2',
      password: 'correctpass',
      displayName: 'PW User 2',
    })

    const valid = await user.comparePassword('wrongpass')
    expect(valid).toBe(false)
  })
})
