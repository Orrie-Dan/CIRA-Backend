import { z } from 'zod'

export const createReportSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(5).max(5000),
  type: z.enum(['roads', 'bridges', 'water', 'power', 'sanitation', 'telecom', 'public_building', 'pothole', 'streetlight', 'sidewalk', 'drainage', 'other']),
  severity: z.enum(['low', 'medium', 'high']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  addressText: z.string().optional(),
  province: z.string().optional(),
  district: z.string().optional(),
  sector: z.string().optional(),
  reporterId: z.string().uuid().optional(),
})

export const updateReportStatusSchema = z.object({
  status: z.enum(['new', 'triaged', 'assigned', 'in_progress', 'resolved', 'rejected']),
  note: z.string().optional(),
})

export const listReportsQuerySchema = z.object({
  bbox: z.string().regex(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/).optional(),
  status: z.enum(['new', 'triaged', 'assigned', 'in_progress', 'resolved', 'rejected']).optional(),
  type: z.enum(['roads', 'bridges', 'water', 'power', 'sanitation', 'telecom', 'public_building', 'pothole', 'streetlight', 'sidewalk', 'drainage', 'other']).optional(),
  myReports: z.coerce.boolean().optional(), // Filter to current user's reports
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
})

export const assignReportSchema = z.object({
  reportId: z.string().uuid(),
  organizationId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  dueAt: z.string().datetime().optional(),
})

export const addCommentSchema = z.object({
  reportId: z.string().uuid(),
  body: z.string().min(1).max(2000),
  authorId: z.string().uuid().optional(),
})

export const adminListReportsQuerySchema = z.object({
  bbox: z.string().regex(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/).optional(),
  status: z.enum(['new', 'triaged', 'assigned', 'in_progress', 'resolved', 'rejected']).optional(),
  type: z.enum(['roads', 'bridges', 'water', 'power', 'sanitation', 'telecom', 'public_building', 'pothole', 'streetlight', 'sidewalk', 'drainage', 'other']).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(200), // Higher limit for admin endpoints
  offset: z.coerce.number().int().min(0).default(0),
  assigneeId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  severity: z.enum(['low', 'medium', 'high']).optional(),
})

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  fullName: z.string().max(200).optional(),
  phone: z.string().optional(),
  role: z.enum(['citizen', 'officer', 'admin']).default('officer'),
})

export const updatePasswordSchema = z.object({
  password: z.string().min(8).max(100),
})

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  fullName: z.string().max(200).optional(),
  phone: z.string().optional(),
})

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export type CreateReportInput = z.infer<typeof createReportSchema>
export type UpdateReportStatusInput = z.infer<typeof updateReportStatusSchema>
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>
export type AssignReportInput = z.infer<typeof assignReportSchema>
export type AddCommentInput = z.infer<typeof addCommentSchema>
export type AdminListReportsQuery = z.infer<typeof adminListReportsQuerySchema>
export type CreateUserInput = z.infer<typeof createUserSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
