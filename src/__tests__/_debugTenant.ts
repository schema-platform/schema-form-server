import mongoose from 'mongoose'
import { tenantStorage } from '../middleware/tenantContext.js'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

async function main() {
  await mongoose.connect('mongodb://localhost:27017/test-debug')

  const schema = new mongoose.Schema({ name: String, tenantId: String }, { timestamps: true })
  schema.plugin(tenantPlugin)
  const Model = mongoose.models.DebugItem || mongoose.model('DebugItem', schema)

  await Model.deleteMany({})
  await Model.create({ name: 'Item-A', tenantId: 'TA' })
  await Model.create({ name: 'Item-B', tenantId: 'TB' })

  // Test without context
  const all = await Model.find().lean()
  console.log('No context:', all.length, all.map(i => i.name))

  // Test with context
  const result = await tenantStorage.run({ tenantId: 'TA' }, async () => {
    const items = await Model.find().lean()
    return items
  })
  console.log('With TA context:', result.length, result.map(i => i.name))

  // Test findOne
  const findOneResult = await tenantStorage.run({ tenantId: 'TA' }, async () => {
    return Model.findOne({ name: 'Item-B' }).lean()
  })
  console.log('findOne Item-B with TA:', findOneResult)

  // Test save
  const saved = await tenantStorage.run({ tenantId: 'TC' }, async () => {
    const doc = new Model({ name: 'Item-C' })
    return doc.save()
  })
  console.log('Saved with TC context:', { name: saved.name, tenantId: saved.tenantId })

  // Test count
  const count = await tenantStorage.run({ tenantId: 'TA' }, async () => {
    return Model.countDocuments()
  })
  console.log('Count with TA:', count)

  // Test aggregate
  const agg = await tenantStorage.run({ tenantId: 'TA' }, async () => {
    return Model.aggregate([{ $match: { name: 'Item-A' } }])
  })
  console.log('Aggregate with TA:', agg.length, agg.map(i => i.name))

  await Model.deleteMany({})
  await mongoose.disconnect()
}

main().catch(console.error)
