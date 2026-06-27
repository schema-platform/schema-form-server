import { z } from 'zod'

export const createSubmissionSchema = z.object({
  data: z.record(z.unknown()).refine((d) => Object.keys(d).length > 0, {
    message: 'Field "data" must be a non-empty object.',
  }),
  submitterId: z.string().uuid('Invalid UUID format').optional(),
}).strict()

export const updateSubmissionStatusSchema = z.object({
  status: z.enum(['submitted', 'approved', 'rejected']),
}).strict()

export const batchDeleteSubmissionsSchema = z.object({
  ids: z.array(z.string().uuid('Invalid UUID format')).min(1, 'At least one ID is required.'),
}).strict()

export const batchUpdateSubmissionsStatusSchema = z.object({
  ids: z.array(z.string().uuid('Invalid UUID format')).min(1, 'At least one ID is required.'),
  status: z.enum(['submitted', 'approved', 'rejected']),
}).strict()
