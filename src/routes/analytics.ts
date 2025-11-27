import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { ApiError } from '../utils/errors.js'
import { authenticateUser, requireRole } from '../utils/authMiddleware.js'
import { zodToJsonSchemaFastify } from '../utils/swagger.js'

const heatmapQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  gridSize: z.coerce.number().min(0.001).max(1).optional().default(0.01), // ~1km grid
})

const exportQuerySchema = z.object({
  format: z.enum(['csv', 'pdf']).default('csv'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  severity: z.string().optional(),
})

export async function analyticsRoutes(app: FastifyInstance) {
  // Get heatmap data
  app.get(
    '/analytics/heatmap',
    {
      preHandler: [authenticateUser, requireRole('admin', 'officer')],
      schema: {
        description: 'Get heatmap data for reports',
        tags: ['analytics'],
        querystring: zodToJsonSchemaFastify(heatmapQuerySchema),
      },
    },
    async (req: FastifyRequest<{ Querystring: z.infer<typeof heatmapQuerySchema> }>, reply) => {
      const parsed = heatmapQuerySchema.safeParse(req.query)
      if (!parsed.success) {
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
        const { startDate, endDate, type, status, gridSize } = parsed.data

        // Build where clause
        const where: any = {}
        if (startDate || endDate) {
          where.createdAt = {}
          if (startDate) where.createdAt.gte = new Date(startDate)
          if (endDate) where.createdAt.lte = new Date(endDate)
        }
        if (type) where.type = type
        if (status) where.status = status

        // Get all reports with location data
        const reports = await prisma.report.findMany({
          where: {
            ...where,
            latitude: { not: null },
            longitude: { not: null },
          },
          select: {
            id: true,
            latitude: true,
            longitude: true,
            type: true,
            status: true,
            severity: true,
          },
        })

        // Create grid and aggregate
        const grid = new Map<string, { count: number; lat: number; lng: number; reports: string[] }>()

        reports.forEach((report) => {
          if (!report.latitude || !report.longitude) return

          // Round to grid
          const gridLat = Math.round(Number(report.latitude) / gridSize) * gridSize
          const gridLng = Math.round(Number(report.longitude) / gridSize) * gridSize
          const key = `${gridLat},${gridLng}`

          if (!grid.has(key)) {
            grid.set(key, { count: 0, lat: gridLat, lng: gridLng, reports: [] })
          }

          const cell = grid.get(key)!
          cell.count++
          cell.reports.push(report.id)
        })

        // Convert to array format for frontend
        const heatmapData = Array.from(grid.values()).map((cell) => ({
          lat: cell.lat,
          lng: cell.lng,
          count: cell.count,
          intensity: Math.min(cell.count / 10, 1), // Normalize intensity 0-1
        }))

        app.log.info(`Heatmap: Found ${reports.length} reports, generated ${heatmapData.length} heatmap points`)
        return reply.send({
          data: heatmapData,
          total: reports.length,
          gridSize,
        })
      } catch (error) {
        app.log.error({ err: error }, 'Heatmap error')
        throw new ApiError(500, 'Failed to generate heatmap data', 'HEATMAP_ERROR')
      }
    }
  )

  // Get trend analysis data
  app.get(
    '/analytics/trends',
    {
      preHandler: [authenticateUser, requireRole('admin', 'officer')],
      schema: {
        description: 'Get trend analysis data',
        tags: ['analytics'],
        querystring: zodToJsonSchemaFastify(
          z.object({
            period: z.enum(['3months', '6months', '12months', 'custom']).default('12months'),
            startDate: z.string().optional(),
            endDate: z.string().optional(),
          })
        ),
      },
    },
    async (req: FastifyRequest, reply) => {
      try {
        const { period, startDate, endDate } = req.query as any

        // Calculate date range
        let fromDate: Date
        const toDate = endDate ? new Date(endDate) : new Date()

        switch (period) {
          case '3months':
            fromDate = new Date()
            fromDate.setMonth(fromDate.getMonth() - 3)
            break
          case '6months':
            fromDate = new Date()
            fromDate.setMonth(fromDate.getMonth() - 6)
            break
          case '12months':
            fromDate = new Date()
            fromDate.setMonth(fromDate.getMonth() - 12)
            break
          case 'custom':
            fromDate = startDate ? new Date(startDate) : new Date()
            fromDate.setMonth(fromDate.getMonth() - 12)
            break
          default:
            fromDate = new Date()
            fromDate.setMonth(fromDate.getMonth() - 12)
        }

        // Get reports in date range
        const reports = await prisma.report.findMany({
          where: {
            createdAt: {
              gte: fromDate,
              lte: toDate,
            },
          },
          select: {
            id: true,
            type: true,
            status: true,
            severity: true,
            createdAt: true,
            updatedAt: true,
            assignments: {
              select: {
                createdAt: true,
              },
              orderBy: {
                createdAt: 'desc',
              },
              take: 1, // Get most recent assignment
            },
          },
        })

        // Category distribution over time
        const categoryTrends = new Map<string, Map<string, number>>()
        const statusTrends = new Map<string, Map<string, number>>()
        const resolutionTimes: { month: string; avgHours: number }[] = []

        // Group by month
        const monthGroups = new Map<string, typeof reports>()

        reports.forEach((report) => {
          const monthKey = formatMonthKey(report.createdAt)
          if (!monthGroups.has(monthKey)) {
            monthGroups.set(monthKey, [])
          }
          monthGroups.get(monthKey)!.push(report)
        })

        // Process each month
        Array.from(monthGroups.entries())
          .sort()
          .forEach(([monthKey, monthReports]) => {
            // Category trends
            monthReports.forEach((report) => {
              if (!categoryTrends.has(report.type)) {
                categoryTrends.set(report.type, new Map())
              }
              const typeMap = categoryTrends.get(report.type)!
              typeMap.set(monthKey, (typeMap.get(monthKey) || 0) + 1)
            })

            // Status trends
            monthReports.forEach((report) => {
              if (!statusTrends.has(report.status)) {
                statusTrends.set(report.status, new Map())
              }
              const statusMap = statusTrends.get(report.status)!
              statusMap.set(monthKey, (statusMap.get(monthKey) || 0) + 1)
            })

            // Resolution time trends
            const resolved = monthReports.filter(
              (r) => r.status === 'resolved' && r.assignments.length > 0 && r.assignments[0]?.createdAt && r.updatedAt
            )
            if (resolved.length > 0) {
              const totalHours = resolved.reduce((sum, r) => {
                const assignment = r.assignments[0] // Most recent assignment
                if (!assignment?.createdAt) return sum
                const assigned = new Date(assignment.createdAt).getTime()
                const resolvedDate = new Date(r.updatedAt).getTime()
                return sum + (resolvedDate - assigned) / (1000 * 60 * 60)
              }, 0)
              resolutionTimes.push({
                month: monthKey,
                avgHours: totalHours / resolved.length,
              })
            }
          })

        // Format category trends
        const categoryTrendsData = Array.from(categoryTrends.entries()).map(([type, months]) => ({
          type,
          data: Array.from(months.entries())
            .map(([month, count]) => ({ month, count }))
            .sort((a, b) => a.month.localeCompare(b.month)),
        }))

        // Format status trends
        const statusTrendsData = Array.from(statusTrends.entries()).map(([status, months]) => ({
          status,
          data: Array.from(months.entries())
            .map(([month, count]) => ({ month, count }))
            .sort((a, b) => a.month.localeCompare(b.month)),
        }))

        app.log.info(`Trends: Processed ${reports.length} reports, ${categoryTrendsData.length} categories, ${statusTrendsData.length} statuses`)
        return reply.send({
          categoryTrends: categoryTrendsData,
          statusTrends: statusTrendsData,
          resolutionTimeTrends: resolutionTimes,
        })
      } catch (error) {
        app.log.error({ err: error }, 'Trends error')
        throw new ApiError(500, 'Failed to generate trend data', 'TRENDS_ERROR')
      }
    }
  )

  // Get geographic distribution
  app.get(
    '/analytics/geographic',
    {
      preHandler: [authenticateUser, requireRole('admin', 'officer')],
      schema: {
        description: 'Get geographic distribution data',
        tags: ['analytics'],
      },
    },
    async (req: FastifyRequest, reply) => {
      try {
        const reports = await prisma.report.findMany({
          select: {
            id: true,
            province: true,
            district: true,
            sector: true,
            status: true,
            type: true,
          },
        })

        // Province breakdown
        const provinceMap = new Map<string, number>()
        reports.forEach((r) => {
          if (r.province) {
            provinceMap.set(r.province, (provinceMap.get(r.province) || 0) + 1)
          }
        })

        // District breakdown
        const districtMap = new Map<string, { count: number; province: string }>()
        reports.forEach((r) => {
          if (r.district) {
            const key = r.district
            if (!districtMap.has(key)) {
              districtMap.set(key, { count: 0, province: r.province || 'Unknown' })
            }
            districtMap.get(key)!.count++
          }
        })

        // Sector breakdown
        const sectorMap = new Map<string, { count: number; district: string; province: string }>()
        reports.forEach((r) => {
          if (r.sector) {
            const key = r.sector
            if (!sectorMap.has(key)) {
              sectorMap.set(key, {
                count: 0,
                district: r.district || 'Unknown',
                province: r.province || 'Unknown',
              })
            }
            sectorMap.get(key)!.count++
          }
        })

        const result = {
          provinces: Array.from(provinceMap.entries()).map(([name, count]) => ({ name, count })),
          districts: Array.from(districtMap.entries()).map(([name, data]) => ({
            name,
            count: data.count,
            province: data.province,
          })),
          sectors: Array.from(sectorMap.entries()).map(([name, data]) => ({
            name,
            count: data.count,
            district: data.district,
            province: data.province,
          })),
        }
        app.log.info(`Geographic: ${result.provinces.length} provinces, ${result.districts.length} districts, ${result.sectors.length} sectors`)
        return reply.send(result)
      } catch (error) {
        app.log.error({ err: error }, 'Geographic error')
        throw new ApiError(500, 'Failed to generate geographic data', 'GEOGRAPHIC_ERROR')
      }
    }
  )

  // Export reports (CSV)
  app.get(
    '/analytics/export/csv',
    {
      preHandler: [authenticateUser, requireRole('admin')],
      schema: {
        description: 'Export reports to CSV',
        tags: ['analytics'],
        querystring: zodToJsonSchemaFastify(exportQuerySchema),
      },
    },
    async (req: FastifyRequest, reply) => {
      const parsed = exportQuerySchema.safeParse(req.query)
      if (!parsed.success) {
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
        const { startDate, endDate, status, type, severity } = parsed.data

        const where: any = {}
        if (startDate || endDate) {
          where.createdAt = {}
          if (startDate) where.createdAt.gte = new Date(startDate)
          if (endDate) where.createdAt.lte = new Date(endDate)
        }
        if (status) where.status = status
        if (type) where.type = type
        if (severity) where.severity = severity

        const reports = await prisma.report.findMany({
          where,
          include: {
            reporter: {
              select: { email: true, fullName: true },
            },
            assignments: {
              include: {
                assignee: {
                  select: { email: true, fullName: true },
                },
                organization: {
                  select: { name: true },
                },
              },
              orderBy: {
                createdAt: 'desc',
              },
              take: 1, // Get most recent assignment
            },
          },
          orderBy: { createdAt: 'desc' },
        })

        // Generate CSV
        const headers = [
          'ID',
          'Title',
          'Type',
          'Severity',
          'Status',
          'Province',
          'District',
          'Sector',
          'Address',
          'Latitude',
          'Longitude',
          'Reporter',
          'Reporter Email',
          'Assigned To',
          'Organization',
          'Created At',
          'Updated At',
        ]

        const rows = reports.map((report) => [
          report.id,
          escapeCsv(report.title),
          report.type,
          report.severity,
          report.status,
          report.province || '',
          report.district || '',
          report.sector || '',
          escapeCsv(report.addressText || ''),
          report.latitude?.toString() || '',
          report.longitude?.toString() || '',
          escapeCsv(report.reporter?.fullName || ''),
          report.reporter?.email || '',
          escapeCsv(report.assignments[0]?.assignee?.fullName || ''),
          escapeCsv(report.assignments[0]?.organization?.name || ''),
          report.createdAt.toISOString(),
          report.updatedAt.toISOString(),
        ])

        const csvContent = [
          headers.join(','),
          ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
        ].join('\n')

        reply.header('Content-Type', 'text/csv; charset=utf-8')
        reply.header(
          'Content-Disposition',
          `attachment; filename="reports_${new Date().toISOString().split('T')[0]}.csv"`
        )
        return reply.send(csvContent)
      } catch (error) {
        app.log.error({ err: error }, 'CSV export error')
        throw new ApiError(500, 'Failed to export CSV', 'EXPORT_ERROR')
      }
    }
  )

  // Export reports (PDF) - placeholder for now
  app.get(
    '/analytics/export/pdf',
    {
      preHandler: [authenticateUser, requireRole('admin')],
      schema: {
        description: 'Export reports summary to PDF',
        tags: ['analytics'],
        querystring: zodToJsonSchemaFastify(exportQuerySchema),
      },
    },
    async (req: FastifyRequest, reply) => {
      // PDF generation will be implemented with a library like pdfkit or puppeteer
      // For now, return a placeholder response
      return reply.code(501).send({
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'PDF export is not yet implemented',
          requestId: req.id,
        },
      })
    }
  )
}

// Helper function to format month key
function formatMonthKey(date: Date): string {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

// Helper function to escape CSV values
function escapeCsv(value: string): string {
  return value.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '')
}

