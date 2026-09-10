/**
 * host domain zod schemas (names derived from map keys).
 */

import { z } from 'zod'
import type { DirectoryEntry, GitPathStatus, WorkspaceEntry } from './host.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** host.describe request payload (empty object literal). */
export const hostDescribeRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'host.describe'>>>

/** host.describe response value. */
export const hostDescribeValueSchema = z.object({
  version: z.string(),
  cwd: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  attachedSessions: z.number().int().nonnegative(),
  home: z.string(),
  canOpenPath: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.describe'>>>

/** host.pickDirectory request payload (empty object literal). */
export const hostPickDirectoryRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'host.pickDirectory'>>>

/** host.pickDirectory response value; null means the user cancelled. */
export const hostPickDirectoryValueSchema = z.object({
  path: z.string().nullable(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.pickDirectory'>>>

/** Directory row shared by listing entries and breadcrumb crumbs. */
export const directoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  hidden: z.boolean(),
}) satisfies z.ZodType<Wire<DirectoryEntry>>

/** host.listDirectory request payload; an absent path lists the home directory. */
export const hostListDirectoryRequestSchema = z.object({
  path: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'host.listDirectory'>>>

/** host.listDirectory response value. */
export const hostListDirectoryValueSchema = z.object({
  path: z.string(),
  home: z.string(),
  crumbs: z.array(directoryEntrySchema),
  entries: z.array(directoryEntrySchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.listDirectory'>>>

/** Workspace-tree row: a file or a subdirectory. */
export const workspaceEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(['directory', 'file']),
  hidden: z.boolean(),
}) satisfies z.ZodType<Wire<WorkspaceEntry>>

/** host.listWorkspaceEntries request payload; path must be fully qualified. */
export const hostListWorkspaceEntriesRequestSchema = z.object({
  path: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'host.listWorkspaceEntries'>>>

/** host.listWorkspaceEntries response value. */
export const hostListWorkspaceEntriesValueSchema = z.object({
  path: z.string(),
  entries: z.array(workspaceEntrySchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.listWorkspaceEntries'>>>

/** host.searchWorkspaceEntries request payload; path must be fully qualified. */
export const hostSearchWorkspaceEntriesRequestSchema = z.object({
  path: z.string().min(1),
  query: z.string(),
}) satisfies z.ZodType<Wire<RequestPayload<'host.searchWorkspaceEntries'>>>

/** host.searchWorkspaceEntries response value. */
export const hostSearchWorkspaceEntriesValueSchema = z.object({
  path: z.string(),
  results: z.array(workspaceEntrySchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.searchWorkspaceEntries'>>>

/** One tracked path's working-tree change. */
export const gitPathStatusSchema = z.object({
  path: z.string(),
  status: z.enum(['modified', 'added', 'deleted', 'renamed', 'untracked', 'conflicted']),
}) satisfies z.ZodType<Wire<GitPathStatus>>

/** host.gitStatus request payload; path must be fully qualified. */
export const hostGitStatusRequestSchema = z.object({
  path: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'host.gitStatus'>>>

/** host.gitStatus response value. */
export const hostGitStatusValueSchema = z.object({
  available: z.boolean(),
  changes: z.array(gitPathStatusSchema),
  ignored: z.array(z.string()),
}) satisfies z.ZodType<Wire<ResponseValue<'host.gitStatus'>>>

/** host.createDirectory request payload: name must be one plain path segment. */
export const hostCreateDirectoryRequestSchema = z.object({
  path: z.string(),
  name: z.string(),
}).refine(
  payload => payload.name.trim() !== '' && payload.name !== '.' && payload.name !== '..'
    && !/[/\\]/.test(payload.name),
  { message: 'host.createDirectory requires a single non-blank path segment name' },
) satisfies z.ZodType<Wire<RequestPayload<'host.createDirectory'>>>

/** host.createDirectory response value: the created directory's absolute path. */
export const hostCreateDirectoryValueSchema = z.object({
  path: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.createDirectory'>>>
/** host.openPath request payload. */
export const hostOpenPathRequestSchema = z.object({
  path: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'host.openPath'>>>

/** host.openPath response value. */
export const hostOpenPathValueSchema = z.object({
  opened: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'host.openPath'>>>
