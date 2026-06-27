import { z } from 'zod'

export const createConfigSchema = z.object({
  name: z.string().min(1, '参数名称不能为空').max(100, '参数名称最多100个字符'),
  key: z.string().min(1, '参数键名不能为空').max(100, '参数键名最多100个字符')
    .regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/, '键名只能包含字母、数字、下划线和点，且以字母或下划线开头'),
  value: z.string().max(500, '参数值最多500个字符').optional(),
  type: z.enum(['system', 'business']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  remark: z.string().max(200, '备注最多200个字符').optional(),
}).strict()

export const updateConfigSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  key: z.string().min(1).max(100)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/, '键名只能包含字母、数字、下划线和点，且以字母或下划线开头').optional(),
  value: z.string().max(500).optional(),
  type: z.enum(['system', 'business']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  remark: z.string().max(200).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field is required.',
})
