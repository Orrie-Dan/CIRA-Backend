import { prisma } from '../prisma.js'
import type { Prisma } from '@prisma/client'

export type NotificationType = 
  | 'report_created'
  | 'report_status_changed'
  | 'report_commented'
  | 'report_assigned'

export interface NotificationData {
  reportId?: string
  reportTitle?: string
  status?: string
  commentId?: string
  assigneeId?: string
  organizationId?: string
  [key: string]: unknown
}

export interface CreateNotificationInput {
  userId: string
  type: NotificationType
  title: string
  body: string
  data?: NotificationData
}

/**
 * Create a single notification
 */
export async function createNotification(input: CreateNotificationInput) {
  return await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: (input.data || {}) as Prisma.InputJsonValue,
    },
  })
}

/**
 * Create notifications for multiple users
 */
export async function notifyUsers(
  userIds: string[],
  type: NotificationType,
  title: string,
  body: string,
  data?: NotificationData
) {
  if (userIds.length === 0) return []

  const notifications = userIds.map((userId) => ({
    userId,
    type,
    title,
    body,
    data: (data || {}) as Prisma.InputJsonValue,
  }))

  return await prisma.notification.createMany({
    data: notifications,
  })
}

/**
 * Get notifications for a user
 */
export async function getUserNotifications(
  userId: string,
  options?: {
    limit?: number
    offset?: number
    unreadOnly?: boolean
  }
) {
  const where: Prisma.NotificationWhereInput = {
    userId,
  }

  if (options?.unreadOnly) {
    where.read = false
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    }),
    prisma.notification.count({ where }),
  ])

  return {
    notifications,
    total,
  }
}

/**
 * Get unread count for a user
 */
export async function getUnreadCount(userId: string) {
  return await prisma.notification.count({
    where: {
      userId,
      read: false,
    },
  })
}

/**
 * Mark notification as read
 */
export async function markAsRead(notificationId: string, userId: string) {
  return await prisma.notification.updateMany({
    where: {
      id: notificationId,
      userId, // Ensure user owns the notification
    },
    data: {
      read: true,
    },
  })
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: string) {
  return await prisma.notification.updateMany({
    where: {
      userId,
      read: false,
    },
    data: {
      read: true,
    },
  })
}

/**
 * Get officers and admins who should be notified of new reports
 */
export async function getOfficersAndAdmins() {
  return await prisma.userAccount.findMany({
    where: {
      role: {
        in: ['officer', 'admin'],
      },
    },
    select: {
      id: true,
    },
  })
}

/**
 * Get users to notify for a report (reporter and assigned officer)
 */
export async function getReportNotificationRecipients(reportId: string) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      reporter: {
        select: { id: true },
      },
      assignments: {
        where: {
          // Get the most recent assignment
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          assignee: {
            select: { id: true },
          },
        },
      },
    },
  })

  const recipients: string[] = []

  if (report?.reporter?.id) {
    recipients.push(report.reporter.id)
  }

  if (report?.assignments[0]?.assignee?.id) {
    recipients.push(report.assignments[0].assignee.id)
  }

  return recipients.filter((id, index, self) => self.indexOf(id) === index) // Remove duplicates
}

