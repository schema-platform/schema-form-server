/**
 * Widget Zod Schema — structured schema for LLM tool parameters.
 *
 * Replaces generic `z.array(z.record(z.unknown()))` with typed Widget
 * structure so DeepSeek receives clear schema guidance.
 */

import { z } from 'zod'

const WidgetPositionSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  w: z.number().positive(),
  h: z.number().positive(),
  zIndex: z.number().optional(),
}).passthrough()

// Recursive schema supporting children nesting
export const WidgetSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.object({
    id: z.string().describe('Widget unique ID, format: {type}_{5-char-random}'),
    type: z.string().describe('Component type identifier, e.g. input, select, fgCard'),
    field: z.string().optional().describe('Form field name, camelCase'),
    label: z.string().optional().describe('Display label'),
    props: z.record(z.unknown()).optional().describe('Component property config'),
    position: WidgetPositionSchema,
    children: z.array(WidgetSchema).optional().describe('Child components (container types only)'),
    events: z.array(z.record(z.unknown())).optional().describe('Event config'),
    linkages: z.array(z.record(z.unknown())).optional().describe('Linkage config'),
    variables: z.array(z.record(z.unknown())).optional().describe('Variable config'),
  }).passthrough()
)

export const WidgetsArraySchema = z.array(WidgetSchema).describe('Widget Schema array')
