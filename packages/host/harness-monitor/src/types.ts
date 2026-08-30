/**
 * Wire-shaped observability data. Every field is plain JSON (the apiproxy
 * `monitor.*` domain re-exports these verbatim as its response values), so no
 * branded ids, class instances, or non-serializable values appear here.
 * @module @deepseek-ai/dsh-host-harness-monitor/types
 */

/** Cumulative token counts for one session or the whole fleet. */
export interface MonitorTokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** One model's share of a session's estimated cost. */
export interface MonitorCostByModel {
  /** `<provider>/<model>` key, as reported by the session's `request/context` events. */
  key: string
  /** Number of requests this session made against this model. */
  requests: number
  /** This model's share of the session's requests (0..1). */
  weight: number
  /** USD estimate for this model's weighted slice, or null when the model has no pricing entry. */
  usd: number | null
}

/** A session's estimated cost, split across the models it used. */
export interface MonitorSessionCost {
  /** Sum of the priced slices' USD. */
  knownUsd: number
  /** Share of requests (0..1) that ran on an unpriced model. */
  unknownShare: number
  /** Per-model breakdown. */
  byModel: MonitorCostByModel[]
}

/** What a running session is doing right now (derived from the tail of its log). */
export interface MonitorActivity {
  kind: 'tool' | 'waiting' | 'thinking' | 'writing' | 'step' | 'prompt' | 'idle'
  /** Short human label (e.g. the tool name, or "reasoning"). */
  label: string
  /** Optional longer detail (a command line, a description), capped in length. */
  detail: string
  /** Event time of the activity, or null when idle. */
  time: number | null
}

/** The three permission dimensions, as last seen in a session's log. */
export interface MonitorPermissions {
  preset?: string
  sandbox?: string
  approval?: string
}

/** One session's aggregated view. */
export interface MonitorSession {
  /** Session id (from the log header). */
  id: string
  /** On-disk session directory name. */
  dirName: string
  /** Project directory name under `sessions/`. */
  workspace: string
  /** Session title, when one has been set. */
  title: string | null
  /** Absolute working directory the session runs in. */
  cwd: string | null
  /** Epoch ms the session was created. */
  createdAt: number | null
  /** Epoch ms of the most recent event. */
  lastActivity: number
  /** Whether an agent step is currently open (from the projection cache). */
  running: boolean
  /** Present only while `running`. */
  activity: MonitorActivity | null
  turns: number
  steps: number
  toolCalls: number
  prompts: number
  retries: number
  errors: number
  tokenUsage: MonitorTokenUsage
  cost: MonitorSessionCost
  permissions: MonitorPermissions
  /** `preset === 'danger-full-access'` or `approval === 'never'`. */
  riskyPermission: boolean
}

/** One heuristic security finding. */
export interface MonitorSecurityFinding {
  ruleId: string
  severity: 'high' | 'medium' | 'low'
  /** Whether an armed guard force-kills the harness on this pattern. */
  autoKill: boolean
  label: string
  /** Context window around the match. */
  snippet: string
  sessionId: string
  time: number
  /** `prompt` or `tool:<name>`. */
  source: string
}

/** One entry of the permission/sandbox timeline. */
export interface MonitorPermissionEvent {
  sessionId: string
  time: number
  type: 'permission/preset' | 'sandbox/mode' | 'approval/policy'
  value: string
}

/** One minute-wide bucket of the activity sparkline (tool calls per minute). */
export interface MonitorActivityBucket {
  /** Bucket start, epoch ms. */
  t: number
  count: number
}

/** One detected harness process. */
export interface MonitorProcess {
  pid: number
  /** Profile name extracted from the command line, or `unknown`. */
  profile: string
  commandLine: string
  creationDate: string | null
  /** Whether this pid is the process hosting the monitor itself. */
  self: boolean
}

/** One connected model/provider, from `settings.yaml`. */
export interface MonitorModel {
  /** Provider route key. */
  route: string
  /** Model id. */
  id: string
  /** Environment variable holding this provider's key, when declared. */
  apiKeyEnv: string | null
  /** Whether that key is present in the environment; null when no env var is declared. */
  hasKey: boolean | null
  /** Requests made against this `route/model` across all sessions. */
  requests: number
}

/** Fleet-wide headline numbers. */
export interface MonitorSummary {
  sessionCount: number
  runningSessions: number
  processCount: number
  totalTurns: number
  totalPrompts: number
  totalToolCalls: number
  totalRetries: number
  totalErrors: number
  modelsConnected: number
  securityFindingsCount: number
  riskyPermissionSessions: number
  tokens: MonitorTokenUsage & { total: number }
  estimatedCostUsd: number
  /** True when any session used a model with no pricing entry. */
  hasUnknownCost: boolean
}

/** One kill action's per-process outcome. */
export interface MonitorKillResult {
  pid: number
  ok: boolean
  error?: string
}

/** One guard firing (auto-kill or manual). */
export interface MonitorGuardEvent {
  time: number
  reason: string
  snippet?: string
  killed: MonitorKillResult[]
}

/** In-memory guard state (never persisted). */
export interface MonitorGuardState {
  armed: boolean
  armedAt: number | null
  events: MonitorGuardEvent[]
}

/** One point of the once-a-minute trend history. */
export interface MonitorHistoryPoint {
  t: number
  sessionCount: number
  runningSessions: number
  totalTurns: number
  totalToolCalls: number
  totalTokens: number
  estimatedCostUsd: number
  securityFindingsCount: number
}

/** The whole monitoring snapshot. */
export interface MonitorSnapshot {
  generatedAt: number
  /** Symbolic home label (`~/.dsh` or `$DSH_HOME`), never an absolute machine path. */
  homeLabel: string
  summary: MonitorSummary
  models: MonitorModel[]
  toolCallCounts: Record<string, number>
  sessions: MonitorSession[]
  processes: MonitorProcess[]
  /** Severity-ranked, capped. */
  securityFindings: MonitorSecurityFinding[]
  /** Time-ordered (newest first), capped. */
  permissionEvents: MonitorPermissionEvent[]
  /** 30 minute-wide buckets, oldest first. */
  activityTimeline: MonitorActivityBucket[]
  history: MonitorHistoryPoint[]
  guard: MonitorGuardState
}

/** One reduced event of a session drill-down timeline. */
export interface MonitorTimelineEntry {
  seq: number | null
  time: number | null
  type: string
  /** Whether this is a thin boundary marker rather than a full card. */
  compact: boolean
  label: string
  detail: string
}

/** A paginated session drill-down timeline. */
export interface MonitorSessionTimeline {
  sessionId: string
  cwd: string | null
  timeline: MonitorTimelineEntry[]
  /** Whether earlier events exist before `oldestSeq`. */
  hasMore: boolean
  /** Cursor to pass back as `beforeSeq` for the previous page, or null. */
  oldestSeq: number | null
}

/** Request options for a drill-down page. */
export interface MonitorTimelineQuery {
  sessionId: string
  /** Page size (most recent N kept events, or the N before `beforeSeq`). */
  limit?: number
  /** Descending-seq keyset cursor from a prior page's `oldestSeq`. */
  beforeSeq?: number
}
