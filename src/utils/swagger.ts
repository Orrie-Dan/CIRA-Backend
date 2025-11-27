import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ZodSchema } from 'zod'

/**
 * Converts a Zod schema to Fastify's JSON Schema format
 */
export function zodToJsonSchemaFastify(schema: ZodSchema): any {
  return zodToJsonSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
  })
}







