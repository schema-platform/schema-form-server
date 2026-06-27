import { ClientModel } from '../models/Client.js'
import { DEFAULT_TENANT_ID } from './initDefaultTenant.js'

const PROD_ORIGIN = process.env.PROD_ORIGIN || 'http://localhost:8828'

const DEFAULT_CLIENTS = [
  {
    clientId: 'shell',
    name: 'Shell 应用',
    redirectUris: [
      'http://localhost:5050/auth/callback',
      `${PROD_ORIGIN}/auth/callback`,
      'http://localhost:5050/sso/callback',
      'http://localhost:5050/schema-platform/sso/callback',
      `${PROD_ORIGIN}/schema-platform/sso/callback`,
    ],
    type: 'public' as const,
  },
  {
    clientId: 'editor',
    name: '表单设计器',
    redirectUris: [
      'http://localhost:5100/auth/callback',
      'http://localhost:5100/schema-platform/editor/auth/callback',
      `${PROD_ORIGIN}/schema-platform/editor/auth/callback`,
    ],
    type: 'public' as const,
  },
  {
    clientId: 'flow',
    name: '流程设计器',
    redirectUris: [
      'http://localhost:5200/auth/callback',
      'http://localhost:5200/schema-platform/flow/auth/callback',
      `${PROD_ORIGIN}/schema-platform/flow/auth/callback`,
    ],
    type: 'public' as const,
  },
  {
    clientId: 'ai',
    name: 'AI 应用',
    redirectUris: [
      'http://localhost:5300/auth/callback',
      'http://localhost:5300/schema-platform/ai/auth/callback',
      `${PROD_ORIGIN}/schema-platform/ai/auth/callback`,
    ],
    type: 'public' as const,
  },
  // admin SSO client 待新 admin 壳应用完成后重新配置
]

/**
 * 种子 SSO Client 配置
 * 使用 upsert 保证幂等：按 clientId 去重，已存在的不会被覆盖
 */
export async function seedClients(): Promise<void> {
  let created = 0
  let updated = 0

  for (const client of DEFAULT_CLIENTS) {
    const result = await ClientModel.updateOne(
      { clientId: client.clientId },
      {
        $set: {
          ...client,
          secret: '',
          scopes: ['openid', 'profile', 'email'],
          status: 'active',
          tenantId: DEFAULT_TENANT_ID,
        },
      },
      { upsert: true },
    )
    if (result.upsertedCount > 0) created++
    else if (result.modifiedCount > 0) updated++
  }

  const skipped = DEFAULT_CLIENTS.length - created - updated
  console.log(`[seed] SSO clients: ${created} created, ${updated} updated, ${skipped} unchanged`)
}
