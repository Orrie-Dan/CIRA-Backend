import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { assignReportSchema, addCommentSchema, adminListReportsQuerySchema, updateReportStatusSchema, createUserSchema, updatePasswordSchema } from '../schemas.js'
import { ApiError } from '../utils/errors.js'
import { hashPassword } from '../utils/auth.js'
import { authenticateUser } from '../utils/authMiddleware.js'
import { notifyUsers, getReportNotificationRecipients } from '../utils/notifications.js'
import { sendPushNotificationsToUsers } from '../utils/pushNotifications.js'
import { broadcastNotificationToUser } from './notifications.js'
import { logAuditEvent, AuditActions, ResourceTypes } from '../utils/auditLogger.js'

export async function adminRoutes(app: FastifyInstance) {
  // Get detailed report with all history, comments, and assignments
  app.get('/admin/reports/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { id } = req.params
    if (!z.string().uuid().safeParse(id).success) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_ID',
          message: 'Invalid report ID format',
          requestId: req.id,
        },
      })
    }

    try {
      const report = await prisma.report.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          description: true,
          type: true,
          severity: true,
          status: true,
          latitude: true,
          longitude: true,
          addressText: true,
          province: true,
          district: true,
          sector: true,
          createdAt: true,
          updatedAt: true,
          reporter: {
            select: { id: true, email: true, fullName: true, phone: true },
          },
          photos: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              url: true,
              caption: true,
              createdAt: true,
            },
          },
          statusHistory: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              fromStatus: true,
              toStatus: true,
              note: true,
              createdAt: true,
              changedByUser: {
                select: { id: true, email: true, fullName: true },
              },
            },
          },
          comments: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              body: true,
              createdAt: true,
              author: {
                select: { id: true, email: true, fullName: true },
              },
            },
          },
          assignments: {
            select: {
              id: true,
              dueAt: true,
              createdAt: true,
              assignee: {
                select: { id: true, email: true, fullName: true },
              },
              organization: {
                select: { id: true, name: true, contactEmail: true, contactPhone: true },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
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

      return reply.send({
        id: report.id,
        title: report.title,
        description: report.description,
        type: report.type,
        severity: report.severity,
        status: report.status,
        latitude: Number(report.latitude),
        longitude: Number(report.longitude),
        addressText: report.addressText,
        province: report.province,
        district: report.district,
        sector: report.sector,
        createdAt: report.createdAt.toISOString(),
        updatedAt: report.updatedAt.toISOString(),
        reporter: report.reporter || null,
        photos: report.photos.map((p) => ({
          id: p.id,
          url: p.url,
          caption: p.caption || null,
          createdAt: p.createdAt.toISOString(),
        })),
        statusHistory: report.statusHistory.map((h) => ({
          id: h.id,
          fromStatus: h.fromStatus || null,
          toStatus: h.toStatus,
          note: h.note || null,
          changedBy: h.changedByUser || null,
          createdAt: h.createdAt.toISOString(),
        })),
        comments: report.comments.map((c) => ({
          id: c.id,
          body: c.body,
          author: c.author || null,
          createdAt: c.createdAt.toISOString(),
        })),
        assignments: report.assignments.map((a) => ({
          id: a.id,
          assignee: a.assignee || null,
          organization: a.organization || null,
          dueAt: a.dueAt ? a.dueAt.toISOString() : null,
          createdAt: a.createdAt.toISOString(),
        })),
      })
    } catch (error) {
      app.log.error(error, 'Failed to fetch report details')
      // Log more details for debugging
      if (error instanceof Error) {
        app.log.error({
          message: error.message,
          stack: error.stack,
          name: error.name,
        }, 'Error details for report fetch')
      }
      throw new ApiError(500, 'Failed to fetch report details', 'FETCH_FAILED')
    }
  })

  // List reports with admin filters
  app.get('/admin/reports', async (req: FastifyRequest, reply) => {
    app.log.info({ query: req.query }, 'Admin reports query:')
    const parsed = adminListReportsQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      app.log.warn({ error: parsed.error.flatten() }, 'Validation failed:')
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: parsed.error.flatten(),
          requestId: req.id,
        },
      })
    }

    try {
      const where: any = {}
      
      if (parsed.data.bbox) {
        const [minLon, minLat, maxLon, maxLat] = parsed.data.bbox.split(',').map(Number)
        where.latitude = { gte: minLat, lte: maxLat }
        where.longitude = { gte: minLon, lte: maxLon }
      }

      if (parsed.data.status) {
        where.status = parsed.data.status
      }

      if (parsed.data.type) {
        where.type = parsed.data.type
      }

      if (parsed.data.severity) {
        where.severity = parsed.data.severity
      }

      if (parsed.data.assigneeId || parsed.data.organizationId) {
        where.assignments = {
          some: {
            ...(parsed.data.assigneeId && { assigneeId: parsed.data.assigneeId }),
            ...(parsed.data.organizationId && { organizationId: parsed.data.organizationId }),
          },
        }
      }

      // Query reports with all necessary fields
      const [reports, total] = await Promise.all([
        prisma.report.findMany({
          where,
          take: parsed.data.limit,
          skip: parsed.data.offset,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            severity: true,
            status: true,
            latitude: true,
            longitude: true,
            district: true,
            sector: true,
            province: true,
            addressText: true,
            createdAt: true,
            updatedAt: true,
            reporter: {
              select: { id: true, email: true, fullName: true },
            },
            assignments: {
              include: {
                assignee: {
                  select: { id: true, email: true, fullName: true },
                },
                organization: {
                  select: { id: true, name: true },
                },
              },
              take: 1,
              orderBy: { createdAt: 'desc' },
            },
            photos: {
              select: {
                id: true,
                url: true,
                caption: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'asc' },
              take: 3, // Limit to first 3 photos for list view
            },
          },
        }),
        prisma.report.count({ where }),
      ])
      
      app.log.info(`Fetched ${reports.length} reports (total: ${total})`)

      return reply.send({
        data: reports.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          type: r.type,
          severity: r.severity,
          status: r.status,
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
          district: r.district,
          photos: r.photos.map((p) => ({
            id: p.id,
            url: p.url,
            caption: p.caption,
            createdAt: p.createdAt.toISOString(),
          })),
          sector: r.sector,
          province: r.province,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          reporter: r.reporter,
          currentAssignment: r.assignments[0] ? {
            assignee: r.assignments[0].assignee,
            organization: r.assignments[0].organization,
            dueAt: r.assignments[0].dueAt?.toISOString(),
            createdAt: r.assignments[0].createdAt.toISOString(),
          } : null,
        })),
        meta: {
          total,
          limit: parsed.data.limit,
          offset: parsed.data.offset,
        },
      })
    } catch (error) {
      app.log.error(error, 'Failed to list reports')
      throw new ApiError(500, 'Failed to fetch reports', 'FETCH_FAILED')
    }
  })

  // Assign report to officer or organization
  app.post('/admin/reports/:id/assign', async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
    const { id } = req.params
    app.log.info({ id, body: req.body }, 'Assign request:')
    
    if (!z.string().uuid().safeParse(id).success) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_ID',
          message: 'Invalid report ID format',
          requestId: req.id,
        },
      })
    }

    // Clean the body - remove undefined values and empty strings
    const cleanedBody: any = {}
    if (req.body && typeof req.body === 'object') {
      const body = req.body as any
      if (body.assigneeId && typeof body.assigneeId === 'string' && body.assigneeId.trim() !== '') {
        cleanedBody.assigneeId = body.assigneeId.trim()
      }
      if (body.organizationId && typeof body.organizationId === 'string' && body.organizationId.trim() !== '') {
        cleanedBody.organizationId = body.organizationId.trim()
      }
      if (body.dueAt && typeof body.dueAt === 'string' && body.dueAt.trim() !== '') {
        cleanedBody.dueAt = body.dueAt.trim()
      }
    }

    app.log.info('Cleaned body:', cleanedBody)

    const parsed = assignReportSchema.extend({ reportId: z.string().uuid() }).omit({ reportId: true }).safeParse(cleanedBody)
    if (!parsed.success) {
      app.log.warn({ error: parsed.error.flatten() }, 'Validation failed:')
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: parsed.error.flatten(),
          requestId: req.id,
        },
      })
    }

    if (!parsed.data.assigneeId && !parsed.data.organizationId) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Either assigneeId or organizationId must be provided',
          requestId: req.id,
        },
      })
    }

    try {
      // Verify report exists
      const report = await prisma.report.findUnique({
        where: { id },
        select: { id: true, status: true },
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

      // Create assignment
      const assignment = await prisma.reportAssignment.create({
        data: {
          reportId: id,
          assigneeId: parsed.data.assigneeId,
          organizationId: parsed.data.organizationId,
          dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
        },
        include: {
          assignee: {
            select: { id: true, email: true, fullName: true },
          },
          organization: {
            select: { id: true, name: true, contactEmail: true, contactPhone: true },
          },
        },
      })

      // Get user ID for audit logging
      const userId = (req.user as any)?.userId

      // Log audit event
      await logAuditEvent({
        userId: userId,
        action: AuditActions.REPORT_ASSIGNED,
        resourceType: ResourceTypes.ASSIGNMENT,
        resourceId: assignment.id,
        details: { 
          reportId: id, 
          assigneeId: parsed.data.assigneeId,
          organizationId: parsed.data.organizationId,
        },
      })

      // Get report title for notification
      const reportWithTitle = await prisma.report.findUnique({
        where: { id },
        select: { title: true },
      })

      // Update report status to 'assigned' if it's still 'new' or 'triaged'
      if (report.status === 'new' || report.status === 'triaged') {
        await prisma.$transaction([
          prisma.report.update({
            where: { id },
            data: { status: 'assigned' },
          }),
          prisma.reportStatusHistory.create({
            data: {
              reportId: id,
              fromStatus: report.status,
              toStatus: 'assigned',
              note: `Report assigned${assignment.assignee ? ` to ${assignment.assignee.fullName || assignment.assignee.email}` : ''}${assignment.organization ? ` to ${assignment.organization.name}` : ''}`,
            },
          }),
        ])
      }

      // Notify assigned officer about assignment
      if (assignment.assigneeId) {
        try {
          await notifyUsers(
            [assignment.assigneeId],
            'report_assigned',
            'Report Assigned to You',
            `Report "${reportWithTitle?.title || 'Untitled'}" has been assigned to you`,
            {
              reportId: id,
              reportTitle: reportWithTitle?.title,
              assigneeId: assignment.assigneeId,
              organizationId: assignment.organizationId || undefined,
            }
          )

          // Send push notification
          await sendPushNotificationsToUsers(
            [assignment.assigneeId],
            'Report Assigned to You',
            `"${reportWithTitle?.title || 'Untitled'}"`,
            { reportId: id, type: 'report_assigned' }
          )

          // Broadcast via SSE
          broadcastNotificationToUser(assignment.assigneeId, {
            type: 'report_assigned',
            title: 'Report Assigned to You',
            body: `Report "${reportWithTitle?.title || 'Untitled'}" has been assigned to you`,
            data: {
              reportId: id,
              reportTitle: reportWithTitle?.title,
              assigneeId: assignment.assigneeId,
            },
          })
        } catch (notifError) {
          app.log.error(notifError, 'Failed to send notification for assignment')
        }
      }

      return reply.code(201).send({
        id: assignment.id,
        reportId: assignment.reportId,
        assignee: assignment.assignee,
        organization: assignment.organization,
        dueAt: assignment.dueAt?.toISOString(),
        createdAt: assignment.createdAt.toISOString(),
      })
    } catch (error) {
      app.log.error(error, 'Failed to assign report')
      throw new ApiError(500, 'Failed to assign report', 'ASSIGN_FAILED')
    }
  })

  // Add comment to report
  app.post('/admin/reports/:id/comments', async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
    const { id } = req.params
    if (!z.string().uuid().safeParse(id).success) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_ID',
          message: 'Invalid report ID format',
          requestId: req.id,
        },
      })
    }

    const parsed = addCommentSchema.extend({ reportId: z.string().uuid() }).omit({ reportId: true }).safeParse(req.body)
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
      // Verify report exists
      const report = await prisma.report.findUnique({
        where: { id },
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

      // Get report details for notification
      const reportForComment = await prisma.report.findUnique({
        where: { id },
        select: { title: true },
      })

      const comment = await prisma.reportComment.create({
        data: {
          reportId: id,
          body: parsed.data.body,
          authorId: parsed.data.authorId,
        },
        include: {
          author: {
            select: { id: true, email: true, fullName: true },
          },
        },
      })

      // Log audit event
      await logAuditEvent({
        userId: parsed.data.authorId || undefined,
        action: AuditActions.REPORT_COMMENT_ADDED,
        resourceType: ResourceTypes.COMMENT,
        resourceId: comment.id,
        details: { reportId: id },
      })

      // Notify reporter and assigned officer about comment
      try {
        const recipients = await getReportNotificationRecipients(id)
        // Don't notify the comment author
        const filteredRecipients = recipients.filter((userId) => userId !== parsed.data.authorId)
        
        if (filteredRecipients.length > 0) {
          await notifyUsers(
            filteredRecipients,
            'report_commented',
            'New Comment on Report',
            `${comment.author?.fullName || comment.author?.email || 'Someone'} commented on "${reportForComment?.title || 'Untitled'}"`,
            {
              reportId: id,
              reportTitle: reportForComment?.title,
              commentId: comment.id,
            }
          )

          // Send push notifications
          await sendPushNotificationsToUsers(
            filteredRecipients,
            'New Comment on Report',
            `${comment.author?.fullName || 'Someone'} commented on "${reportForComment?.title || 'Untitled'}"`,
            { reportId: id, type: 'report_commented', commentId: comment.id }
          )

          // Broadcast via SSE
          filteredRecipients.forEach((userId) => {
            broadcastNotificationToUser(userId, {
              type: 'report_commented',
              title: 'New Comment on Report',
              body: `${comment.author?.fullName || 'Someone'} commented on "${reportForComment?.title || 'Untitled'}"`,
              data: {
                reportId: id,
                reportTitle: reportForComment?.title,
                commentId: comment.id,
              },
            })
          })
        }
      } catch (notifError) {
        app.log.error(notifError, 'Failed to send notification for comment')
      }

      return reply.code(201).send({
        id: comment.id,
        body: comment.body,
        author: comment.author,
        createdAt: comment.createdAt.toISOString(),
      })
    } catch (error) {
      app.log.error(error, 'Failed to add comment')
      throw new ApiError(500, 'Failed to add comment', 'COMMENT_FAILED')
    }
  })

  // Update report status (with user tracking)
  app.patch('/admin/reports/:id/status', async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply) => {
    const { id } = req.params
    if (!z.string().uuid().safeParse(id).success) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_ID',
          message: 'Invalid report ID format',
          requestId: req.id,
        },
      })
    }

    const parsed = updateReportStatusSchema.extend({
      changedBy: z.string().uuid().optional(),
    }).safeParse(req.body)
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
      const current = await prisma.report.findUnique({
        where: { id },
        select: { status: true },
      })

      if (!current) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Report not found',
            requestId: req.id,
          },
        })
      }

      const [report] = await prisma.$transaction([
        prisma.report.update({
          where: { id },
          data: { status: parsed.data.status },
          select: {
            id: true,
            title: true,
            status: true,
            updatedAt: true,
          },
        }),
        prisma.reportStatusHistory.create({
          data: {
            reportId: id,
            fromStatus: current.status,
            toStatus: parsed.data.status,
            note: parsed.data.note || `Status changed to ${parsed.data.status}`,
            changedBy: parsed.data.changedBy,
          },
        }),
      ])

      // Notify reporter and assigned officer about status change
      try {
        const recipients = await getReportNotificationRecipients(id)
        
        if (recipients.length > 0) {
          await notifyUsers(
            recipients,
            'report_status_changed',
            'Report Status Updated',
            `Report "${report.title}" status changed to ${parsed.data.status}`,
            {
              reportId: id,
              reportTitle: report.title,
              status: parsed.data.status,
            }
          )

          // Send push notifications
          await sendPushNotificationsToUsers(
            recipients,
            'Report Status Updated',
            `"${report.title}" is now ${parsed.data.status}`,
            { reportId: id, type: 'report_status_changed', status: parsed.data.status }
          )

          // Broadcast via SSE
          recipients.forEach((userId) => {
            broadcastNotificationToUser(userId, {
              type: 'report_status_changed',
              title: 'Report Status Updated',
              body: `Report "${report.title}" status changed to ${parsed.data.status}`,
              data: { reportId: id, reportTitle: report.title, status: parsed.data.status },
            })
          })
        }
      } catch (notifError) {
        app.log.error(notifError, 'Failed to send notifications for status change')
        // Don't fail the request if notifications fail
      }

      return reply.send({
        id: report.id,
        title: report.title,
        status: report.status,
        updatedAt: report.updatedAt.toISOString(),
      })
    } catch (error) {
      app.log.error(error, 'Failed to update report status')
      throw new ApiError(500, 'Failed to update report status', 'UPDATE_FAILED')
    }
  })

  // Get organizations list
  app.get('/admin/organizations', async (req: FastifyRequest, reply) => {
    try {
      const organizations = await prisma.organization.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          contactEmail: true,
          contactPhone: true,
        },
      })

      return reply.send({ data: organizations })
    } catch (error) {
      app.log.error(error, 'Failed to fetch organizations')
      throw new ApiError(500, 'Failed to fetch organizations', 'FETCH_FAILED')
    }
  })

  // Get officers/users list
  app.get('/admin/users', async (req: FastifyRequest, reply) => {
    try {
      const role = (req.query as any).role as string | undefined
      app.log.info({ role }, 'Fetching users with role:')
      const where = role ? { role } : {}

      const users = await prisma.userAccount.findMany({
        where,
        orderBy: { fullName: 'asc' },
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
        },
      })

      app.log.info({ count: users.length, filter: where }, `Found ${users.length} users with role filter:`)
      app.log.info({ users: users.map(u => ({ id: u.id, email: u.email, role: u.role })) }, 'Users:')

      return reply.send({ data: users })
    } catch (error) {
      app.log.error(error, 'Failed to fetch users')
      throw new ApiError(500, 'Failed to fetch users', 'FETCH_FAILED')
    }
  })

  // Create user/officer
  app.post('/admin/users', async (req: FastifyRequest, reply) => {
    app.log.info({ body: req.body }, 'Creating user with data:')
    
    const parsed = createUserSchema.safeParse(req.body)
    if (!parsed.success) {
      app.log.warn({ error: parsed.error.flatten() }, 'Validation failed:')
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
      // Check if user with email already exists
      const existing = await prisma.userAccount.findUnique({
        where: { email: parsed.data.email },
      })

      if (existing) {
        return reply.code(409).send({
          error: {
            code: 'DUPLICATE_EMAIL',
            message: 'User with this email already exists',
            requestId: req.id,
          },
        })
      }

      // Hash password
      const passwordHash = await hashPassword(parsed.data.password)

      // Prepare data - convert empty strings to null
      const userData: {
        email: string
        passwordHash: string
        fullName: string | null
        phone: string | null
        role: string
      } = {
        email: parsed.data.email,
        passwordHash,
        fullName: (parsed.data.fullName && parsed.data.fullName.trim().length > 0) ? parsed.data.fullName.trim() : null,
        phone: (parsed.data.phone && parsed.data.phone.trim().length > 0) ? parsed.data.phone.trim() : null,
        role: parsed.data.role || 'officer',
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
        },
      })

      app.log.info({ userId: user.id }, 'User created successfully:')

      // Log audit event
      const adminUserId = (req.user as any)?.userId
      await logAuditEvent({
        userId: adminUserId,
        action: AuditActions.USER_CREATED,
        resourceType: ResourceTypes.USER,
        resourceId: user.id,
        details: { email: user.email, role: user.role },
      })

      return reply.code(201).send({ data: user })
    } catch (error: any) {
      app.log.error({ error, stack: error.stack }, 'Failed to create user')
      if (error.code === 'P2002') {
        // Prisma unique constraint violation
        return reply.code(409).send({
          error: {
            code: 'DUPLICATE_EMAIL',
            message: 'User with this email already exists',
            requestId: req.id,
          },
        })
      }
      throw new ApiError(500, `Failed to create user: ${error.message}`, 'CREATE_FAILED')
    }
  })

  // Update user password
  app.put('/admin/users/:userId/password', { preHandler: authenticateUser }, async (req: FastifyRequest, reply) => {
    const parsed = updatePasswordSchema.safeParse(req.body)
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
      const { userId } = req.params as { userId: string }

      // Check authentication
      if (!req.user) {
        return reply.code(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
            requestId: req.id,
          },
        })
      }

      // Authorization: Users can only change their own password, unless they're an admin
      const currentUser = req.user as any
      if (currentUser.userId !== userId && currentUser.role !== 'admin') {
        return reply.code(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'You can only change your own password',
            requestId: req.id,
          },
        })
      }

      // Check if user exists
      const userToUpdate = await prisma.userAccount.findUnique({
        where: { id: userId },
      })

      if (!userToUpdate) {
        return reply.code(404).send({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
            requestId: req.id,
          },
        })
      }

      // Hash new password
      const passwordHash = await hashPassword(parsed.data.password)

      // Update password
      await prisma.userAccount.update({
        where: { id: userId },
        data: { passwordHash },
      })

      app.log.info({ userId }, 'Password updated successfully for user:')
      return reply.code(200).send({
        message: 'Password updated successfully',
      })
    } catch (error: any) {
      app.log.error({ error, stack: error.stack }, 'Failed to update password')
      throw new ApiError(500, `Failed to update password: ${error.message}`, 'UPDATE_FAILED')
    }
  })

  // Auto-assign reports to available officers
  app.post('/admin/reports/auto-assign', { preHandler: authenticateUser }, async (req: FastifyRequest, reply) => {
    try {
      // Check authentication (should be handled by middleware, but double-check)
      if (!req.user) {
        app.log.warn('Auto-assign: No user in request')
        return reply.code(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
            requestId: req.id,
          },
        })
      }

      const currentUser = req.user as any
      app.log.info({ userId: currentUser?.userId, role: currentUser?.role }, 'Auto-assign request received')

      // Check if user is admin
      if (currentUser.role !== 'admin') {
        app.log.warn({ userId: currentUser.userId, role: currentUser.role }, 'Auto-assign: User is not admin')
        return reply.code(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'Only administrators can auto-assign reports',
            requestId: req.id,
          },
        })
      }

      // Get all officers
      const officers = await prisma.userAccount.findMany({
        where: { role: 'officer' },
        select: { id: true, email: true, fullName: true },
      })

      if (officers.length === 0) {
        return reply.code(200).send({
          message: 'No officers available for assignment. Please create officers first.',
          assigned: 0,
          data: [],
        })
      }

      // Get all unassigned reports (new or triaged status)
      const unassignedReports = await prisma.report.findMany({
        where: {
          status: { in: ['new', 'triaged'] },
          assignments: { none: {} }, // No assignments exist
        },
        select: { id: true, title: true, status: true },
        orderBy: { createdAt: 'asc' }, // Oldest first
      })

      if (unassignedReports.length === 0) {
        return reply.send({
          message: 'No unassigned reports to assign',
          assigned: 0,
          data: [],
        })
      }

      // Get current assignments to find officers with existing assignments
      const currentAssignments = await prisma.reportAssignment.findMany({
        where: {
          assigneeId: { in: officers.map(o => o.id) },
          report: {
            status: { notIn: ['resolved', 'rejected'] },
          },
        },
        select: { assigneeId: true },
      })

      // Count assignments per officer
      const assignmentCounts = new Map<string, number>()
      officers.forEach(officer => {
        assignmentCounts.set(officer.id, 0)
      })
      currentAssignments.forEach(assignment => {
        if (assignment.assigneeId) {
          assignmentCounts.set(
            assignment.assigneeId,
            (assignmentCounts.get(assignment.assigneeId) || 0) + 1
          )
        }
      })

      // Sort officers by assignment count (least assigned first)
      const availableOfficers = [...officers].sort((a, b) => {
        const countA = assignmentCounts.get(a.id) || 0
        const countB = assignmentCounts.get(b.id) || 0
        return countA - countB
      })

      // Assign reports to officers in round-robin fashion
      const assignments = []
      for (let i = 0; i < unassignedReports.length; i++) {
        const report = unassignedReports[i]
        const officer = availableOfficers[i % availableOfficers.length]

        try {
          // Create assignment
          const assignment = await prisma.reportAssignment.create({
            data: {
              reportId: report.id,
              assigneeId: officer.id,
            },
            include: {
              assignee: {
                select: { id: true, email: true, fullName: true },
              },
            },
          })

          // Update report status to 'assigned' if it's still 'new' or 'triaged'
          await prisma.$transaction([
            prisma.report.update({
              where: { id: report.id },
              data: { status: 'assigned' },
            }),
            prisma.reportStatusHistory.create({
              data: {
                reportId: report.id,
                fromStatus: report.status,
                toStatus: 'assigned',
                note: `Auto-assigned to ${officer.fullName || officer.email}`,
              },
            }),
          ])

          assignments.push({
            reportId: assignment.reportId,
            assignee: assignment.assignee,
          })
        } catch (error) {
          app.log.error({ error, reportId: report.id, officerId: officer.id }, 'Failed to assign report')
          // Continue with next report
        }
      }

      app.log.info(`Auto-assigned ${assignments.length} reports to ${availableOfficers.length} officers`)

      return reply.code(200).send({
        message: `Successfully assigned ${assignments.length} reports`,
        assigned: assignments.length,
        data: assignments,
      })
    } catch (error: any) {
      app.log.error({ error, stack: error?.stack, message: error?.message }, 'Failed to auto-assign reports')
      
      // If it's already an ApiError, re-throw it
      if (error instanceof ApiError) {
        throw error
      }
      
      // If it's a known error with status code, preserve it
      if (error?.statusCode) {
        throw new ApiError(error.statusCode, error.message || 'Failed to auto-assign reports', 'AUTO_ASSIGN_FAILED', error)
      }
      
      // Otherwise, throw generic error
      throw new ApiError(500, error?.message || 'Failed to auto-assign reports', 'AUTO_ASSIGN_FAILED', error)
    }
  })

  // Get officer metrics (cases and success rate)
  app.get('/admin/officers/metrics', async (req: FastifyRequest, reply) => {
    try {
      // Get all officers
      const officers = await prisma.userAccount.findMany({
        where: { role: 'officer' },
        select: {
          id: true,
          email: true,
          fullName: true,
        },
        orderBy: { fullName: 'asc' },
      })

      // Get metrics for each officer
      const officerMetrics = await Promise.all(
        officers.map(async (officer) => {
          // Get all reports assigned to this officer (current assignments)
          const assignments = await prisma.reportAssignment.findMany({
            where: {
              assigneeId: officer.id,
            },
            include: {
              report: {
                select: {
                  id: true,
                  status: true,
                },
              },
            },
          })

          // Count total cases (unique reports assigned to this officer)
          const uniqueReportIds = new Set(assignments.map(a => a.reportId))
          const totalCases = uniqueReportIds.size

          // Count resolved cases (unique reports that are resolved)
          const resolvedReportIds = new Set(
            assignments
              .filter(a => a.report.status === 'resolved')
              .map(a => a.reportId)
          )
          const resolvedCases = resolvedReportIds.size

          // Calculate success rate (resolved / total, as percentage)
          const successRate = totalCases > 0 
            ? Math.round((resolvedCases / totalCases) * 100) 
            : 0

          return {
            officerId: officer.id,
            officerName: officer.fullName || officer.email,
            officerEmail: officer.email,
            totalCases,
            resolvedCases,
            successRate,
          }
        })
      )

      // Sort by total cases (descending) then by success rate (descending)
      officerMetrics.sort((a, b) => {
        if (b.totalCases !== a.totalCases) {
          return b.totalCases - a.totalCases
        }
        return b.successRate - a.successRate
      })

      return reply.send({
        data: officerMetrics,
      })
    } catch (error) {
      app.log.error(error, 'Failed to fetch officer metrics')
      throw new ApiError(500, 'Failed to fetch officer metrics', 'FETCH_METRICS_FAILED')
    }
  })
}

