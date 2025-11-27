import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { ApiError } from '../utils/errors.js'
import { hashPassword } from '../utils/auth.js'

// In a real implementation, you would use a proper OTP service
// For now, we'll use a simple in-memory store (use Redis in production)
const otpStore = new Map<string, { code: string; expiresAt: number; userId?: string }>()

// Generate a 6-digit OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// Clean up expired OTPs
function cleanupExpiredOTPs() {
  const now = Date.now()
  for (const [key, value] of otpStore.entries()) {
    if (value.expiresAt < now) {
      otpStore.delete(key)
    }
  }
}

export async function passwordResetRoutes(app: FastifyInstance) {
  // Request password reset (send OTP)
  app.post('/auth/password-reset/request', async (req: FastifyRequest, reply) => {
    const requestResetSchema = z.object({
      email: z.string().email(),
    })

    const parsed = requestResetSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: parsed.error.flatten(),
          requestId: req.id,
        },
      })
    }

    try {
      cleanupExpiredOTPs()

      // Find user by email
      const user = await prisma.userAccount.findUnique({
        where: { email: parsed.data.email },
        select: { id: true, email: true },
      })

      // Don't reveal if user exists (security best practice)
      if (!user) {
        // Still return success to prevent email enumeration
        return reply.send({
          message: 'If an account with that email exists, a password reset code has been sent.',
        })
      }

      // Generate OTP
      const otp = generateOTP()
      const expiresAt = Date.now() + 15 * 60 * 1000 // 15 minutes

      // Store OTP (in production, use Redis with expiration)
      otpStore.set(parsed.data.email, {
        code: otp,
        expiresAt,
        userId: user.id,
      })

      // In production, send OTP via email/SMS service
      // For now, we'll just log it (remove in production!)
      app.log.info(`Password reset OTP for ${parsed.data.email}: ${otp}`)
      
      // TODO: Send email/SMS with OTP
      // await sendEmail(user.email, 'Password Reset', `Your OTP is: ${otp}`)
      // or
      // await sendSMS(user.phone, `Your password reset code is: ${otp}`)

      return reply.send({
        message: 'If an account with that email exists, a password reset code has been sent.',
        // Remove this in production - only for development
        ...(process.env.NODE_ENV !== 'production' && { otp }),
      })
    } catch (error) {
      app.log.error(error, 'Password reset request error:')
      throw new ApiError(500, 'Failed to process password reset request', 'RESET_REQUEST_FAILED')
    }
  })

  // Verify OTP and reset password
  app.post('/auth/password-reset/verify', async (req: FastifyRequest, reply) => {
    const verifyResetSchema = z.object({
      email: z.string().email(),
      otp: z.string().length(6),
      newPassword: z.string().min(8).max(100),
    })

    const parsed = verifyResetSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: parsed.error.flatten(),
          requestId: req.id,
        },
      })
    }

    try {
      cleanupExpiredOTPs()

      // Get stored OTP
      const stored = otpStore.get(parsed.data.email)

      if (!stored) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_OTP',
            message: 'Invalid or expired reset code',
            requestId: req.id,
          },
        })
      }

      // Check if OTP is expired
      if (stored.expiresAt < Date.now()) {
        otpStore.delete(parsed.data.email)
        return reply.code(400).send({
          error: {
            code: 'OTP_EXPIRED',
            message: 'Reset code has expired. Please request a new one.',
            requestId: req.id,
          },
        })
      }

      // Verify OTP
      if (stored.code !== parsed.data.otp) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_OTP',
            message: 'Invalid reset code',
            requestId: req.id,
          },
        })
      }

      // Update password
      const passwordHash = await hashPassword(parsed.data.newPassword)
      await prisma.userAccount.update({
        where: { id: stored.userId! },
        data: { passwordHash },
      })

      // Remove used OTP
      otpStore.delete(parsed.data.email)

      return reply.send({
        message: 'Password has been reset successfully',
      })
    } catch (error) {
      app.log.error(error, 'Password reset verify error:')
      throw new ApiError(500, 'Failed to reset password', 'RESET_VERIFY_FAILED')
    }
  })
}

