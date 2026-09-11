/**
 * harness domain zod schemas.
 *
 * The request schemas gate a wire boundary and stay strict — `generate` takes
 * free text from a browser and hands it to a model and then to a preset
 * writer, so its bounds are enforced here rather than trusted. The response
 * shapes are read-only projections produced entirely inside this repo, so they
 * use the same structural style as the other large-payload domains.
 *
 * The `harness.export` download has no wire envelope: it arrives as query
 * parameters, like `session.export`, so its schema parses the raw
 * query-parameter object.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** harness.templates request payload (empty object literal). */
export const harnessTemplatesRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'harness.templates'>>>

/**
 * harness.generate request. The prompt is bounded because it is forwarded to a
 * model: an unbounded field here is an unbounded token bill there.
 */
export const harnessGenerateRequestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  template: z.string().min(1).max(64).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'harness.generate'>>>

const toggleSchema = z.object({
  id: z.string(),
  label: z.string(),
  defaultOn: z.boolean(),
})

const templateEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  blurb: z.string(),
  phases: z.array(z.string()),
  toggles: z.array(toggleSchema),
})

/** harness.templates response value. */
export const harnessTemplatesValueSchema = z.object({
  templates: z.array(templateEntrySchema),
  available: z.boolean(),
}) as unknown as z.ZodType<Wire<ResponseValue<'harness.templates'>>>

const generatedHarnessSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  template: z.string(),
  persona: z.string(),
  skills: z.array(z.object({ name: z.string(), description: z.string() })),
  enabled: z.array(z.string()),
  dropped: z.array(z.string()),
})

/** harness.generate response value. */
export const harnessGenerateValueSchema = z.object({
  harness: generatedHarnessSchema,
}) as unknown as z.ZodType<Wire<ResponseValue<'harness.generate'>>>

/**
 * harness.export query params → the pack request. The id is held to the
 * roster's own preset-id shape here, at the boundary, so a traversal attempt
 * is a 400 rather than something the service has to defend against.
 */
export const harnessPackQuerySchema = z.object({
  agentPreset: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/u),
})
