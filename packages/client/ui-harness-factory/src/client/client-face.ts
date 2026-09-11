/**
 * The harness RPC surface the page consumes, narrowed to plain values (the
 * plugin unwraps `RpcResponse` before it reaches the component).
 * @module @ibrahimsaleem/dsh-client-ui-harness-factory/client/client-face
 */

import type { GeneratedHarnessEntry, HarnessTemplateEntry } from '@deepseek-ai/dsh-client-connection/client'

export type { GeneratedHarnessEntry, HarnessTemplateEntry } from '@deepseek-ai/dsh-client-connection/client'

/** Value-level harness surface for the page. */
export interface HarnessClient {
  /** The template catalog, and whether this deployment can build at all. */
  templates(signal?: AbortSignal): Promise<{
    templates: readonly HarnessTemplateEntry[]
    available: boolean
    canPackBundled: boolean
  }>
  /**
   * Generate one harness. Slow by nature — a model round trip plus a preset
   * copy and mount — so callers should show progress rather than a spinner
   * they expect to blink.
   */
  generate(prompt: string, template: string | undefined, signal?: AbortSignal): Promise<GeneratedHarnessEntry>
  /**
   * Start a session on a generated harness. Staging the preset and starting the
   * session is the same two-step the Creator-mode card uses, because a preset
   * is chosen on the new-session screen rather than inside a running session.
   */
  runHarness(agentPreset: string): void
  /**
   * The URL a download link points at; the browser's own download manager
   * fetches it, so even a several-hundred-megabyte standalone pack never
   * passes through JavaScript.
   */
  downloadUrl(agentPreset: string, mode: 'bootstrap' | 'bundled'): string
}
