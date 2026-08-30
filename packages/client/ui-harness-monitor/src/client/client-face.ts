/**
 * The monitor RPC surface the panel consumes, narrowed to plain values (the
 * plugin unwraps `RpcResponse` before it reaches the component).
 * @module @deepseek-ai/dsh-client-ui-harness-monitor/client/client-face
 */

import type {
  MonitorGuardState, MonitorKillResult, MonitorSessionTimeline, MonitorSnapshot,
} from '@deepseek-ai/dsh-client-connection/client'

export type {
  MonitorActivity, MonitorActivityBucket, MonitorCostByModel, MonitorGuardEvent, MonitorGuardState,
  MonitorHistoryPoint, MonitorKillResult, MonitorModel, MonitorPermissionEvent, MonitorProcess,
  MonitorSecurityFinding, MonitorSession, MonitorSessionCost, MonitorSessionTimeline, MonitorSnapshot,
  MonitorSummary, MonitorTimelineEntry, MonitorTokenUsage,
} from '@deepseek-ai/dsh-client-connection/client'

/** One drill-down page request. */
export interface TimelineQuery {
  sessionId: string
  limit?: number
  beforeSeq?: number
}

/** Value-level monitor surface for the panel. */
export interface MonitorClient {
  /** The latest monitoring snapshot. */
  snapshot(signal?: AbortSignal): Promise<MonitorSnapshot>
  /** One drill-down page, or null when the session id is unknown. */
  sessionTimeline(query: TimelineQuery, signal?: AbortSignal): Promise<MonitorSessionTimeline | null>
  /** Arm or disarm the reactive kill switch; returns the new guard state. */
  setGuardArmed(armed: boolean): Promise<MonitorGuardState>
  /** Force-kill every detected harness process now; returns per-pid outcomes. */
  killNow(): Promise<MonitorKillResult[]>
  /** The sessions table as CSV text. */
  exportCsv(): Promise<string>
}
