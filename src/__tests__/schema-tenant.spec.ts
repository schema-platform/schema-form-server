/**
 * Schema Tenant Isolation Tests
 *
 * Verifies that FormSchema and PublishedSchema CRUD operations
 * are properly tenant-scoped via tenantPlugin.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { tenantStorage } from '../middleware/tenantContext.js'
import { FormSchemaModel } from '../models/FormSchema.js'
import { PublishedSchemaModel } from '../models/PublishedSchema.js'

/** Run a function within a specific tenant context */
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

const TEST_MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/test-schema-tenant'

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
  await mongoose.connection.db!.collection('formschemas').deleteMany({})
  await mongoose.connection.db!.collection('publishedschemas').deleteMany({})
  await mongoose.disconnect()
})

beforeEach(async () => {
  const db = mongoose.connection.db!
  try { await db.collection('formschemas').drop() } catch { /* ignore */ }
  try { await db.collection('publishedschemas').drop() } catch { /* ignore */ }
})

// ── FormSchema Tenant Isolation ──

describe('FormSchema — tenant isolation on create', () => {
  it('create() auto-injects tenantId from tenant context', async () => {
    const schema = await withTenant('tenant-Alpha', async () => {
      return FormSchemaModel.create({
        _id: 'fs-1',
        editId: 'ed-1',
        version: '20260101000000',
        name: 'Test Form',
        type: 'form',
        json: [{ type: 'input', id: 'i1' }],
      })
    })

    expect(schema.tenantId).toBe('tenant-Alpha')
  })

  it('create() without tenant context uses default tenantId', async () => {
    const schema = await FormSchemaModel.create({
      _id: 'fs-2',
      editId: 'ed-2',
      version: '20260101000000',
      name: 'No Context Form',
      type: 'form',
      json: [{ type: 'input', id: 'i2' }],
    })

    expect(schema.tenantId).toBe('000000')
  })
})

describe('FormSchema — tenant isolation on find', () => {
  it('find() returns only documents from current tenant', async () => {
    await withTenant('T-A', () =>
      FormSchemaModel.create({ _id: 'fs-a1', editId: 'ed-a1', version: 'v1', name: 'A1', type: 'form', json: [] }),
    )
    await withTenant('T-A', () =>
      FormSchemaModel.create({ _id: 'fs-a2', editId: 'ed-a2', version: 'v1', name: 'A2', type: 'form', json: [] }),
    )
    await withTenant('T-B', () =>
      FormSchemaModel.create({ _id: 'fs-b1', editId: 'ed-b1', version: 'v1', name: 'B1', type: 'form', json: [] }),
    )

    const resultsA = await withTenant('T-A', () => FormSchemaModel.find().lean())
    expect(resultsA).toHaveLength(2)
    expect(resultsA.map(r => r._id).sort()).toEqual(['fs-a1', 'fs-a2'])

    const resultsB = await withTenant('T-B', () => FormSchemaModel.find().lean())
    expect(resultsB).toHaveLength(1)
    expect(resultsB[0]._id).toBe('fs-b1')
  })

  it('countDocuments() counts only current tenant', async () => {
    await withTenant('CNT-A', () =>
      FormSchemaModel.create({ _id: 'fs-c1', editId: 'ed-c1', version: 'v1', name: 'C1', type: 'form', json: [] }),
    )
    await withTenant('CNT-A', () =>
      FormSchemaModel.create({ _id: 'fs-c2', editId: 'ed-c2', version: 'v1', name: 'C2', type: 'form', json: [] }),
    )
    await withTenant('CNT-B', () =>
      FormSchemaModel.create({ _id: 'fs-c3', editId: 'ed-c3', version: 'v1', name: 'C3', type: 'form', json: [] }),
    )

    expect(await withTenant('CNT-A', () => FormSchemaModel.countDocuments())).toBe(2)
    expect(await withTenant('CNT-B', () => FormSchemaModel.countDocuments())).toBe(1)
  })
})

describe('FormSchema — tenant isolation on findOne', () => {
  it('findOne() returns only matching document from current tenant', async () => {
    await withTenant('F-A', () =>
      FormSchemaModel.create({ _id: 'fs-f1', editId: 'ed-f1', version: 'v1', name: 'Shared', type: 'form', json: [] }),
    )
    await withTenant('F-B', () =>
      FormSchemaModel.create({ _id: 'fs-f2', editId: 'ed-f2', version: 'v1', name: 'Shared', type: 'form', json: [] }),
    )

    const found = await withTenant('F-A', () =>
      FormSchemaModel.findOne({ name: 'Shared' }).lean(),
    )
    expect(found).not.toBeNull()
    expect(found!._id).toBe('fs-f1')
  })
})

describe('FormSchema — tenant isolation on findByIdAndUpdate', () => {
  it('findByIdAndUpdate() only updates document in current tenant', async () => {
    await withTenant('UP-A', () =>
      FormSchemaModel.create({ _id: 'fs-u1', editId: 'ed-u1', version: 'v1', name: 'Old', type: 'form', json: [] }),
    )
    await withTenant('UP-B', () =>
      FormSchemaModel.create({ _id: 'fs-u2', editId: 'ed-u2', version: 'v1', name: 'Old', type: 'form', json: [] }),
    )

    const updated = await withTenant('UP-A', () =>
      FormSchemaModel.findByIdAndUpdate('fs-u1', { name: 'New' }, { new: true }).lean(),
    )
    expect(updated).not.toBeNull()
    expect(updated!.name).toBe('New')

    // Other tenant's document untouched
    const other = await FormSchemaModel.findById('fs-u2').lean()
    expect(other!.name).toBe('Old')
  })
})

describe('FormSchema — tenant isolation on findByIdAndDelete', () => {
  it('findByIdAndDelete() only deletes document in current tenant', async () => {
    await withTenant('DL-A', () =>
      FormSchemaModel.create({ _id: 'fs-d1', editId: 'ed-d1', version: 'v1', name: 'DeleteMe', type: 'form', json: [] }),
    )
    await withTenant('DL-B', () =>
      FormSchemaModel.create({ _id: 'fs-d2', editId: 'ed-d2', version: 'v1', name: 'DeleteMe', type: 'form', json: [] }),
    )

    const deleted = await withTenant('DL-A', () =>
      FormSchemaModel.findByIdAndDelete('fs-d1').lean(),
    )
    expect(deleted).not.toBeNull()
    expect(deleted!._id).toBe('fs-d1')

    // Other tenant's document still exists
    const other = await FormSchemaModel.findById('fs-d2').lean()
    expect(other).not.toBeNull()
  })
})

// ── PublishedSchema Tenant Isolation ──

describe('PublishedSchema — tenant isolation on create', () => {
  it('create() auto-injects tenantId from tenant context', async () => {
    const pub = await withTenant('pub-T1', async () => {
      return PublishedSchemaModel.create({
        _id: 'ps-1',
        sourceId: 'ed-1',
        name: 'Published Form',
        type: 'form',
        json: [{ type: 'input', id: 'i1' }],
        publishId: 'pid-1',
        version: '20260101000000',
        publishedAt: new Date(),
      })
    })

    expect(pub.tenantId).toBe('pub-T1')
  })
})

describe('PublishedSchema — tenant isolation on find', () => {
  it('find() returns only documents from current tenant', async () => {
    await withTenant('PUB-A', () =>
      PublishedSchemaModel.create({
        _id: 'ps-a1', sourceId: 'ed-a1', name: 'PA1', type: 'form',
        json: [], publishId: 'pid-a1', version: 'v1', publishedAt: new Date(),
      }),
    )
    await withTenant('PUB-B', () =>
      PublishedSchemaModel.create({
        _id: 'ps-b1', sourceId: 'ed-b1', name: 'PB1', type: 'form',
        json: [], publishId: 'pid-b1', version: 'v1', publishedAt: new Date(),
      }),
    )

    const resultsA = await withTenant('PUB-A', () => PublishedSchemaModel.find().lean())
    expect(resultsA).toHaveLength(1)
    expect(resultsA[0]._id).toBe('ps-a1')

    const resultsB = await withTenant('PUB-B', () => PublishedSchemaModel.find().lean())
    expect(resultsB).toHaveLength(1)
    expect(resultsB[0]._id).toBe('ps-b1')
  })
})

describe('PublishedSchema — tenant isolation on findOneAndUpdate with upsert', () => {
  it('upsert creates new document with correct tenantId', async () => {
    const pub = await withTenant('UPSERT-A', async () => {
      return PublishedSchemaModel.findOneAndUpdate(
        { sourceId: 'ed-upsert-1' },
        {
          $set: { name: 'Upserted', version: 'v1', publishedAt: new Date(), json: [], publishId: 'pid-upsert', type: 'form' },
          $setOnInsert: { _id: 'ps-upsert-1', sourceId: 'ed-upsert-1', tenantId: 'UPSERT-A' },
        },
        { upsert: true, new: true },
      ).lean()
    })

    expect(pub).not.toBeNull()
    expect(pub!.tenantId).toBe('UPSERT-A')

    // Verify isolation: other tenant can't see it
    const other = await withTenant('UPSERT-B', () =>
      PublishedSchemaModel.findOne({ sourceId: 'ed-upsert-1' }).lean(),
    )
    expect(other).toBeNull()
  })
})

describe('PublishedSchema — tenant isolation on delete', () => {
  it('deleteOne() only deletes documents in current tenant', async () => {
    await withTenant('DEL-A', () =>
      PublishedSchemaModel.create({
        _id: 'ps-d1', sourceId: 'ed-d1', name: 'DA', type: 'form',
        json: [], publishId: 'pid-d1', version: 'v1', publishedAt: new Date(),
      }),
    )
    await withTenant('DEL-B', () =>
      PublishedSchemaModel.create({
        _id: 'ps-d2', sourceId: 'ed-d2', name: 'DB', type: 'form',
        json: [], publishId: 'pid-d2', version: 'v1', publishedAt: new Date(),
      }),
    )

    await withTenant('DEL-A', () =>
      PublishedSchemaModel.deleteOne({ sourceId: 'ed-d1' }),
    )

    // Tenant A's doc deleted
    const a = await PublishedSchemaModel.findById('ps-d1').lean()
    expect(a).toBeNull()

    // Tenant B's doc still exists
    const b = await PublishedSchemaModel.findById('ps-d2').lean()
    expect(b).not.toBeNull()
  })
})
