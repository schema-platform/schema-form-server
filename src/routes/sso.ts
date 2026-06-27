import Router from '@koa/router'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { ClientModel } from '../models/Client.js'
import { AuthorizationCodeModel } from '../models/AuthorizationCode.js'
import { SSOSessionModel } from '../models/SSOSession.js'
import { UserModel } from '../models/User.js'
import { validate, validateQuery } from '../middleware/validate.js'
import {
  ssoAuthorizeQuerySchema,
  ssoTokenSchema,
  ssoRefreshTokenSchema,
  ssoLogoutSchema,
} from '../schemas/ssoSchemas.js'
import { JWT_SECRET } from '../config/jwt.js'
import type { JwtPayload } from '../middleware/auth.js'

const router = new Router({ prefix: '/api/auth/sso' })

/** Token expiry constants */
const ACCESS_TOKEN_EXPIRY = '15m'
const REFRESH_TOKEN_EXPIRY = '7d'
const AUTH_CODE_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes
const SSO_SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const SSO_SESSION_COOKIE = 'sso_session'

// ── Helpers ──

function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function buildUserPayload(user: { _id: string; username: string; roles: string[]; tenantId: string; deptId: string | null }): Omit<JwtPayload, 'tokenType'> {
  return {
    id: user._id,
    username: user.username,
    roles: user.roles,
    tenantId: user.tenantId,
    deptId: user.deptId,
  }
}

function issueAccessToken(payload: Omit<JwtPayload, 'tokenType'>): string {
  return jwt.sign({ ...payload, tokenType: 'access' }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY })
}

function issueRefreshToken(payload: Omit<JwtPayload, 'tokenType'>): string {
  return jwt.sign({ ...payload, tokenType: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY })
}

/** Look up a Client by clientId, verify it exists and is active. */
async function resolveClient(clientId: string) {
  const client = await ClientModel.findOne({ clientId, status: 'active' })
  if (!client) return null
  return client
}

/** Set the SSO session cookie on the response. */
function setSessionCookie(ctx: Router.RouterContext, sessionToken: string): void {
  const isProduction = process.env.NODE_ENV === 'production'
  ctx.cookies.set(SSO_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: SSO_SESSION_EXPIRY_MS,
    path: '/',
  })
}

/** Clear the SSO session cookie. */
function clearSessionCookie(ctx: Router.RouterContext): void {
  ctx.cookies.set(SSO_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
}

/** Read the SSO session cookie and resolve to a user. Returns null if invalid/expired. */
async function resolveSessionUser(ctx: Router.RouterContext) {
  const sessionToken = ctx.cookies.get(SSO_SESSION_COOKIE)
  if (!sessionToken) return null

  const session = await SSOSessionModel.findOne({
    sessionToken,
    expiresAt: { $gt: new Date() },
  })
  if (!session) return null

  const user = await UserModel.findById(session.userId)
  if (!user || user.status !== 'active') return null

  return user
}

// ── Endpoints ──

/**
 * GET /api/auth/sso/authorize
 *
 * SSO authorization endpoint.
 *
 * 1. Validate query params (client_id, redirect_uri, response_type, state)
 * 2. Resolve and validate the client
 * 3. Verify redirect_uri is registered for the client
 * 4. Check SSO session cookie — if no valid session, return 401 (caller should redirect to login)
 * 5. Generate an authorization code, persist it
 * 6. Redirect to redirect_uri with ?code=...&state=...
 */
router.get('/authorize', validateQuery(ssoAuthorizeQuerySchema), async (ctx) => {
  const { client_id, redirect_uri, state } = ctx.query as {
    client_id: string
    redirect_uri: string
    state?: string
  }

  // Resolve client
  const client = await resolveClient(client_id)
  if (!client) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid or inactive client_id.' } }
    return
  }

  // Verify redirect_uri is registered
  if (!client.redirectUris.includes(redirect_uri)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'redirect_uri is not registered for this client.' } }
    return
  }

  // Check SSO session
  const user = await resolveSessionUser(ctx)
  if (!user) {
    ctx.status = 401
    ctx.body = { success: false, error: { message: 'No active SSO session. Please log in first.' } }
    return
  }

  // Generate authorization code
  const code = generateSecureToken()
  await AuthorizationCodeModel.create({
    code,
    userId: user._id,
    clientId: client._id,
    redirectUri: redirect_uri,
    scopes: [],
    expiresAt: new Date(Date.now() + AUTH_CODE_EXPIRY_MS),
    used: false,
  })

  // Build redirect URL
  const url = new URL(redirect_uri)
  url.searchParams.set('code', code)
  if (state) {
    url.searchParams.set('state', state)
  }

  ctx.redirect(url.toString())
})

/**
 * POST /api/auth/sso/token
 *
 * Exchange an authorization code for access + refresh tokens.
 *
 * 1. Validate body (grant_type, code, client_id, redirect_uri)
 * 2. Resolve client
 * 3. Look up authorization code, verify it belongs to this client + redirect_uri
 * 4. Mark code as used (one-time use)
 * 5. Issue access token + refresh token
 */
router.post('/token', validate(ssoTokenSchema), async (ctx) => {
  const { code, client_id, redirect_uri } = ctx.request.body as {
    code: string
    client_id: string
    redirect_uri: string
  }

  const client = await resolveClient(client_id)
  if (!client) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid or inactive client_id.' } }
    return
  }

  const authCode = await AuthorizationCodeModel.findOne({
    code,
    clientId: client._id,
    used: false,
    expiresAt: { $gt: new Date() },
  })
  if (!authCode) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid or expired authorization code.' } }
    return
  }

  // Verify redirect_uri matches
  if (authCode.redirectUri !== redirect_uri) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'redirect_uri does not match the original request.' } }
    return
  }

  // Mark code as used (one-time use)
  authCode.used = true
  await authCode.save()

  // Resolve user
  const user = await UserModel.findById(authCode.userId)
  if (!user || user.status !== 'active') {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'User associated with this code is no longer valid.' } }
    return
  }

  const basePayload = buildUserPayload(user)
  const accessToken = issueAccessToken(basePayload)
  const refreshToken = issueRefreshToken(basePayload)

  ctx.body = {
    success: true,
    data: {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 900,
    },
  }
})

/**
 * POST /api/auth/sso/refresh
 *
 * Token rotation: exchange a refresh token for a new access + refresh token pair.
 *
 * 1. Validate body (grant_type, refresh_token, client_id)
 * 2. Verify the refresh token JWT
 * 3. Resolve client
 * 4. Verify user still exists
 * 5. Issue new token pair
 */
router.post('/refresh', validate(ssoRefreshTokenSchema), async (ctx) => {
  const { refresh_token, client_id } = ctx.request.body as {
    refresh_token: string
    client_id: string
  }

  const client = await resolveClient(client_id)
  if (!client) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid or inactive client_id.' } }
    return
  }

  let payload: JwtPayload
  try {
    payload = jwt.verify(refresh_token, JWT_SECRET) as JwtPayload
  } catch {
    ctx.status = 401
    ctx.body = { success: false, error: { message: 'Invalid or expired refresh token.' } }
    return
  }

  if (payload.tokenType !== 'refresh') {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Token is not a refresh token.' } }
    return
  }

  const user = await UserModel.findById(payload.id)
  if (!user || user.status !== 'active') {
    ctx.status = 401
    ctx.body = { success: false, error: { message: 'User no longer exists or is inactive.' } }
    return
  }

  const basePayload = buildUserPayload(user)
  const accessToken = issueAccessToken(basePayload)
  const refreshToken = issueRefreshToken(basePayload)

  ctx.body = {
    success: true,
    data: {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 900,
    },
  }
})

/**
 * GET /api/auth/sso/session
 *
 * Check the SSO session cookie and return the user info.
 * Returns 401 if no valid session exists.
 */
router.get('/session', async (ctx) => {
  const user = await resolveSessionUser(ctx)
  if (!user) {
    ctx.status = 401
    ctx.body = { success: false, error: { message: 'No active SSO session.' } }
    return
  }

  ctx.body = {
    success: true,
    data: {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      roles: user.roles,
      tenantId: user.tenantId,
      deptId: user.deptId,
      email: user.email,
      avatar: user.avatar,
    },
  }
})

/**
 * POST /api/auth/sso/logout
 *
 * Destroy the SSO session.
 *
 * 1. Read session cookie
 * 2. Delete the session document from DB
 * 3. Clear the cookie
 */
router.post('/logout', validate(ssoLogoutSchema), async (ctx) => {
  const sessionToken = ctx.cookies.get(SSO_SESSION_COOKIE)

  if (sessionToken) {
    await SSOSessionModel.deleteOne({ sessionToken })
  }

  clearSessionCookie(ctx)

  ctx.body = { success: true, data: null }
})

export default router
