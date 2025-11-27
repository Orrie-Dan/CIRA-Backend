import { prisma } from '../prisma.js'
import type { Prisma } from '@prisma/client'

export interface AuditLogData {
  userId?: string
  action: string
  resourceType: string
  resourceId?: string
  details?: Record<string, unknown>
}

/**
 * Log an audit event
 */
export async function logAuditEvent(data: AuditLogData): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        details: (data.details || {}) as Prisma.InputJsonValue,
      },
    })
  } catch (error) {
    // Don't throw - audit logging should not break the main flow
    console.error('Failed to log audit event:', error)
  }
}

/**
 * Common audit actions
 */
export const AuditActions = {
  // User actions
  USER_REGISTERED: 'user_registered',
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  USER_PROFILE_UPDATED: 'user_profile_updated',
  USER_PASSWORD_CHANGED: 'user_password_changed',
  
  // Report actions
  REPORT_CREATED: 'report_created',
  REPORT_UPDATED: 'report_updated',
  REPORT_STATUS_CHANGED: 'report_status_changed',
  REPORT_ASSIGNED: 'report_assigned',
  REPORT_COMMENT_ADDED: 'report_comment_added',
  REPORT_CONFIRMED: 'report_confirmed',
  
  // Admin actions
  USER_CREATED: 'user_created',
  USER_DELETED: 'user_deleted',
  ORGANIZATION_CREATED: 'organization_created',
  ORGANIZATION_UPDATED: 'organization_updated',
  ORGANIZATION_DELETED: 'organization_deleted',
} as const

/**
 * Resource types
 */
export const ResourceTypes = {
  USER: 'user',
  REPORT: 'report',
  ORGANIZATION: 'organization',
  COMMENT: 'comment',
  ASSIGNMENT: 'assignment',
} as const

