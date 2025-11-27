import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { reportsRoutes } from './routes/reports.js'
import { errorHandler, ApiError } from './utils/errors.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const port = Number(process.env.PORT || 3001)

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          headers: request.headers,
        }
      },
    },
  },
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'requestId',
  genReqId: () => crypto.randomUUID(),
  requestTimeout: 120000, // 120 seconds for file uploads
  bodyLimit: 10 * 1024 * 1024, // 10MB body limit
})

// JWT
await app.register(jwt, {
  secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
})

// Cookie
await app.register(cookie, {
  secret: process.env.COOKIE_SECRET || 'your-cookie-secret-change-in-production',
})

// Swagger/OpenAPI Documentation
await app.register(swagger, {
  openapi: {
    openapi: '3.0.0',
    info: {
      title: 'CIRA API',
      description: 'Community Infrastructure Reporting API',
      version: '0.1.0',
    },
    servers: [
      {
        url: process.env.API_URL || `http://localhost:${port}`,
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'token',
        },
      },
    },
    tags: [
      { name: 'auth', description: 'Authentication endpoints' },
      { name: 'reports', description: 'Report management endpoints' },
      { name: 'admin', description: 'Admin endpoints' },
      { name: 'geocoding', description: 'Geocoding endpoints' },
      { name: 'photos', description: 'Photo upload endpoints' },
      { name: 'notifications', description: 'Notification endpoints' },
      { name: 'analytics', description: 'Analytics and reporting endpoints' },
    ],
  },
})

// Swagger UI
await app.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: false,
  },
  staticCSP: true,
})

// CORS
await app.register(cors, {
  origin: (origin, cb) => {
    // In development, allow all origins (including mobile Expo)
    const isDevelopment = process.env.NODE_ENV !== 'production'
    
    if (isDevelopment) {
      cb(null, true)
      return
    }
    
    // In production, use allowed origins
    const allowed = (process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean)) || [
      'http://localhost:3000',
    ]
    if (!origin || allowed.includes(origin)) {
      cb(null, true)
    } else {
      cb(new Error('Not allowed'), false)
    }
  },
  credentials: true,
})

// Multipart support for file uploads
await app.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
})

// Static file serving removed - using Cloudinary for image storage
// await app.register(staticFiles, {
//   root: path.join(__dirname, '../uploads'),
//   prefix: '/uploads/',
// })

// Error handler
app.setErrorHandler((error, request, reply) => {
  // Extract status code from various error types
  let statusCode = 500
  if (error instanceof ApiError) {
    statusCode = error.statusCode
  } else if (error && typeof error === 'object' && 'statusCode' in error) {
    statusCode = (error as any).statusCode
  } else if (error && typeof error === 'object' && 'status' in error) {
    statusCode = (error as any).status
  }
  
  const response = errorHandler(error, request.id)
  reply.code(statusCode).send(response)
})

// Health check
app.get('/health', {
  schema: {
    description: 'Health check endpoint',
    tags: [],
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
}, async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

// Routes
const { authRoutes } = await import('./routes/auth.js')
await app.register(authRoutes)
await app.register(reportsRoutes)
const { adminRoutes } = await import('./routes/admin.js')
await app.register(adminRoutes)
const { geocodingRoutes } = await import('./routes/geocoding.js')
await app.register(geocodingRoutes)
const { photosRoutes } = await import('./routes/photos.js')
await app.register(photosRoutes)
const { notificationsRoutes } = await import('./routes/notifications.js')
await app.register(notificationsRoutes)
const { passwordResetRoutes } = await import('./routes/password-reset.js')
await app.register(passwordResetRoutes)
const { qcSlipRoutes } = await import('./routes/qc-slip.js')
await app.register(qcSlipRoutes)
const { analyticsRoutes } = await import('./routes/analytics.js')
await app.register(analyticsRoutes)

// Start server
const host = '0.0.0.0'

app.listen({ port, host }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
