import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { registerSchema, loginSchema } from '../schemas.js'
import { ApiError } from '../utils/errors.js'
import { hashPassword, verifyPassword, JWTPayload } from '../utils/auth.js'
import { authenticateUser } from '../utils/authMiddleware.js'
import { logAuditEvent, AuditActions, ResourceTypes } from '../utils/auditLogger.js'
import {
  verifyGoogleToken,
  verifyAppleToken,
  findOrCreateOAuthUser,
} from '../utils/oauth.js'
import {
  generateOTP,
  storeOTP,
  verifyOTP,
  cleanupExpiredOTPs,
} from '../utils/otp.js'
import { sendOTPViaEmail } from '../utils/email.js'
import { sendOTPViaSMS } from '../utils/sms.js'
import sharp from 'sharp'
import { uploadToCloudinary, deleteFromCloudinary, extractPublicId } from '../utils/cloudinary.js'

export async function authRoutes(app: FastifyInstance) {
  // Register new user
  app.post('/auth/register', async (req: FastifyRequest, reply) => {
    const body = req.body as Record<string, unknown>
    app.log.info({ body: { ...body, password: body?.password ? '[HIDDEN]' : undefined } }, 'Registration request received:')
    
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      app.log.warn(parsed.error.flatten(), 'Validation failed:')
      const fieldErrors: Record<string, string[]> = {}
      parsed.error.errors.forEach((err) => {
        const path = err.path.join('.')
        if (!fieldErrors[path]) {
          fieldErrors[path] = []
        }
        fieldErrors[path].push(err.message)
      })
      
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check your information and try again.',
          details: {
            fieldErrors,
            formErrors: parsed.error.errors.map(e => e.message),
          },
          requestId: req.id,
        },
      })
    }

    try {
      // Check if user already exists
      const existingUser = await prisma.userAccount.findUnique({
        where: { email: parsed.data.email },
      })

      if (existingUser) {
        return reply.code(409).send({
          error: {
            code: 'USER_ALREADY_EXISTS',
            message: 'A user with this email already exists',
            requestId: req.id,
          },
        })
      }

      // Hash password and create user (unverified initially)
      const passwordHash = await hashPassword(parsed.data.password)

      // Clean up optional fields - convert empty strings to null
      const userData: {
        email: string
        passwordHash: string
        fullName: string | null
        phone: string | null
        role: string
        provider: null
        providerId: null
      } = {
        email: parsed.data.email.trim(),
        passwordHash: passwordHash,
        fullName: parsed.data.fullName && parsed.data.fullName.trim().length > 0 
          ? parsed.data.fullName.trim() 
          : null,
        phone: parsed.data.phone && parsed.data.phone.trim().length > 0 
          ? parsed.data.phone.trim() 
          : null,
        role: 'citizen', // Default role for self-registration
        provider: null,
        providerId: null,
        // emailVerified and phoneVerified have defaults in the schema, so we don't need to set them
      }

      app.log.info({ ...userData, passwordHash: '[HIDDEN]' }, 'Creating user with data:')

      const user = await prisma.userAccount.create({
        data: userData,
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          emailVerified: true,
          phoneVerified: true,
          createdAt: true,
        },
      })

      // Generate and send OTP
      cleanupExpiredOTPs()
      const otp = generateOTP()
      storeOTP(parsed.data.email, otp, user.id, 'verification')

      // Send OTP via email (primary) or SMS (if phone provided)
      try {
        if (parsed.data.phone) {
          await sendOTPViaSMS(parsed.data.phone, otp)
        } else {
          await sendOTPViaEmail(parsed.data.email, otp)
        }
      } catch (error) {
        app.log.error(error, 'Failed to send OTP:')
        // Continue anyway - OTP is logged in development
      }

      // Log audit event
      await logAuditEvent({
        userId: user.id,
        action: AuditActions.USER_REGISTERED,
        resourceType: ResourceTypes.USER,
        resourceId: user.id,
        details: { email: user.email, role: user.role, requiresVerification: true },
      })

      // Return user without token - they need to verify OTP first
      return reply.code(201).send({
        user,
        requiresVerification: true,
        message: 'Account created. Please verify your email/phone with the OTP code sent to you.',
        // In development, include OTP for testing
        ...(process.env.NODE_ENV !== 'production' && { otp }),
      })
    } catch (error: any) {
      app.log.error({
        name: error?.name,
        code: error?.code,
        message: error?.message,
        stack: error?.stack,
      }, 'Registration error:')
      
      // Provide more specific error messages
      if (error.code === 'P2002') {
        // Prisma unique constraint violation
        return reply.code(409).send({
          error: {
            code: 'DUPLICATE_ENTRY',
            message: 'An account with this email already exists. Please use a different email or try logging in.',
            requestId: req.id,
          },
        })
      }
      
      if (error.code === 'P2003') {
        // Prisma foreign key constraint violation
        return reply.code(400).send({
          error: {
            code: 'INVALID_REFERENCE',
            message: 'Invalid data provided. Please check your information and try again.',
            requestId: req.id,
          },
        })
      }
      
      // Prisma validation errors
      if (error.name === 'PrismaClientValidationError' || error.message?.includes('Unknown argument')) {
        app.log.error({
          name: error.name,
          message: error.message,
          code: error.code,
        }, 'Prisma validation error:')
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid data provided. Please check your information and try again.',
            details: {
              formErrors: [error.message || 'Invalid data format'],
            },
            requestId: req.id,
          },
        })
      }
      
      // Database connection errors
      if (error.code === 'ECONNREFUSED' || error.message?.includes('connect') || error.message?.includes('Connection')) {
        return reply.code(503).send({
          error: {
            code: 'DATABASE_ERROR',
            message: 'Database connection failed. Please try again later.',
            requestId: req.id,
          },
        })
      }
      
      // Extract safe error message - ensure it's always a string
      let errorMessage = 'Failed to create user account. Please try again.'
      
      if (error && typeof error.message === 'string' && error.message.length > 0) {
        // Only use error message if it's a reasonable string (not a stringified object)
        if (!error.message.includes('Object') && 
            !error.message.includes('Input') && 
            !error.message.includes('Prisma') &&
            !error.message.includes('CreateNested') &&
            error.message.length < 500) {
          errorMessage = error.message
        }
      }
      
      // In development, include more details
      const errorResponse: any = {
        error: {
          code: 'REGISTRATION_FAILED',
          message: errorMessage,
          requestId: req.id,
        },
      }
      
      if (process.env.NODE_ENV !== 'production') {
        errorResponse.error.debug = {
          name: error?.name,
          code: error?.code,
          message: error?.message?.substring(0, 200),
        }
      }
      
      return reply.code(500).send(errorResponse)
    }
  })

  // Login
  app.post('/auth/login', async (req: FastifyRequest, reply) => {
    const parsed = loginSchema.safeParse(req.body)
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
      // Find user by email
      const user = await prisma.userAccount.findUnique({
        where: { email: parsed.data.email },
      })

      if (!user) {
        return reply.code(401).send({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
            requestId: req.id,
          },
        })
      }

      // Check if user has a password (not OAuth-only account)
      if (!user.passwordHash) {
        return reply.code(401).send({
          error: {
            code: 'OAUTH_ONLY_ACCOUNT',
            message: 'This account was created with social login. Please use social login to sign in.',
            requestId: req.id,
          },
        })
      }

      // Verify password
      const isValid = await verifyPassword(parsed.data.password, user.passwordHash)
      if (!isValid) {
        return reply.code(401).send({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
            requestId: req.id,
          },
        })
      }

      // Generate JWT token
      const token = app.jwt.sign({
        userId: user.id,
        email: user.email,
        role: user.role,
      } as JWTPayload)

      // Set HTTP-only cookie
      reply.setCookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      })

      // Log audit event
      await logAuditEvent({
        userId: user.id,
        action: AuditActions.USER_LOGIN,
        resourceType: ResourceTypes.USER,
        resourceId: user.id,
        details: { email: user.email },
      })

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          phone: user.phone,
          role: user.role,
          createdAt: user.createdAt,
        },
        token, // Also return token in response for frontend convenience
      })
    } catch (error) {
      app.log.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Login error')
      throw new ApiError(500, 'Failed to authenticate user', 'INTERNAL_ERROR')
    }
  })

  // Get current user
  app.get('/auth/me', { preHandler: authenticateUser }, async (req: FastifyRequest, reply) => {
    try {
      // JWT is verified by the decorator/middleware
      const user = await prisma.userAccount.findUnique({
        where: { id: (req.user as JWTPayload).userId },
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          avatarUrl: true,
          createdAt: true,
        },
      })

      if (!user) {
        return reply.code(404).send({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
            requestId: req.id,
          },
        })
      }

      return reply.send({ user })
    } catch (error) {
      app.log.error(error, 'Get user error:')
      throw new ApiError(500, 'Failed to get user information', 'INTERNAL_ERROR')
    }
  })

  // Update profile
  app.put('/auth/profile', { preHandler: authenticateUser }, async (req: FastifyRequest, reply) => {
    const updateProfileSchema = z.object({
      fullName: z.string().min(1).max(255).optional(),
      phone: z.string().max(20).optional(),
    })

    const parsed = updateProfileSchema.safeParse(req.body)
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
      const userId = (req.user as JWTPayload).userId
      
      const updateData: { fullName?: string; phone?: string | null } = {}
      if (parsed.data.fullName !== undefined) {
        updateData.fullName = parsed.data.fullName
      }
      if (parsed.data.phone !== undefined) {
        updateData.phone = parsed.data.phone || null
      }

      const user = await prisma.userAccount.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          avatarUrl: true,
          createdAt: true,
        },
      })

      // Log audit event
      await logAuditEvent({
        userId: user.id,
        action: AuditActions.USER_PROFILE_UPDATED,
        resourceType: ResourceTypes.USER,
        resourceId: user.id,
        details: { updatedFields: Object.keys(updateData) },
      })

      return reply.send({ user })
    } catch (error) {
      app.log.error(error, 'Update profile error:')
      throw new ApiError(500, 'Failed to update profile', 'UPDATE_FAILED')
    }
  })

  // Upload avatar
  app.put('/auth/profile/avatar', { preHandler: authenticateUser }, async (req: FastifyRequest, reply) => {
    try {
      const userId = (req.user as JWTPayload).userId
      
      const data = await req.file()
      if (!data) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'No file uploaded',
            requestId: req.id,
          },
        })
      }

      // Validate file type (JPEG/PNG only)
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png']
      if (!data.mimetype || !allowedTypes.includes(data.mimetype)) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid file type. Only JPEG and PNG images are allowed.',
            requestId: req.id,
          },
        })
      }

      // Validate file size (max 2MB)
      const maxSize = 2 * 1024 * 1024 // 2MB
      const buffer = await data.toBuffer()
      if (buffer.length > maxSize) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'File too large. Maximum size is 2MB.',
            requestId: req.id,
          },
        })
      }

      // Resize image to 200x200px using sharp
      const resizedBuffer = await sharp(buffer)
        .resize(200, 200, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: 85 })
        .toBuffer()

      // Delete old avatar from Cloudinary if exists
      const user = await prisma.userAccount.findUnique({
        where: { id: userId },
        select: { avatarUrl: true },
      })

      if (user?.avatarUrl) {
        const oldPublicId = extractPublicId(user.avatarUrl)
        if (oldPublicId) {
          try {
            await deleteFromCloudinary(oldPublicId)
          } catch (err) {
            app.log.warn(err, 'Failed to delete old avatar from Cloudinary')
          }
        }
      }

      // Upload to Cloudinary
      const uploadResult = await uploadToCloudinary(resizedBuffer, 'avatars', {
        resource_type: 'image',
        transformation: [
          { width: 200, height: 200, crop: 'fill', gravity: 'face' },
          { quality: 'auto' },
          { fetch_format: 'auto' },
        ],
      })

      // Update user avatar URL in database
      const updatedUser = await prisma.userAccount.update({
        where: { id: userId },
        data: {
          avatarUrl: uploadResult.secure_url, // Use secure_url (HTTPS)
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          avatarUrl: true,
          createdAt: true,
        },
      })

      // Log audit event
      await logAuditEvent({
        userId: updatedUser.id,
        action: AuditActions.USER_PROFILE_UPDATED,
        resourceType: ResourceTypes.USER,
        resourceId: updatedUser.id,
        details: { updatedFields: ['avatarUrl'] },
      })

      return reply.send({ user: updatedUser })
    } catch (error) {
      app.log.error(error, 'Avatar upload error:')
      throw new ApiError(500, 'Failed to upload avatar', 'UPLOAD_FAILED')
    }
  })

  // Get user preferences
  app.get('/auth/preferences', { preHandler: authenticateUser }, async (req: FastifyRequest, reply) => {
    try {
      const userId = (req.user as JWTPayload).userId
      
      let preferences = await prisma.userPreferences.findUnique({
        where: { userId },
      })

      // Create default preferences if they don't exist
      if (!preferences) {
        preferences = await prisma.userPreferences.create({
          data: {
            userId,
            emailNotifications: true,
            pushNotifications: true,
            nearbyAlerts: true,
            language: 'en',
          },
        })
      }

      return reply.send({ preferences })
    } catch (error) {
      app.log.error(error, 'Get preferences error:')
      throw new ApiError(500, 'Failed to get preferences', 'FETCH_FAILED')
    }
  })

  // Update user preferences
  app.put('/auth/preferences', { preHandler: authenticateUser }, async (req: FastifyRequest, reply) => {
    const updatePreferencesSchema = z.object({
      emailNotifications: z.boolean().optional(),
      pushNotifications: z.boolean().optional(),
      nearbyAlerts: z.boolean().optional(),
      language: z.enum(['en', 'rw']).optional(),
    })

    const parsed = updatePreferencesSchema.safeParse(req.body)
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
      const userId = (req.user as JWTPayload).userId
      
      const preferences = await prisma.userPreferences.upsert({
        where: { userId },
        update: {
          ...(parsed.data.emailNotifications !== undefined && { emailNotifications: parsed.data.emailNotifications }),
          ...(parsed.data.pushNotifications !== undefined && { pushNotifications: parsed.data.pushNotifications }),
          ...(parsed.data.nearbyAlerts !== undefined && { nearbyAlerts: parsed.data.nearbyAlerts }),
          ...(parsed.data.language !== undefined && { language: parsed.data.language }),
        },
        create: {
          userId,
          emailNotifications: parsed.data.emailNotifications ?? true,
          pushNotifications: parsed.data.pushNotifications ?? true,
          nearbyAlerts: parsed.data.nearbyAlerts ?? true,
          language: parsed.data.language ?? 'en',
        },
      })

      return reply.send({ preferences })
    } catch (error) {
      app.log.error(error, 'Update preferences error:')
      throw new ApiError(500, 'Failed to update preferences', 'UPDATE_FAILED')
    }
  })

  // Logout
  app.post('/auth/logout', async (req: FastifyRequest, reply) => {
    reply.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    })

    return reply.send({ message: 'Logged out successfully' })
  })

  // Google OAuth login
  app.post('/auth/google', async (req: FastifyRequest, reply) => {
    const googleLoginSchema = z.object({
      idToken: z.string().min(1),
    })

    const parsed = googleLoginSchema.safeParse(req.body)
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
      // Verify Google token and get user info
      const googleUser = await verifyGoogleToken(parsed.data.idToken)

      if (!googleUser.verified_email) {
        return reply.code(400).send({
          error: {
            code: 'EMAIL_NOT_VERIFIED',
            message: 'Google email is not verified',
            requestId: req.id,
          },
        })
      }

      // Find or create user
      const user = await findOrCreateOAuthUser(
        'google',
        googleUser.id,
        googleUser.email,
        googleUser.name,
        googleUser.picture
      )

      // Generate JWT token
      const token = app.jwt.sign({
        userId: user.id,
        email: user.email,
        role: user.role,
      } as JWTPayload)

      // Set HTTP-only cookie
      reply.setCookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      })

      // Log audit event
      await logAuditEvent({
        userId: user.id,
        action: AuditActions.USER_LOGIN,
        resourceType: ResourceTypes.USER,
        resourceId: user.id,
        details: { email: user.email, provider: 'google' },
      })

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          phone: user.phone,
          role: user.role,
          createdAt: user.createdAt,
        },
        token,
      })
    } catch (error: any) {
      app.log.error(error, 'Google OAuth error:')
      return reply.code(401).send({
        error: {
          code: 'OAUTH_ERROR',
          message: error.message || 'Failed to authenticate with Google',
          requestId: req.id,
        },
      })
    }
  })

  // Apple OAuth login
  app.post('/auth/apple', async (req: FastifyRequest, reply) => {
    const appleLoginSchema = z.object({
      idToken: z.string().min(1),
      fullName: z
        .object({
          givenName: z.string().optional(),
          familyName: z.string().optional(),
        })
        .optional(),
    })

    const parsed = appleLoginSchema.safeParse(req.body)
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
      // Verify Apple token and get user info
      const appleUser = await verifyAppleToken(parsed.data.idToken)

      // Construct full name from Apple response or request
      let fullName: string | undefined
      if (parsed.data.fullName) {
        const parts = [
          parsed.data.fullName.givenName,
          parsed.data.fullName.familyName,
        ].filter(Boolean)
        fullName = parts.length > 0 ? parts.join(' ') : undefined
      } else if (appleUser.name) {
        const parts = [
          appleUser.name.firstName,
          appleUser.name.lastName,
        ].filter(Boolean)
        fullName = parts.length > 0 ? parts.join(' ') : undefined
      }

      // Find or create user
      const user = await findOrCreateOAuthUser(
        'apple',
        appleUser.sub,
        appleUser.email,
        fullName
      )

      // Generate JWT token
      const token = app.jwt.sign({
        userId: user.id,
        email: user.email,
        role: user.role,
      } as JWTPayload)

      // Set HTTP-only cookie
      reply.setCookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      })

      // Log audit event
      await logAuditEvent({
        userId: user.id,
        action: AuditActions.USER_LOGIN,
        resourceType: ResourceTypes.USER,
        resourceId: user.id,
        details: { email: user.email, provider: 'apple' },
      })

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          phone: user.phone,
          role: user.role,
          createdAt: user.createdAt,
        },
        token,
      })
    } catch (error: any) {
      app.log.error(error, 'Apple OAuth error:')
      return reply.code(401).send({
        error: {
          code: 'OAUTH_ERROR',
          message: error.message || 'Failed to authenticate with Apple',
          requestId: req.id,
        },
      })
    }
  })

  // Send OTP for verification
  app.post('/auth/send-otp', async (req: FastifyRequest, reply) => {
    const sendOTPSchema = z.object({
      email: z.string().email().optional(),
      phone: z.string().optional(),
    })

    const parsed = sendOTPSchema.safeParse(req.body)
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

    if (!parsed.data.email && !parsed.data.phone) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Either email or phone must be provided',
          requestId: req.id,
        },
      })
    }

    try {
      cleanupExpiredOTPs()

      const identifier = parsed.data.email || parsed.data.phone!
      
      // Find user by email or phone
      const user = await prisma.userAccount.findFirst({
        where: parsed.data.email
          ? { email: parsed.data.email }
          : { phone: parsed.data.phone },
      })

      if (!user) {
        // Don't reveal if user exists (security best practice)
        return reply.send({
          message: 'If an account exists, a verification code has been sent.',
        })
      }

      // Generate OTP
      const otp = generateOTP()
      storeOTP(identifier, otp, user.id, 'verification')

      // Send OTP
      try {
        if (parsed.data.phone) {
          await sendOTPViaSMS(parsed.data.phone!, otp)
        } else {
          await sendOTPViaEmail(parsed.data.email!, otp)
        }
      } catch (error) {
        app.log.error(error, 'Failed to send OTP:')
        // Continue anyway
      }

      return reply.send({
        message: 'Verification code sent successfully',
        // In development, include OTP for testing
        ...(process.env.NODE_ENV !== 'production' && { otp }),
      })
    } catch (error) {
      app.log.error(error, 'Send OTP error:')
      throw new ApiError(500, 'Failed to send verification code', 'SEND_OTP_FAILED')
    }
  })

  // Verify OTP
  app.post('/auth/verify-otp', async (req: FastifyRequest, reply) => {
    const verifyOTPSchema = z.object({
      email: z.string().email().optional(),
      phone: z.string().optional(),
      code: z.string().length(6),
    })

    const parsed = verifyOTPSchema.safeParse(req.body)
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

    if (!parsed.data.email && !parsed.data.phone) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Either email or phone must be provided',
          requestId: req.id,
        },
      })
    }

    try {
      cleanupExpiredOTPs()

      const identifier = parsed.data.email || parsed.data.phone!
      const verification = verifyOTP(identifier, parsed.data.code, 'verification')

      if (!verification.valid) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_OTP',
            message: verification.error || 'Invalid or expired verification code',
            requestId: req.id,
          },
        })
      }

      // Update user verification status
      const updateData: { emailVerified?: boolean; phoneVerified?: boolean } = {}
      if (parsed.data.email) {
        updateData.emailVerified = true
      }
      if (parsed.data.phone) {
        updateData.phoneVerified = true
      }

      const user = await prisma.userAccount.update({
        where: { id: verification.userId! },
        data: updateData,
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          emailVerified: true,
          phoneVerified: true,
          createdAt: true,
        },
      })

      // Generate JWT token after verification
      const token = app.jwt.sign({
        userId: user.id,
        email: user.email,
        role: user.role,
      } as JWTPayload)

      // Set HTTP-only cookie
      reply.setCookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      })

      // Log audit event
      await logAuditEvent({
        userId: user.id,
        action: AuditActions.USER_PROFILE_UPDATED,
        resourceType: ResourceTypes.USER,
        resourceId: user.id,
        details: { verification: updateData },
      })

      return reply.send({
        user,
        token,
        verified: true,
      })
    } catch (error) {
      app.log.error(error, 'Verify OTP error:')
      throw new ApiError(500, 'Failed to verify code', 'VERIFY_OTP_FAILED')
    }
  })
}

