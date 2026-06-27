import { z } from 'zod'

export const createPostSchema = z.object({
  postCode: z.string().min(1, '岗位编码不能为空').max(50, '岗位编码最多50个字符'),
  postName: z.string().min(1, '岗位名称不能为空').max(50, '岗位名称最多50个字符'),
  sort: z.number().int().min(0).default(0),
  status: z.enum(['active', 'inactive']).default('active'),
  remark: z.string().max(200, '备注最多200个字符').default(''),
}).strict()

export const updatePostSchema = z.object({
  postCode: z.string().min(1).max(50).optional(),
  postName: z.string().min(1).max(50).optional(),
  sort: z.number().int().min(0).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  remark: z.string().max(200).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field is required.',
})
