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
      const parts = req.parts()
      let fileData: any = null
      let caption: string | undefined

      for await (const part of parts) {
        if (part.type === 'file') {
          fileData = part
        } else if (part.fieldname === 'caption') {
          caption = part.value as string
        }
      }

      if (!fileData) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'No file uploaded',
            requestId: req.id,
          },
        })
      }

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
      if (!fileData.mimetype || !allowedTypes.includes(fileData.mimetype)) {
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
      const buffer = await fileData.toBuffer()
      if (buffer.length > maxSize) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'File too large. Maximum size is 5MB.',
            requestId: req.id,
          },
        })
      }

      // Upload to Cloudinary
      const uploadResult = await uploadToCloudinary(buffer, `reports/${reportId}`, {
        resource_type: 'image',
        transformation: [
          { quality: 'auto' },
          { fetch_format: 'auto' },
        ],
      })

      // Create database record with Cloudinary URL
      const photo = await prisma.reportPhoto.create({
        data: {
          reportId,
          url: uploadResult.secure_url, // Use secure_url (HTTPS)
          caption,
        },
      })

      return reply.code(201).send({
        id: photo.id,
        url: photo.url,
        caption: photo.caption,
        createdAt: photo.createdAt.toISOString(),
      })
    } catch (error) {
      app.log.error(error, 'Failed to upload photo')
      throw new ApiError(500, 'Failed to upload photo', 'UPLOAD_FAILED')
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

