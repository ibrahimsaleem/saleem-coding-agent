/**
 * Read-only walk of every session event log under `~/.dsh/sessions`. Uses this
 * repo's own zstd frame scanner and decoder (not a hand-rolled multi-frame
 * reader) to turn each `session.jsonl.zstd` into its raw JSONL event objects.
 * A per-file cache keyed by size skips re-decoding an unchanged log on the next
 * poll — the common case, since only running sessions grow.
 * @module @deepseek-ai/dsh-host-harness-monitor/session-logs
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createZstdFrameDecoder, scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/log-format'

/**
 * One raw log line. Only the envelope fields the aggregator reads are named;
 * `data` stays loose because plugin-contributed event types (permission,
 * retry, chunk rows) are not in the core event map. `text-chunks` rows carry
 * `seq0`/`time0` instead of `seq`/`time`.
 */
export interface RawEvent {
  type: string
  seq?: number
  time?: number
  seq0?: number
  time0?: number
  data?: unknown
}

/** One discovered session log. */
export interface SessionLogFile {
  /** Project directory name under `sessions/`. */
  workspace: string
  /** Session directory name. */
  dirName: string
  /** Absolute path to `session.jsonl.zstd`. */
  path: string
}

interface CacheEntry {
  size: number
  events: RawEvent[]
}

/** Whether a filesystem error means "not there" (everything else must surface). */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Reader for a single `~/.dsh/sessions` root. Holds the per-file decode cache
 * across polls, so it is created once and reused, not per-snapshot.
 */
export class SessionLogReader {
  private readonly cache = new Map<string, CacheEntry>()

  /** @param sessionsRoot - absolute path of `~/.dsh/sessions`. */
  constructor(private readonly sessionsRoot: string) {}

  /**
   * List every session log two directory levels under the sessions root.
   * @returns the discovered logs (empty when the root is absent).
   */
  async listLogs(): Promise<SessionLogFile[]> {
    let projects: string[]
    try {
      const entries = await readdir(this.sessionsRoot, { withFileTypes: true })
      projects = entries.filter(e => e.isDirectory()).map(e => e.name)
    } catch (error) {
      if (isENOENT(error)) return []
      throw error
    }
    const logs: SessionLogFile[] = []
    for (const workspace of projects) {
      let dirs: string[]
      try {
        const entries = await readdir(join(this.sessionsRoot, workspace), { withFileTypes: true })
        dirs = entries.filter(e => e.isDirectory()).map(e => e.name)
      } catch (error) {
        if (isENOENT(error)) continue
        throw error
      }
      for (const dirName of dirs) {
        const path = join(this.sessionsRoot, workspace, dirName, 'session.jsonl.zstd')
        try {
          await stat(path)
          logs.push({ workspace, dirName, path })
        } catch (error) {
          if (!isENOENT(error)) throw error
        }
      }
    }
    return logs
  }

  /**
   * Read one log's raw events, from cache when the file size is unchanged.
   * A partial or corrupt trailing frame (a live session mid-write) is skipped,
   * not thrown.
   * @param path - absolute path to a `session.jsonl.zstd`.
   * @returns the decoded events (empty on any read failure).
   */
  async readEvents(path: string): Promise<RawEvent[]> {
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      this.cache.delete(path)
      return []
    }
    const cached = this.cache.get(path)
    if (cached !== undefined && cached.size === size) return cached.events

    let events: RawEvent[]
    try {
      events = decodeLog(await readFile(path))
    } catch {
      events = []
    }
    this.cache.set(path, { size, events })
    return events
  }

  /** Drop cache entries for logs that no longer exist. */
  prune(livePaths: Set<string>): void {
    for (const path of this.cache.keys()) {
      if (!livePaths.has(path)) this.cache.delete(path)
    }
  }
}

/**
 * Decode a full `session.jsonl.zstd` buffer into its raw event objects.
 * @param buffer - the file bytes.
 * @returns the parsed JSONL records (unparseable lines dropped).
 */
export function decodeLog(buffer: Buffer): RawEvent[] {
  const { frames } = scanZstdFrames(buffer)
  if (frames.length === 0) return []
  const decoder = createZstdFrameDecoder()
  const chunks: Buffer[] = []
  try {
    // The decoder yields views into a reused buffer; copy each frame's bytes
    // before advancing so a later concat cannot read overwritten memory.
    for (const plaintext of decoder.decode(buffer, frames)) chunks.push(Buffer.from(plaintext))
  } catch {
    // A torn final frame during a live write: keep whatever decoded cleanly.
  } finally {
    decoder.close()
  }
  const text = Buffer.concat(chunks).toString('utf8')
  const events: RawEvent[] = []
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (parsed !== null && typeof parsed === 'object' && typeof (parsed as RawEvent).type === 'string') {
        events.push(parsed as RawEvent)
      }
    } catch {
      // Partial trailing line mid-write.
    }
  }
  return events
}

/** The event's sequence number under either the plain or the chunk-row spelling. */
export function seqOf(event: RawEvent): number | undefined {
  return event.seq ?? event.seq0
}

/** The event's timestamp under either the plain or the chunk-row spelling. */
export function timeOf(event: RawEvent): number | undefined {
  return event.time ?? event.time0
}
