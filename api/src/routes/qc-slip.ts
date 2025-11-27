import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { ApiError } from '../utils/errors.js'
import { authenticateUser, requireRole } from '../utils/authMiddleware.js'
import { logAuditEvent, AuditActions, ResourceTypes } from '../utils/auditLogger.js'
import { zodToJsonSchemaFastify } from '../utils/swagger.js'

const createQcSlipSchema = z.object({
  reportId: z.string().uuid(),
  workSummary: z.string().min(10).max(5000),
  photos: z.array(z.string().url()).optional().default([]),
})

const approveQcSlipSchema = z.object({
  approved: z.boolean(),
})

export async function qcSlipRoutes(app: FastifyInstance) {
  // Create QC slip (officers only)
  app.post(
    '/qc-slip',
    {
      preHandler: [authenticateUser, requireRole('officer', 'admin')],
      schema: {
        description: 'Create a QC slip for a resolved report',
        tags: ['qc-slip'],
        body: zodToJsonSchemaFastify(createQcSlipSchema),
      },
    },
    async (req: FastifyRequest, reply) => {
      const parsed = createQcSlipSchema.safeParse(req.body)
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
        const userId = (req.user as any).userId

        // Verify report exists and is resolved
        const report = await prisma.report.findUnique({
          where: { id: parsed.data.reportId },
          select: { id: true, status: true, title: true },
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

        if (report.status !== 'resolved') {
          return reply.code(400).send({
            error: {
              code: 'INVALID_STATUS',
              message: 'QC slip can only be created for resolved reports',
              requestId: req.id,
            },
          })
        }

        // Check if QC slip already exists
        const existing = await prisma.qcSlip.findUnique({
          where: { reportId: parsed.data.reportId },
        })

        if (existing) {
          return reply.code(409).send({
            error: {
              code: 'ALREADY_EXISTS',
              message: 'QC slip already exists for this report',
              requestId: req.id,
            },
          })
        }

        // Create QC slip
        const qcSlip = await prisma.qcSlip.create({
          data: {
            reportId: parsed.data.reportId,
            officerId: userId,
            workSummary: parsed.data.workSummary,
            photos: parsed.data.photos || [],
          },
          include: {
            officer: {
              select: { id: true, email: true, fullName: true },
            },
            report: {
              select: { id: true, title: true, reporterId: true },
            },
          },
        })

        // Log audit event
        await logAuditEvent({
          userId,
          action: AuditActions.REPORT_UPDATED,
          resourceType: ResourceTypes.REPORT,
          resourceId: parsed.data.reportId,
          details: { qcSlipCreated: true },
        })

        // TODO: Send notification to reporter about QC slip

        return reply.code(201).send({ qcSlip })
      } catch (error) {
        app.log.error({ err: error }, 'Create QC slip error')
        throw new ApiError(500, 'Failed to create QC slip', 'CREATE_FAILED')
      }
    }
  )

  // Get QC slip by report ID
  app.get(
    '/qc-slip/report/:reportId',
    {
      preHandler: authenticateUser,
      schema: {
        description: 'Get QC slip for a report',
        tags: ['qc-slip'],
      },
    },
    async (req: FastifyRequest<{ Params: { reportId: string } }>, reply) => {
      const { reportId } = req.params

      if (!z.string().uuid().safeParse(reportId).success) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_ID',
            message: 'Invalid report ID format',
            requestId: req.id,
          },
        })
      }

      try {
        const qcSlip = await prisma.qcSlip.findUnique({
          where: { reportId },
          include: {
            officer: {
              select: { id: true, email: true, fullName: true },
            },
            approver: {
              select: { id: true, email: true, fullName: true },
            },
            report: {
              select: { id: true, title: true, reporterId: true },
            },
          },
        })

        if (!qcSlip) {
          return reply.code(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'QC slip not found for this report',
              requestId: req.id,
            },
          })
        }

        return reply.send({ qcSlip })
      } catch (error) {
        app.log.error({ err: error }, 'Get QC slip error')
        throw new ApiError(500, 'Failed to get QC slip', 'FETCH_FAILED')
      }
    }
  )

  // Approve/reject QC slip (citizens - reporters only)
  app.post(
    '/qc-slip/:id/approve',
    {
      preHandler: authenticateUser,
      schema: {
        description: 'Approve or reject a QC slip',
        tags: ['qc-slip'],
        body: zodToJsonSchemaFastify(approveQcSlipSchema),
      },
    },
    async (req: FastifyRequest<{ Params: { id: string }; Body: { approved: boolean } }>, reply) => {
      const { id } = req.params
      const parsed = approveQcSlipSchema.safeParse(req.body)

      if (!z.string().uuid().safeParse(id).success) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_ID',
            message: 'Invalid QC slip ID format',
            requestId: req.id,
          },
        })
      }

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
        const userId = (req.user as any).userId

        // Get QC slip with report info
        const qcSlip = await prisma.qcSlip.findUnique({
          where: { id },
          include: {
            report: {
              select: { id: true, reporterId: true, title: true },
            },
          },
        })

        if (!qcSlip) {
          return reply.code(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'QC slip not found',
              requestId: req.id,
            },
          })
        }

        // Check if user is the reporter
        if (qcSlip.report.reporterId !== userId) {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'Only the reporter can approve/reject this QC slip',
              requestId: req.id,
            },
          })
        }

        // Check if already approved/rejected
        if (qcSlip.approved !== null && qcSlip.approvedBy !== null) {
          return reply.code(409).send({
            error: {
              code: 'ALREADY_APPROVED',
              message: 'This QC slip has already been reviewed',
              requestId: req.id,
            },
          })
        }

        // Update QC slip
        const updated = await prisma.qcSlip.update({
          where: { id },
          data: {
            approved: parsed.data.approved,
            approvedBy: userId,
            approvedAt: new Date(),
          },
          include: {
            officer: {
              select: { id: true, email: true, fullName: true },
            },
            approver: {
              select: { id: true, email: true, fullName: true },
            },
            report: {
              select: { id: true, title: true },
            },
          },
        })

        // Log audit event
        await logAuditEvent({
          userId,
          action: AuditActions.REPORT_UPDATED,
          resourceType: ResourceTypes.REPORT,
          resourceId: qcSlip.reportId,
          details: { qcSlipApproved: parsed.data.approved },
        })

        // TODO: Send notification to officer about approval/rejection

        return reply.send({ qcSlip: updated })
      } catch (error) {
        app.log.error({ err: error }, 'Approve QC slip error')
        throw new ApiError(500, 'Failed to approve QC slip', 'APPROVE_FAILED')
      }
    }
  )
}




