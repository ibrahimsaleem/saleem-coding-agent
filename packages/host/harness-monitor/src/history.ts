/**
 * Once-a-minute trend sampling: appends one JSONL line per minute to
 * `~/.dsh/monitor/history.jsonl` so the panel can draw a real token/cost trend
 * line rather than a live-only snapshot. Best-effort — a failed write costs one
 * missing sample, never an error.
 * @module @deepseek-ai/dsh-host-harness-monitor/history
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { MonitorHistoryPoint, MonitorSummary } from './types.ts'

const SNAPSHOT_INTERVAL_MS = 60_000

/** Appends and reads the trend file for one monitor home. */
export class HistorySampler {
  private lastSampledAt = 0

  /**
   * @param path - absolute path to `history.jsonl`.
   * @param maxLines - cap on lines read back (older samples stay on disk).
   */
  constructor(private readonly path: string, private readonly maxLines: number) {}

  /**
   * Append one sample if a minute has elapsed since the last.
   * @param summary - the current snapshot's headline numbers.
   */
  async maybeSample(summary: MonitorSummary): Promise<void> {
    const now = Date.now()
    if (now - this.lastSampledAt < SNAPSHOT_INTERVAL_MS) return
    this.lastSampledAt = now
    const point: MonitorHistoryPoint = {
      t: now,
      sessionCount: summary.sessionCount,
      runningSessions: summary.runningSessions,
      totalTurns: summary.totalTurns,
      totalToolCalls: summary.totalToolCalls,
      totalTokens: summary.tokens.total,
      estimatedCostUsd: summary.estimatedCostUsd,
      securityFindingsCount: summary.securityFindingsCount,
    }
    try {
      await mkdir(dirname(this.path), { recursive: true })
      await appendFile(this.path, `${JSON.stringify(point)}\n`)
    } catch {
      // Best-effort: a lost sample just leaves a one-minute gap.
    }
  }

  /**
   * Read the trend history back, oldest first, capped at `maxLines`.
   * @returns the parsed sample points (empty when the file is absent).
   */
  async read(): Promise<MonitorHistoryPoint[]> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch {
      return []
    }
    const lines = text.split('\n').filter(Boolean).slice(-this.maxLines)
    const points: MonitorHistoryPoint[] = []
    for (const line of lines) {
      try {
        points.push(JSON.parse(line) as MonitorHistoryPoint)
      } catch {
        // Skip a torn line.
      }
    }
    return points
  }
}
