import { prisma } from '../prisma.js'

/**
 * Calculate priority score for a report
 * Formula: (confirmations * 10) + (severity_weight * 5) + (age_weight)
 * 
 * - Confirmations: Each confirmation adds 10 points
 * - Severity: low=5, medium=10, high=15 points
 * - Age: Reports older than 7 days get +5 points per week
 */
export async function calculatePriorityScore(reportId: string): Promise<number> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      severity: true,
      createdAt: true,
      confirmations: {
        select: { id: true },
      },
    },
  })

  if (!report) {
    return 0
  }

  // Count confirmations
  const confirmationCount = report.confirmations.length
  const confirmationScore = confirmationCount * 10

  // Severity weight
  const severityWeights: Record<string, number> = {
    low: 5,
    medium: 10,
    high: 15,
  }
  const severityScore = severityWeights[report.severity] || 5

  // Age weight (reports older than 7 days get bonus points)
  const now = new Date()
  const createdAt = new Date(report.createdAt)
  const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
  const ageScore = daysSinceCreation > 7 ? Math.floor((daysSinceCreation - 7) / 7) * 5 : 0

  // Total priority score
  const priorityScore = confirmationScore + (severityScore * 5) + ageScore

  return priorityScore
}

/**
 * Update priority score for a report
 * NOTE: Disabled - priority_score column has been removed from the database
 */
export async function updateReportPriorityScore(reportId: string): Promise<void> {
  // Priority score functionality has been removed
  // const score = await calculatePriorityScore(reportId)
  // 
  // await prisma.report.update({
  //   where: { id: reportId },
  //   data: { priorityScore: score },
  // })
}

/**
 * Update priority scores for all reports (batch operation)
 */
export async function updateAllReportPriorityScores(): Promise<void> {
  const reports = await prisma.report.findMany({
    select: { id: true },
  })

  for (const report of reports) {
    await updateReportPriorityScore(report.id)
  }
}





