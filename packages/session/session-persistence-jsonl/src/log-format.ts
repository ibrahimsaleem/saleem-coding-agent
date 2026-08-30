/**
 * Small public surface over this package's on-disk log format, for read-only
 * external consumers that need to decode a `session.jsonl.zstd` artifact
 * without depending on the workspace-internal `./src/*` convention (e.g. a
 * cross-process observability reader walking every session under
 * `~/.dsh/sessions`, not just the ones this backend's own configured root
 * currently manages). Re-exports only; no new logic.
 * @module @deepseek-ai/dsh-session-persistence-jsonl/log-format
 */

export {
  encodeSegment, logPath, logSuffix, parseHeaderMeta, projectDir, scanLog, sessionDir,
} from './format.ts'
export type { JsonlCompression } from './format.ts'
export { createZstdFrameDecoder, scanZstdFrames } from './zstd.ts'
export type { ZstdFrameDecoder, ZstdFrameRange, ZstdFrameScan } from './zstd.ts'
