import { z } from 'zod'

export const createDictTypeSchema = z.object({
  name: z.string().min(1, '字典类型名称不能为空').max(50, '字典类型名称最多50个字符'),
  code: z.string().min(1, '字典类型编码不能为空').max(50, '字典类型编码最多50个字符')
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, '编码只能包含字母、数字和下划线，且以字母或下划线开头'),
  status: z.enum(['active', 'inactive']).optional(),
  remark: z.string().max(200, '备注最多200个字符').optional(),
}).strict()

export const updateDictTypeSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  code: z.string().min(1).max(50)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, '编码只能包含字母、数字和下划线，且以字母或下划线开头').optional(),
  status: z.enum(['active', 'inactive']).optional(),
  remark: z.string().max(200).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field is required.',
})

export const createDictDataSchema = z.object({
  dictTypeId: z.string().min(1, '字典类型ID不能为空'),
  label: z.string().min(1, '字典标签不能为空').max(100, '字典标签最多100个字符'),
  value: z.string().min(1, '字典值不能为空').max(100, '字典值最多100个字符'),
  sort: z.number().int().min(0).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  remark: z.string().max(200, '备注最多200个字符').optional(),
}).strict()

export const updateDictDataSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  value: z.string().min(1).max(100).optional(),
  sort: z.number().int().min(0).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  remark: z.string().max(200).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field is required.',
})
