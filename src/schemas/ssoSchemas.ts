import { z } from 'zod'

export const ssoAuthorizeQuerySchema = z.object({
  client_id: z.string().min(1, 'client_id is required'),
  redirect_uri: z.string().url('redirect_uri must be a valid URL'),
  response_type: z.literal('code').default('code'),
  state: z.string().optional(),
  scope: z.string().optional(),
}).strict()

export const ssoTokenSchema = z.object({
  grant_type: z.literal('authorization_code').default('authorization_code'),
  code: z.string().min(1, 'Authorization code is required'),
  client_id: z.string().min(1, 'client_id is required'),
  redirect_uri: z.string().url('redirect_uri must be a valid URL'),
}).strict()

export const ssoRefreshTokenSchema = z.object({
  grant_type: z.literal('refresh_token').default('refresh_token'),
  refresh_token: z.string().min(1, 'Refresh token is required'),
  client_id: z.string().min(1, 'client_id is required'),
}).strict()

export const ssoLogoutSchema = z.object({
  client_id: z.string().min(1, 'client_id is required'),
}).strict()

export type SsoAuthorizeQuery = z.infer<typeof ssoAuthorizeQuerySchema>
export type SsoTokenBody = z.infer<typeof ssoTokenSchema>
export type SsoRefreshTokenBody = z.infer<typeof ssoRefreshTokenSchema>
export type SsoLogoutBody = z.infer<typeof ssoLogoutSchema>
