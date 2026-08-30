/**
 * Sessions-table CSV serialization for the panel's "export CSV" action.
 * @module @deepseek-ai/dsh-host-harness-monitor/csv
 */

import type { MonitorSession } from './types.ts'

/** Column order of the sessions CSV. */
const COLUMNS = [
  'id', 'title', 'workspace', 'running', 'turns', 'steps', 'toolCalls', 'prompts', 'retries', 'errors',
  'tokensInput', 'tokensOutput', 'tokensCacheRead', 'tokensCacheWrite', 'estimatedCostUsd',
  'permissionPreset', 'approvalPolicy', 'lastActivity',
] as const

/** Quote a field when it contains a comma, quote, or newline. */
function esc(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Serialize the sessions table to CSV.
 * @param sessions - the snapshot's session rows.
 * @returns CSV text with a header row.
 */
export function sessionsToCsv(sessions: readonly MonitorSession[]): string {
  const rows = sessions.map(s => [
    s.id,
    s.title ?? s.dirName,
    s.workspace,
    String(s.running),
    String(s.turns),
    String(s.steps),
    String(s.toolCalls),
    String(s.prompts),
    String(s.retries),
    String(s.errors),
    String(s.tokenUsage.input),
    String(s.tokenUsage.output),
    String(s.tokenUsage.cacheRead),
    String(s.tokenUsage.cacheWrite),
    s.cost.knownUsd.toFixed(6),
    s.permissions.preset ?? '',
    s.permissions.approval ?? '',
    s.lastActivity > 0 ? new Date(s.lastActivity).toISOString() : '',
  ].map(esc).join(','))
  return [COLUMNS.join(','), ...rows].join('\n')
}
