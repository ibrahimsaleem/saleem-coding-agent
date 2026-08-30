/**
 * Per-session drill-down: reduce a raw event log to a readable, paginated
 * timeline (prompts, tool calls + results, permission changes, turn/step
 * boundaries), newest page first with a descending-seq keyset cursor.
 * @module @deepseek-ai/dsh-host-harness-monitor/timeline
 */

import type { RawEvent } from './session-logs.ts'
import { seqOf, timeOf } from './session-logs.ts'
import type { MonitorSessionTimeline, MonitorTimelineEntry } from './types.ts'

/** Event types kept in a drill-down (everything else is stream noise). */
const KEPT = new Set([
  'session', 'permission/preset', 'sandbox/mode', 'approval/policy', 'command/run', 'command/done',
  'turn/start', 'turn/end', 'step/start', 'step/end', 'user/message', 'tool/call', 'tool/result',
  'assistant/message', 'todo/write', 'llm/retry', 'session/title',
])

/** Kept types rendered as a thin divider rather than a full card. */
const COMPACT = new Set(['turn/start', 'turn/end', 'step/start', 'step/end'])

const DEFAULT_LIMIT = 100
const DETAIL_MAX = 2000

/** Read a nested property path off an unknown value. */
function at(obj: unknown, ...keys: string[]): unknown {
  let cur = obj
  for (const key of keys) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/** Concatenated readable text of a message content value (string or part array). */
function contentText(data: unknown): string {
  const content = at(data, 'content') ?? at(data, 'message', 'content')
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) {
    return content === undefined ? '' : safeJson(content)
  }
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      const type = at(part, 'type')
      if (type === 'text') return String(at(part, 'text') ?? '')
      if (type === 'tool-call') return `↳ ${String(at(part, 'name') ?? 'tool')}(${String(at(part, 'arguments') ?? '')})`
      if (type === 'tool-result' || type === 'tool_result') {
        return typeof at(part, 'content') === 'string' ? String(at(part, 'content')) : safeJson(at(part, 'content'))
      }
      return safeJson(part)
    })
    .filter(Boolean)
    .join('\n')
}

/** Best-effort compact JSON of an unknown value. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Human label + detail for one kept event. */
function summarize(ev: RawEvent): { label: string; detail: string } {
  switch (ev.type) {
    case 'session':
      return { label: 'session created', detail: String(at(ev.data, 'cwd') ?? '') }
    case 'user/message':
      return { label: `prompt (${String(at(ev.data, 'source', 'kind') ?? 'user')})`, detail: contentText(ev.data) }
    case 'assistant/message':
      return { label: 'assistant', detail: contentText(ev.data) }
    case 'tool/call':
      return { label: `tool: ${String(at(ev.data, 'name') ?? '?')}`, detail: String(at(ev.data, 'arguments') ?? '') }
    case 'tool/result':
      return { label: at(ev.data, 'error') !== undefined ? 'tool error' : 'tool result', detail: contentText(ev.data) }
    case 'permission/preset':
      return { label: 'permission preset', detail: String(at(ev.data, 'preset') ?? '') }
    case 'sandbox/mode':
      return { label: 'sandbox mode', detail: String(at(ev.data, 'mode') ?? '') }
    case 'approval/policy':
      return { label: 'approval policy', detail: String(at(ev.data, 'policy') ?? '') }
    case 'llm/retry':
      return { label: 'llm retry', detail: String(at(ev.data, 'failure', 'message') ?? '') }
    case 'session/title':
      return { label: 'title', detail: String(at(ev.data, 'title') ?? '') }
    case 'command/run':
      return { label: `command: ${String(at(ev.data, 'name') ?? '')}`, detail: String(at(ev.data, 'args') ?? '') }
    case 'command/done':
      return { label: 'command done', detail: '' }
    case 'todo/write':
      return { label: 'todos updated', detail: '' }
    case 'turn/start':
      return { label: `turn ${String(at(ev.data, 'turn') ?? '?')}`, detail: '' }
    case 'turn/end':
      return { label: `turn ${String(at(ev.data, 'turn') ?? '?')} end (${String(at(ev.data, 'reason', 'kind') ?? '?')})`, detail: '' }
    case 'step/start':
      return { label: `step ${String(at(ev.data, 'step') ?? '?')}`, detail: '' }
    case 'step/end':
      return { label: `step ${String(at(ev.data, 'step') ?? '?')} end`, detail: '' }
    default:
      return { label: ev.type, detail: '' }
  }
}

/**
 * Build one drill-down page.
 * @param events - the session's full decoded log.
 * @param sessionId - id echoed back on the result.
 * @param cwd - the session's working directory, for the drill-down header.
 * @param limit - page size.
 * @param beforeSeq - descending keyset cursor; entries with `seq < beforeSeq`.
 * @returns the newest page (or the page before the cursor) plus `hasMore`/`oldestSeq`.
 */
export function buildTimeline(
  events: RawEvent[],
  sessionId: string,
  cwd: string | null,
  limit = DEFAULT_LIMIT,
  beforeSeq?: number,
): MonitorSessionTimeline {
  const kept = events.filter((ev) => {
    if (!KEPT.has(ev.type)) return false
    if (beforeSeq === undefined) return true
    const seq = seqOf(ev)
    return seq !== undefined && seq < beforeSeq
  })
  const page = kept.slice(-limit)
  const timeline: MonitorTimelineEntry[] = page.map((ev) => {
    const { label, detail } = summarize(ev)
    return {
      seq: seqOf(ev) ?? null,
      time: timeOf(ev) ?? null,
      type: ev.type,
      compact: COMPACT.has(ev.type),
      label,
      detail: detail.length > DETAIL_MAX ? `${detail.slice(0, DETAIL_MAX)}…` : detail,
    }
  })
  const first = page[0]
  return {
    sessionId,
    cwd,
    timeline,
    hasMore: kept.length > page.length,
    oldestSeq: first !== undefined ? seqOf(first) ?? null : null,
  }
}
