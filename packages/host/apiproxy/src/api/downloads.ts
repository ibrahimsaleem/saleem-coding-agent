/**
 * downloads domain contract: host-only download surfaces — the GET-download
 * channel family, the mirror of the SSE-stream `events` domain. No wire
 * envelope: the carrier's GET routes answer these directly, and the browser
 * `IApiClient` never exposes them.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Host-only download surfaces (no wire envelope; absent from IApiClient). */
export interface DownloadsApi {
  /**
   * Stream one session-log ZIP — the root artifact verbatim plus each subagent
   * descendant's — as an attachment response. The carrier's GET route answers
   * this directly; the browser never calls it.
   * @param request - the root session id and whether to include descendants.
   * @param signal - cancellation for the underlying reads.
   * @returns the ZIP attachment response; missing services answer 500 and a
   * missing root session 404 before any byte is produced.
   */
  sessionLog(
    request: { sessionId: SessionId; includeDescendants?: boolean },
    signal: AbortSignal,
  ): Promise<Response>

  /**
   * Stream one generated harness as a standalone-app ZIP: the preset
   * directory, a settings file pointing at it, launchers, and a README. The
   * carrier's GET route answers this directly; the browser reaches it with a
   * plain link rather than an envelope call.
   * @param request - the preset id to pack.
   * @param signal - cancellation for the underlying reads.
   * @returns the ZIP attachment response; a missing factory answers 500 and an
   * unknown preset 404 before any byte is produced.
   */
  harnessPack(request: { agentPreset: string; mode?: 'bootstrap' | 'bundled' }, signal: AbortSignal): Promise<Response>
}
