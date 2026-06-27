import { z } from 'zod'

const userStatusEnum = z.enum(['active', 'inactive', 'disabled'])

export const createUserSchema = z.object({
  username: z.string().min(2, 'Username must be at least 2 characters').max(50),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  displayName: z.string().min(1, 'Display name is required').max(50),
  roles: z.array(z.string()).default([]),  // 角色ID数组
  tenantId: z.string().optional(),
  deptId: z.string().nullable().optional(),
  email: z.string().email('Invalid email format').nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  avatar: z.string().max(500).optional(),
  status: userStatusEnum.optional(),
}).strict()

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  roles: z.array(z.string()).optional(),  // 角色ID数组
  tenantId: z.string().optional(),
  deptId: z.string().nullable().optional(),
  email: z.string().email('Invalid email format').nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  avatar: z.string().max(500).optional(),
  status: userStatusEnum.optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field is required.',
})

export const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
}).strict()
