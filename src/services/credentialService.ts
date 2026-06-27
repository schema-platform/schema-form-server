/**
 * Credential Encryption Service
 *
 * AES-256-CBC encryption/decryption for credential data at rest.
 * Uses CREDENTIAL_SECRET environment variable as the master key.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const ALGORITHM = 'aes-256-cbc'
const IV_LENGTH = 16
const SALT_LENGTH = 16
const KEY_LENGTH = 32

function getSecret(): string {
  const secret = process.env.CREDENTIAL_SECRET
  if (!secret) {
    throw new Error('CREDENTIAL_SECRET environment variable is required')
  }
  return secret
}

/**
 * Derive a 256-bit key from the master secret + salt using scrypt.
 */
function deriveKey(salt: Buffer): Buffer {
  return scryptSync(getSecret(), salt, KEY_LENGTH)
}

/**
 * Encrypt a JSON-serializable object to a base64 string.
 * Output format: base64(salt + iv + ciphertext)
 */
export function encrypt(data: Record<string, string>): string {
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = deriveKey(salt)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const plaintext = JSON.stringify(data)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  const combined = Buffer.concat([salt, iv, encrypted])
  return combined.toString('base64')
}

/**
 * Decrypt a base64 string back to the original object.
 */
export function decrypt(encryptedBase64: string): Record<string, string> {
  const combined = Buffer.from(encryptedBase64, 'base64')

  const salt = combined.subarray(0, SALT_LENGTH)
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH)

  const key = deriveKey(salt)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  return JSON.parse(decrypted.toString('utf8')) as Record<string, string>
}
