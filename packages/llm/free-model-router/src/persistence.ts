/**
 * Best-effort durable ledger storage at `~/.dsh/free-model-router/ledger.json`.
 * Only cooldown / daily-quota state round-trips; a failed write costs nothing
 * but a forgotten cooldown. Per-process — cross-process sharing is deferred.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/persistence
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LedgerDocument } from './types.ts'

const DEBOUNCE_MS = 1000

/** Reads once and writes debounced-atomically. */
export class LedgerStore {
  private readonly path: string
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: (() => LedgerDocument) | undefined

  /** @param dshHome - resolved `~/.dsh` directory. */
  constructor(dshHome: string) {
    this.path = join(dshHome, 'free-model-router', 'ledger.json')
  }

  /** Load the persisted document, or a fresh empty one. */
  async load(): Promise<LedgerDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (
        typeof parsed === 'object' && parsed !== null
        && (parsed as LedgerDocument).version === 1
        && typeof (parsed as LedgerDocument).entries === 'object'
      ) {
        return parsed as LedgerDocument
      }
    } catch {
      // Absent or torn — start clean.
    }
    return { version: 1, updatedAt: Date.now(), entries: {} }
  }

  /** Schedule a debounced atomic write; `snapshot` is re-read at flush time. */
  schedule(snapshot: () => LedgerDocument): void {
    this.pending = snapshot
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, DEBOUNCE_MS)
    this.timer.unref?.()
  }

  /** Write the latest scheduled snapshot now. */
  async flush(): Promise<void> {
    const snapshot = this.pending
    this.pending = undefined
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (snapshot === undefined) return
    try {
      await mkdir(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.${process.pid}.tmp`
      await writeFile(tmp, `${JSON.stringify(snapshot(), null, 2)}\n`)
      await rename(tmp, this.path)
    } catch {
      // Best-effort.
    }
  }

  /** Cancel a pending write (plugin disposal). */
  cancel(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.pending = undefined
  }
}
