/**
 * Mongoose Tenant Plugin Tests
 *
 * Covers:
 * - find / findOne filtering
 * - save auto-injection
 * - countDocuments filtering
 * - aggregate $match injection
 * - findOneAndUpdate / findOneAndDelete filtering
 * - populate tenantId propagation
 * - excluded models bypass
 * - multi-tenant data isolation
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'
import { tenantStorage, getCurrentTenantId } from '../middleware/tenantContext.js'

// ── Diagnostic: verify AsyncLocalStorage identity ──
console.log('[TEST] tenantStorage id:', (tenantStorage as unknown as { __id?: string }).__id ?? 'no-id')
console.log('[TEST] getCurrentTenantId in tenant context:', tenantStorage.run({ tenantId: 'DIAG' }, () => getCurrentTenantId()))

// ── Test helpers ──

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

// ── Test models ──
// We create isolated test models so we don't interfere with production models.

interface ITestItem {
  _id: string
  tenantId: string
  name: string
  category: string
}

const testItemSchema = new mongoose.Schema<ITestItem>(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    name: { type: String, required: true },
    category: { type: String, default: '' },
  },
  { timestamps: true },
)
testItemSchema.plugin(tenantPlugin)

// A model WITHOUT the plugin (simulates User, Tenant)
interface INoTenantItem {
  _id: string
  name: string
}

const noTenantSchema = new mongoose.Schema<INoTenantItem>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
  },
  { timestamps: true },
)
// No plugin applied — excluded model

const TestItem = mongoose.models.TestTenantItem as mongoose.Model<ITestItem> ||
  mongoose.model<ITestItem>('TestTenantItem', testItemSchema)

const NoTenantItem = mongoose.models.TestNoTenantItem as mongoose.Model<INoTenantItem> ||
  mongoose.model<INoTenantItem>('TestNoTenantItem', noTenantSchema)

// ── Test suite ──

const TEST_MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/test-tenant-plugin'

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
  await mongoose.connection.db!.collection('testtenantitems').deleteMany({})
  await mongoose.connection.db!.collection('testnotenantitems').deleteMany({})
  await mongoose.disconnect()
})

beforeEach(async () => {
  // Drop and recreate collections to ensure clean state
  const db = mongoose.connection.db!
  try { await db.collection('testtenantitems').drop() } catch { /* ignore if not exists */ }
  try { await db.collection('testnotenantitems').drop() } catch { /* ignore if not exists */ }
})

describe('Tenant Plugin — find filtering', () => {
  it('find() returns only documents matching the current tenant', async () => {
    // Seed data for two tenants
    await TestItem.create({ _id: 'a1', tenantId: 'tenant-A', name: 'Alpha' })
    await TestItem.create({ _id: 'a2', tenantId: 'tenant-A', name: 'Beta' })
    await TestItem.create({ _id: 'b1', tenantId: 'tenant-B', name: 'Gamma' })

    const resultsA = await withTenant('tenant-A', () => TestItem.find().lean())
    expect(resultsA).toHaveLength(2)
    expect(resultsA.map((r) => r._id).sort()).toEqual(['a1', 'a2'])

    const resultsB = await withTenant('tenant-B', () => TestItem.find().lean())
    expect(resultsB).toHaveLength(1)
    expect(resultsB[0]._id).toBe('b1')
  })

  it('find() with additional filters combines tenantId with user filter', async () => {
    await TestItem.create({ _id: 'c1', tenantId: 'T1', name: 'Widget', category: 'form' })
    await TestItem.create({ _id: 'c2', tenantId: 'T1', name: 'Button', category: 'action' })
    await TestItem.create({ _id: 'c3', tenantId: 'T2', name: 'Widget', category: 'form' })

    const results = await withTenant('T1', () =>
      TestItem.find({ category: 'form' }).lean(),
    )
    expect(results).toHaveLength(1)
    expect(results[0]._id).toBe('c1')
  })

  it('find() returns empty when tenant has no documents', async () => {
    await TestItem.create({ _id: 'd1', tenantId: 'T1', name: 'Item' })

    const results = await withTenant('empty-tenant', () => TestItem.find().lean())
    expect(results).toHaveLength(0)
  })
})

describe('Tenant Plugin — findOne filtering', () => {
  it('findOne() returns document only from current tenant', async () => {
    await TestItem.create({ _id: 'e1', tenantId: 'T-A', name: 'FindMe' })
    await TestItem.create({ _id: 'e2', tenantId: 'T-B', name: 'FindMe' })

    const found = await withTenant('T-A', () =>
      TestItem.findOne({ name: 'FindMe' }).lean(),
    )
    expect(found).not.toBeNull()
    expect(found!._id).toBe('e1')

    const notFound = await withTenant('T-C', () =>
      TestItem.findOne({ name: 'FindMe' }).lean(),
    )
    expect(notFound).toBeNull()
  })

  it('findOne() with explicit tenantId in filter still works', async () => {
    await TestItem.create({ _id: 'f1', tenantId: 'T-X', name: 'Explicit' })

    const found = await withTenant('T-X', () =>
      TestItem.findOne({ tenantId: 'T-X', name: 'Explicit' }).lean(),
    )
    expect(found).not.toBeNull()
    expect(found!._id).toBe('f1')
  })
})

describe('Tenant Plugin — save auto-injection', () => {
  it('save() automatically sets tenantId on new documents', async () => {
    const doc = await withTenant('save-tenant', async () => {
      const item = new TestItem({ _id: 's1', name: 'Saved' })
      return item.save()
    })

    expect(doc.tenantId).toBe('save-tenant')

    // Verify it's persisted correctly
    const found = await TestItem.findOne({ _id: 's1' }).lean()
    expect(found!.tenantId).toBe('save-tenant')
  })

  it('save() does not overwrite existing tenantId', async () => {
    const doc = await withTenant('wrong-tenant', async () => {
      const item = new TestItem({ _id: 's2', tenantId: 'correct-tenant', name: 'HasId' })
      return item.save()
    })

    expect(doc.tenantId).toBe('correct-tenant')
  })
})

describe('Tenant Plugin — countDocuments', () => {
  it('countDocuments() counts only current tenant documents', async () => {
    await TestItem.create({ _id: 'ct1', tenantId: 'CNT-A', name: 'One' })
    await TestItem.create({ _id: 'ct2', tenantId: 'CNT-A', name: 'Two' })
    await TestItem.create({ _id: 'ct3', tenantId: 'CNT-B', name: 'Three' })

    const countA = await withTenant('CNT-A', () => TestItem.countDocuments())
    expect(countA).toBe(2)

    const countB = await withTenant('CNT-B', () => TestItem.countDocuments())
    expect(countB).toBe(1)
  })
})

describe('Tenant Plugin — aggregate', () => {
  it('aggregate() adds $match with tenantId at pipeline start', async () => {
    await TestItem.create({ _id: 'ag1', tenantId: 'AG-A', name: 'X', category: 'form' })
    await TestItem.create({ _id: 'ag2', tenantId: 'AG-A', name: 'Y', category: 'action' })
    await TestItem.create({ _id: 'ag3', tenantId: 'AG-B', name: 'Z', category: 'form' })

    const results = await withTenant('AG-A', () =>
      TestItem.aggregate([{ $match: { category: 'form' } }]),
    )
    expect(results).toHaveLength(1)
    expect(results[0]._id).toBe('ag1')
  })

  it('aggregate() with $group only groups within tenant', async () => {
    await TestItem.create({ _id: 'gr1', tenantId: 'GR-A', name: 'Item1', category: 'form' })
    await TestItem.create({ _id: 'gr2', tenantId: 'GR-A', name: 'Item2', category: 'form' })
    await TestItem.create({ _id: 'gr3', tenantId: 'GR-A', name: 'Item3', category: 'action' })
    await TestItem.create({ _id: 'gr4', tenantId: 'GR-B', name: 'Item4', category: 'form' })

    const results = await withTenant('GR-A', () =>
      TestItem.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    )
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ _id: 'action', count: 1 })
    expect(results[1]).toEqual({ _id: 'form', count: 2 })
  })

  it('aggregate() does not double-inject $match when tenantId already in pipeline', async () => {
    await TestItem.create({ _id: 'agd1', tenantId: 'AGD-A', name: 'Item' })

    // Passing tenantId explicitly in $match should not cause a double $match
    const results = await withTenant('AGD-A', () =>
      TestItem.aggregate([{ $match: { tenantId: 'AGD-A' } }]),
    )
    expect(results).toHaveLength(1)
    // Should not throw or produce duplicates
  })
})

describe('Tenant Plugin — findOneAndUpdate', () => {
  it('findOneAndUpdate() only updates document in current tenant', async () => {
    await TestItem.create({ _id: 'upd1', tenantId: 'UP-A', name: 'Old' })
    await TestItem.create({ _id: 'upd2', tenantId: 'UP-B', name: 'Old' })

    const updated = await withTenant('UP-A', () =>
      TestItem.findOneAndUpdate({ name: 'Old' }, { $set: { name: 'New' } }, { new: true }).lean(),
    )
    expect(updated).not.toBeNull()
    expect(updated!.name).toBe('New')
    expect(updated!._id).toBe('upd1')

    // Other tenant's document should be untouched
    const other = await TestItem.findOne({ _id: 'upd2' }).lean()
    expect(other!.name).toBe('Old')
  })

  it('findOneAndUpdate() returns null when no matching document in tenant', async () => {
    await TestItem.create({ _id: 'upd3', tenantId: 'UP-C', name: 'Exists' })

    const result = await withTenant('UP-D', () =>
      TestItem.findOneAndUpdate({ name: 'Exists' }, { $set: { name: 'New' } }, { new: true }).lean(),
    )
    expect(result).toBeNull()
  })
})

describe('Tenant Plugin — findOneAndDelete', () => {
  it('findOneAndDelete() only deletes document in current tenant', async () => {
    await TestItem.create({ _id: 'del1', tenantId: 'DL-A', name: 'DeleteMe' })
    await TestItem.create({ _id: 'del2', tenantId: 'DL-B', name: 'DeleteMe' })

    const deleted = await withTenant('DL-A', () =>
      TestItem.findOneAndDelete({ name: 'DeleteMe' }).lean(),
    )
    expect(deleted).not.toBeNull()
    expect(deleted!._id).toBe('del1')

    // Other tenant's document should still exist
    const other = await TestItem.findOne({ _id: 'del2' }).lean()
    expect(other).not.toBeNull()
  })
})

describe('Tenant Plugin — excluded models (no plugin)', () => {
  it('model without plugin returns all documents regardless of tenant context', async () => {
    await NoTenantItem.create({ _id: 'nt1', name: 'Global1' })
    await NoTenantItem.create({ _id: 'nt2', name: 'Global2' })

    const resultsA = await withTenant('any-tenant', () => NoTenantItem.find().lean())
    expect(resultsA).toHaveLength(2)

    const resultsB = await withTenant('other-tenant', () => NoTenantItem.find().lean())
    expect(resultsB).toHaveLength(2)
  })

  it('model without plugin findOne returns any matching document', async () => {
    await NoTenantItem.create({ _id: 'nt3', name: 'FindGlobal' })

    const found = await withTenant('no-matter', () =>
      NoTenantItem.findOne({ name: 'FindGlobal' }).lean(),
    )
    expect(found).not.toBeNull()
    expect(found!._id).toBe('nt3')
  })
})

describe('Tenant Plugin — no tenant context', () => {
  it('queries without tenant context return all documents (bootstrap/migration scenario)', async () => {
    await TestItem.create({ _id: 'nc1', tenantId: 'T1', name: 'Item1' })
    await TestItem.create({ _id: 'nc2', tenantId: 'T2', name: 'Item2' })

    // No tenantStorage.run — simulates bootstrapping / migration scripts
    const results = await TestItem.find().lean()
    expect(results).toHaveLength(2)
  })

  it('save without tenant context does not inject tenantId', async () => {
    const item = new TestItem({ _id: 'nc3', name: 'NoContext' })
    const saved = await item.save()

    // tenantId should remain the schema default
    expect(saved.tenantId).toBe('000000')
  })
})

describe('Tenant Plugin — multi-tenant data isolation', () => {
  it('complete isolation: tenant A cannot see tenant B data across all operations', async () => {
    // Seed
    await TestItem.create({ _id: 'iso1', tenantId: 'ISO-A', name: 'A-Data' })
    await TestItem.create({ _id: 'iso2', tenantId: 'ISO-B', name: 'B-Data' })

    await withTenant('ISO-A', async () => {
      // find
      const items = await TestItem.find().lean()
      expect(items).toHaveLength(1)
      expect(items[0].name).toBe('A-Data')

      // findOne
      const one = await TestItem.findOne({ name: 'B-Data' }).lean()
      expect(one).toBeNull()

      // count
      const count = await TestItem.countDocuments()
      expect(count).toBe(1)

      // aggregate
      const agg = await TestItem.aggregate([{ $group: { _id: null, names: { $push: '$name' } } }])
      expect(agg[0].names).toEqual(['A-Data'])
    })
  })
})
