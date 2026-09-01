/**
 * router domain zod schemas. The state value is a read-only projection built
 * entirely inside this repo, so it uses structural passthrough with the one
 * `as unknown as z.ZodType` cast the other large-payload domains use; the
 * request schemas that gate the wire boundary stay strict.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

const mutationResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  models: z.array(z.string()).optional(),
}) as unknown as z.ZodType<Wire<ResponseValue<'router.activatePlatform'>>>

/** router.state request payload (empty object literal). */
export const routerStateRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'router.state'>>>

/** router.state response value (structural passthrough for the nested projections). */
export const routerStateValueSchema = z.object({
  enabled: z.boolean(),
  poolPolicy: z.string(),
  keepLocalFallback: z.boolean(),
  platforms: z.array(z.unknown()),
  candidates: z.array(z.unknown()),
  currentPick: z.unknown().nullable(),
}) as unknown as z.ZodType<Wire<ResponseValue<'router.state'>>>

/** router.activatePlatform request payload. */
export const routerActivatePlatformRequestSchema = z.object({
  platformId: z.string().min(1),
  keys: z.array(z.string()),
  endpoint: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'router.activatePlatform'>>>

/** router.deactivatePlatform request payload. */
export const routerDeactivatePlatformRequestSchema = z.object({
  platformId: z.string().min(1),
  forgetKeys: z.boolean().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'router.deactivatePlatform'>>>

/** router.setConfig request payload. */
export const routerSetConfigRequestSchema = z.object({
  enabled: z.boolean().optional(),
  poolPolicy: z.enum(['balanced', 'max-quality', 'max-stability']).optional(),
  keepLocalFallback: z.boolean().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'router.setConfig'>>>

/** router.testKey request payload. */
export const routerTestKeyRequestSchema = z.object({
  platformId: z.string().min(1),
  key: z.string(),
  endpoint: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'router.testKey'>>>

/** Shared mutation-result response value for the four mutating methods. */
export const routerActivatePlatformValueSchema = mutationResultSchema
export const routerDeactivatePlatformValueSchema = mutationResultSchema as unknown as z.ZodType<Wire<ResponseValue<'router.deactivatePlatform'>>>
export const routerSetConfigValueSchema = mutationResultSchema as unknown as z.ZodType<Wire<ResponseValue<'router.setConfig'>>>
export const routerTestKeyValueSchema = mutationResultSchema as unknown as z.ZodType<Wire<ResponseValue<'router.testKey'>>>
