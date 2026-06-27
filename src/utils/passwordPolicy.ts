/**
 * Password policy enforcement.
 *
 * Validates password complexity and can be extended with expiry/history checks.
 */

export interface PasswordPolicyResult {
  valid: boolean
  message: string
}

/**
 * Validate password against policy rules.
 *
 * Rules:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - At least one special character (optional — can be configured)
 */
export function validatePassword(password: string): PasswordPolicyResult {
  if (!password || password.length < 8) {
    return { valid: false, message: '密码至少 8 位。' }
  }

  if (password.length > 128) {
    return { valid: false, message: '密码不能超过 128 位。' }
  }

  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个大写字母。' }
  }

  if (!/[a-z]/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个小写字母。' }
  }

  if (!/[0-9]/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个数字。' }
  }

  // Check for common weak passwords
  const weakPasswords = ['Password1', 'Admin123', 'Qwerty123', '12345678Aa']
  if (weakPasswords.some(w => password.toLowerCase().startsWith(w.toLowerCase()))) {
    return { valid: false, message: '密码过于简单，请使用更复杂的密码。' }
  }

  return { valid: true, message: '' }
}
