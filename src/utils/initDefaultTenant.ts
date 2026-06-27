import { TenantModel } from '../models/Tenant.js'

export const DEFAULT_TENANT_ID = '000000'

export async function initDefaultTenant(): Promise<void> {
  const existing = await TenantModel.findOne({ code: 'default' })
  if (existing) return

  await TenantModel.create({
    _id: DEFAULT_TENANT_ID,
    name: '默认租户',
    code: 'default',
    status: 'active',
    config: {
      maxUsers: 10000,
      features: ['*'],
    },
  })
  console.log('[init] Default tenant created')
}
