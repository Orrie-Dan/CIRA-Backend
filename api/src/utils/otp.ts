import { prisma } from '../prisma.js'

// In-memory OTP store (use Redis in production)
const otpStore = new Map<string, { code: string; expiresAt: number; userId?: string; purpose: 'verification' | 'password_reset' }>()

/**
 * Generate a 6-digit OTP
 */
export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

/**
 * Store OTP with expiration
 */
export function storeOTP(
  identifier: string, // email or phone
  code: string,
  userId?: string,
  purpose: 'verification' | 'password_reset' = 'verification',
  expiresInMinutes: number = 15
): void {
  const expiresAt = Date.now() + expiresInMinutes * 60 * 1000
  otpStore.set(`${identifier}:${purpose}`, {
    code,
    expiresAt,
    userId,
    purpose,
  })
}

/**
 * Verify OTP
 */
export function verifyOTP(
  identifier: string,
  code: string,
  purpose: 'verification' | 'password_reset' = 'verification'
): { valid: boolean; userId?: string; error?: string } {
  const key = `${identifier}:${purpose}`
  const stored = otpStore.get(key)

  if (!stored) {
    return { valid: false, error: 'OTP not found' }
  }

  if (stored.expiresAt < Date.now()) {
    otpStore.delete(key)
    return { valid: false, error: 'OTP expired' }
  }

  if (stored.code !== code) {
    return { valid: false, error: 'Invalid OTP' }
  }

  // OTP is valid, remove it
  otpStore.delete(key)

  return { valid: true, userId: stored.userId }
}

/**
 * Clean up expired OTPs
 */
export function cleanupExpiredOTPs(): void {
  const now = Date.now()
  for (const [key, value] of otpStore.entries()) {
    if (value.expiresAt < now) {
      otpStore.delete(key)
    }
  }
}

/**
 * Get remaining time for OTP (in seconds)
 */
export function getOTPRemainingTime(
  identifier: string,
  purpose: 'verification' | 'password_reset' = 'verification'
): number {
  const key = `${identifier}:${purpose}`
  const stored = otpStore.get(key)

  if (!stored) {
    return 0
  }

  const remaining = Math.max(0, Math.floor((stored.expiresAt - Date.now()) / 1000))
  return remaining
}





