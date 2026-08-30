/**
 * monitor domain zod schemas. The value shapes are large, deeply-nested,
 * read-only projections produced entirely inside this repo (no independent
 * client), so the leaf objects use `z.unknown()` / structural passthrough and
 * the whole value schema carries the one `as unknown as z.ZodType` cast the
 * other large-payload domains (goals, events) also use — the request schemas,
 * which gate a wire boundary, stay strict.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** monitor.snapshot request payload (empty object literal). */
export const monitorSnapshotRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'monitor.snapshot'>>>

const killResultSchema = z.object({
  pid: z.number().int(),
  ok: z.boolean(),
  error: z.string().optional(),
})

const guardStateSchema = z.object({
  armed: z.boolean(),
  armedAt: z.number().nullable(),
  events: z.array(z.object({
    time: z.number(),
    reason: z.string(),
    snippet: z.string().optional(),
    killed: z.array(killResultSchema),
  })),
})

/** monitor.snapshot response value (structural passthrough for the nested projections). */
export const monitorSnapshotValueSchema = z.object({
  generatedAt: z.number(),
  homeLabel: z.string(),
  summary: z.unknown(),
  models: z.array(z.unknown()),
  toolCallCounts: z.record(z.string(), z.number()),
  sessions: z.array(z.unknown()),
  processes: z.array(z.unknown()),
  securityFindings: z.array(z.unknown()),
  permissionEvents: z.array(z.unknown()),
  activityTimeline: z.array(z.object({ t: z.number(), count: z.number() })),
  history: z.array(z.unknown()),
  guard: guardStateSchema,
}) as unknown as z.ZodType<Wire<ResponseValue<'monitor.snapshot'>>>

/** monitor.sessionTimeline request payload. */
export const monitorSessionTimelineRequestSchema = z.object({
  sessionId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  beforeSeq: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'monitor.sessionTimeline'>>>

/** monitor.sessionTimeline response value. */
export const monitorSessionTimelineValueSchema = z.object({
  sessionId: z.string(),
  cwd: z.string().nullable(),
  timeline: z.array(z.object({
    seq: z.number().nullable(),
    time: z.number().nullable(),
    type: z.string(),
    compact: z.boolean(),
    label: z.string(),
    detail: z.string(),
  })),
  hasMore: z.boolean(),
  oldestSeq: z.number().nullable(),
}) as unknown as z.ZodType<Wire<ResponseValue<'monitor.sessionTimeline'>>>

/** monitor.setGuardArmed request payload. */
export const monitorSetGuardArmedRequestSchema = z.object({
  armed: z.boolean(),
}) satisfies z.ZodType<Wire<RequestPayload<'monitor.setGuardArmed'>>>

/** monitor.setGuardArmed response value. */
export const monitorSetGuardArmedValueSchema = guardStateSchema as unknown as z.ZodType<Wire<ResponseValue<'monitor.setGuardArmed'>>>

/** monitor.killNow request payload (empty object literal). */
export const monitorKillNowRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'monitor.killNow'>>>

/** monitor.killNow response value. */
export const monitorKillNowValueSchema = z.object({
  killed: z.array(killResultSchema),
}) as unknown as z.ZodType<Wire<ResponseValue<'monitor.killNow'>>>

/** monitor.exportJson request payload (empty object literal). */
export const monitorExportJsonRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'monitor.exportJson'>>>

/** monitor.exportJson response value (same shape as the snapshot). */
export const monitorExportJsonValueSchema = monitorSnapshotValueSchema as unknown as z.ZodType<Wire<ResponseValue<'monitor.exportJson'>>>

/** monitor.exportCsv request payload (empty object literal). */
export const monitorExportCsvRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'monitor.exportCsv'>>>

/** monitor.exportCsv response value. */
export const monitorExportCsvValueSchema = z.object({
  csv: z.string(),
}) as unknown as z.ZodType<Wire<ResponseValue<'monitor.exportCsv'>>>
