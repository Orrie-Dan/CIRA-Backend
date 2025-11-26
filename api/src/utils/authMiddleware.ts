import type { FastifyRequest, FastifyReply } from 'fastify'
import { JWTPayload } from './auth.js'

// Extend Fastify JWT types to properly type the payload
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JWTPayload
  }
}

// Type helper for accessing the authenticated user from request
type AuthenticatedRequest = FastifyRequest & {
    user?: JWTPayload
  }

// Helper function to safely get user from request
function getUser(request: FastifyRequest): JWTPayload | undefined {
  return (request as AuthenticatedRequest).user
}

export async function authenticateUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Try to get token from cookie first
    let token = request.cookies.token

    // If no cookie, try Authorization header
    if (!token) {
      const authHeader = request.headers.authorization
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7)
      }
    }

    if (!token) {
      return reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          requestId: request.id,
        },
      })
    }

    // Verify JWT token using Fastify JWT
    // Temporarily set the token in the request for jwtVerify
    const originalToken = request.headers.authorization
    request.headers.authorization = `Bearer ${token}`
    
    try {
      const decoded = await request.jwtVerify<JWTPayload>()
      // Attach user info to request (jwtVerify already sets request.user, but we ensure it's typed)
      ;(request as AuthenticatedRequest).user = decoded
    } finally {
      // Restore original authorization header
      request.headers.authorization = originalToken || undefined
    }
  } catch (error) {
    return reply.code(401).send({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token',
        requestId: request.id,
      },
    })
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = getUser(request)
    if (!user) {
      return reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          requestId: request.id,
        },
      })
    }

    if (!roles.includes(user.role)) {
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
          requestId: request.id,
        },
      })
    }
  }
}

