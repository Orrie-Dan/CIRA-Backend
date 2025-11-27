import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '../prisma.js'
import { ApiError } from '../utils/errors.js'
import { uploadToCloudinary, deleteFromCloudinary, extractPublicId } from '../utils/cloudinary.js'

export async function photosRoutes(app: FastifyInstance) {
  // Upload photo for a report
  app.post('/reports/:reportId/photos', async (req: FastifyRequest<{ Params: { reportId: string } }>, reply) => {
    const { reportId } = req.params
    
    // Verify report exists
    const report = await prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true },
    })

    if (!report) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Report not found',
          requestId: req.id,
        },
      })
    }

    try {
      // Use req.file() for the file (like avatar upload which works)
      // Get caption from query parameter or form field
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

      // Get caption from query parameter (fallback to empty string)
      const caption = (req.query as any)?.caption || undefined

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
      if (!data.mimetype || !allowedTypes.includes(data.mimetype)) {
        app.log.warn({ mimetype: data.mimetype, reportId }, 'Invalid file type')
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid file type. Only JPEG, PNG, and WebP images are allowed.',
            requestId: req.id,
          },
        })
      }

      // Validate file size (max 5MB)
      const maxSize = 5 * 1024 * 1024 // 5MB
      const buffer = await data.toBuffer()
      if (buffer.length > maxSize) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'File too large. Maximum size is 5MB.',
            requestId: req.id,
          },
        })
      }

      app.log.info({ reportId, fileSize: buffer.length, mimetype: data.mimetype }, 'Starting photo upload')

      // Upload to Cloudinary
      let uploadResult
      try {
        app.log.info({ reportId, bufferSize: buffer.length }, 'Starting Cloudinary upload')
        
        uploadResult = await uploadToCloudinary(buffer, `reports/${reportId}`, {
          resource_type: 'image',
          transformation: [
            { quality: 'auto' },
            { fetch_format: 'auto' },
          ],
        })
        
        app.log.info({ reportId, publicId: uploadResult.public_id }, 'Cloudinary upload successful')
      } catch (cloudinaryError: any) {
        app.log.error({ 
          error: cloudinaryError, 
          reportId,
          message: cloudinaryError?.message,
          httpCode: cloudinaryError?.http_code,
          stack: cloudinaryError?.stack,
        }, 'Cloudinary upload failed')
        
        // Check if it's a timeout
        if (cloudinaryError?.message?.includes('timeout')) {
          return reply.code(504).send({
            error: {
              code: 'UPLOAD_TIMEOUT',
              message: 'Photo upload timed out. Please try again with a smaller image.',
              requestId: req.id,
            },
          })
        }
        
        return reply.code(500).send({
          error: {
            code: 'CLOUDINARY_UPLOAD_FAILED',
            message: cloudinaryError?.message || 'Failed to upload image to storage service',
            requestId: req.id,
            ...(process.env.NODE_ENV !== 'production' && {
              debug: {
                httpCode: cloudinaryError?.http_code,
                name: cloudinaryError?.name,
              },
            }),
          },
        })
      }

      // Create database record with Cloudinary URL
      let photo
      try {
        photo = await prisma.reportPhoto.create({
          data: {
            reportId,
            url: uploadResult.secure_url,
            caption,
          },
        })
        app.log.info({ reportId, photoId: photo.id }, 'Photo record created successfully')
      } catch (dbError: any) {
        app.log.error({ 
          error: dbError, 
          reportId,
          uploadResult,
          message: dbError?.message,
          code: dbError?.code,
        }, 'Failed to save photo to database')
        
        // Try to clean up Cloudinary upload if database save fails
        try {
          await deleteFromCloudinary(uploadResult.public_id)
          app.log.info({ publicId: uploadResult.public_id }, 'Cleaned up Cloudinary upload after DB failure')
        } catch (cleanupError) {
          app.log.warn({ error: cleanupError, publicId: uploadResult.public_id }, 'Failed to clean up Cloudinary upload')
        }
        
        return reply.code(500).send({
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to save photo record',
            requestId: req.id,
            ...(process.env.NODE_ENV !== 'production' && {
              debug: {
                message: dbError?.message,
                code: dbError?.code,
              },
            }),
          },
        })
      }

      return reply.code(201).send({
        id: photo.id,
        url: photo.url,
        caption: photo.caption,
        createdAt: photo.createdAt.toISOString(),
      })
    } catch (error: any) {
      app.log.error({ 
        error, 
        reportId,
        message: error?.message,
        stack: error?.stack,
        name: error?.name,
      }, 'Failed to upload photo - unexpected error')
      
      // Check if it's a multipart parsing error
      if (error.code === 'FST_ERR_MULTIPART_INVALID_CONTENT_TYPE' || 
          error.message?.includes('multipart') ||
          error.message?.includes('boundary')) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid multipart request format',
            requestId: req.id,
          },
        })
      }
      
      return reply.code(500).send({
        error: {
          code: 'UPLOAD_FAILED',
          message: error?.message || 'Failed to upload photo',
          requestId: req.id,
          ...(process.env.NODE_ENV !== 'production' && {
            debug: {
              name: error?.name,
              message: error?.message?.substring(0, 200),
            },
          }),
        },
      })
    }
  })

  // Delete photo
  app.delete('/photos/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { id } = req.params

    try {
      const photo = await prisma.reportPhoto.findUnique({
        where: { id },
        select: { id: true, url: true },
      })

      if (!photo) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Photo not found',
            requestId: req.id,
          },
        })
      }

      // Delete from Cloudinary if it's a Cloudinary URL
      const publicId = extractPublicId(photo.url)
      if (publicId) {
        try {
          await deleteFromCloudinary(publicId)
        } catch (err) {
          app.log.warn(err, 'Failed to delete file from Cloudinary')
        }
      } else {
        // Legacy: Log warning if it's an old local URL
        // This handles migration period
        app.log.warn(`Photo ${id} has non-Cloudinary URL, skipping Cloudinary deletion`)
      }

      // Delete database record
      await prisma.reportPhoto.delete({
        where: { id },
      })

      return reply.code(204).send()
    } catch (error) {
      app.log.error(error, 'Failed to delete photo')
      throw new ApiError(500, 'Failed to delete photo', 'DELETE_FAILED')
    }
  })
}

