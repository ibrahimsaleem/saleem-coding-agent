/**
 * monitor domain contract: the read-only harness observability surface plus
 * the reactive kill switch. All aggregation happens in
 * `@deepseek-ai/dsh-host-harness-monitor` (`ctx.harnessMonitor`); this domain
 * is a thin pass-through. Value shapes are that package's browser-safe `types`
 * entry (type-only import — no Node dependency reaches this contract layer).
 */

import type {
  MonitorGuardState, MonitorKillResult, MonitorSessionTimeline, MonitorSnapshot,
} from '@deepseek-ai/dsh-host-harness-monitor/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

export type {
  MonitorActivity, MonitorActivityBucket, MonitorCostByModel, MonitorGuardEvent, MonitorGuardState,
  MonitorHistoryPoint, MonitorKillResult, MonitorModel, MonitorPermissionEvent, MonitorPermissions,
  MonitorProcess, MonitorSecurityFinding, MonitorSession, MonitorSessionCost, MonitorSessionTimeline,
  MonitorSnapshot, MonitorSummary, MonitorTimelineEntry, MonitorTokenUsage,
} from '@deepseek-ai/dsh-host-harness-monitor/types'

/** Read-only observability methods plus the two kill-switch mutations. */
export interface MonitorApi {
  /**
   * The latest monitoring snapshot (headline stats, per-session rows, security
   * findings, permission timeline, activity buckets, process list, trend
   * history, guard state). Recomputed on the service's own poll loop; this
   * call returns whatever the last tick produced.
   */
  snapshot(request: RpcRequest<{}>): Promise<RpcResponse<MonitorSnapshot>>

  /**
   * One drill-down page for a session's readable timeline. `beforeSeq` is a
   * descending-seq keyset cursor (pass the previous page's `oldestSeq`);
   * absent returns the most recent `limit` kept events. An unknown session id
   * fails with `monitor-session-not-found`.
   */
  sessionTimeline(
    request: RpcRequest<{ sessionId: string; limit?: number; beforeSeq?: number }>,
  ): Promise<RpcResponse<MonitorSessionTimeline>>

  /**
   * Arm or disarm the reactive kill switch. While armed, the first
   * high-confidence malicious pattern in a fresh tool call force-kills every
   * detected harness process — this one included — and disarms.
   */
  setGuardArmed(request: RpcRequest<{ armed: boolean }>): Promise<RpcResponse<MonitorGuardState>>

  /**
   * Immediately force-kill every detected harness process, regardless of arm
   * state. Ends the current session.
   */
  killNow(request: RpcRequest<{}>): Promise<RpcResponse<{ killed: MonitorKillResult[] }>>

  /** The current snapshot as a downloadable object (identical shape to `snapshot`). */
  exportJson(request: RpcRequest<{}>): Promise<RpcResponse<MonitorSnapshot>>

  /** The current sessions table as CSV text. */
  exportCsv(request: RpcRequest<{}>): Promise<RpcResponse<{ csv: string }>>
}
