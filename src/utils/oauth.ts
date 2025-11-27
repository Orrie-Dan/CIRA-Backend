import { prisma } from '../prisma.js'
import type { FastifyInstance } from 'fastify'

export interface GoogleUserInfo {
  id: string
  email: string
  verified_email: boolean
  name?: string
  picture?: string
}

export interface AppleUserInfo {
  sub: string // Apple user ID
  email: string
  email_verified?: boolean
  name?: {
    firstName?: string
    lastName?: string
  }
}

/**
 * Verify Google OAuth token and get user info
 */
export async function verifyGoogleToken(
  idToken: string
): Promise<GoogleUserInfo> {
  try {
    // In production, use Google's token verification
    // For now, we'll use a simple fetch to Google's userinfo endpoint
    // In a real implementation, verify the JWT token properly
    const response = await fetch(
      `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${idToken}`
    )

    if (!response.ok) {
      throw new Error('Failed to verify Google token')
    }

    const userInfo = await response.json()
    return userInfo as GoogleUserInfo
  } catch (error) {
    throw new Error(`Google token verification failed: ${error}`)
  }
}

/**
 * Verify Apple OAuth token and get user info
 * Apple uses JWT tokens that need to be verified with Apple's public keys
 */
export async function verifyAppleToken(
  idToken: string
): Promise<AppleUserInfo> {
  try {
    // Apple Sign In uses JWT tokens
    // In production, verify the JWT using Apple's public keys
    // For now, decode the JWT payload (not secure, but works for development)
    // In production, use a library like 'jsonwebtoken' with Apple's public keys
    
    // Decode JWT payload (base64url)
    const parts = idToken.split('.')
    if (parts.length !== 3) {
      throw new Error('Invalid Apple token format')
    }

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8')
    )

    return {
      sub: payload.sub,
      email: payload.email,
      email_verified: payload.email_verified,
      name: payload.name,
    } as AppleUserInfo
  } catch (error) {
    throw new Error(`Apple token verification failed: ${error}`)
  }
}

/**
 * Find or create user from OAuth provider
 */
export async function findOrCreateOAuthUser(
  provider: 'google' | 'apple',
  providerId: string,
  email: string,
  fullName?: string,
  picture?: string
) {
  // Check if user exists with this provider
  // Note: Prisma doesn't support composite unique constraints with nulls well
  // So we use findFirst instead
  const existingUser = await prisma.userAccount.findFirst({
    where: {
      provider,
      providerId,
    },
  })

  if (existingUser) {
    return existingUser
  }

  // Check if user exists with this email (account linking)
  const existingEmailUser = await prisma.userAccount.findUnique({
    where: { email },
  })

  if (existingEmailUser) {
    // Link OAuth provider to existing account
    return await prisma.userAccount.update({
      where: { id: existingEmailUser.id },
      data: {
        provider,
        providerId,
      },
    })
  }

  // Create new user
  return await prisma.userAccount.create({
    data: {
      email,
      fullName: fullName || null,
      provider,
      providerId,
      role: 'citizen', // Default role
      passwordHash: null, // No password for OAuth users
    },
  })
}

