const secret = process.env.JWT_SECRET

if (!secret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET environment variable is required in production. Server cannot start without it.')
  }
  console.warn('[jwt] JWT_SECRET not set, using development fallback.')
}

export const JWT_SECRET = secret || 'dev-only-jwt-secret-please-set-env-var'
