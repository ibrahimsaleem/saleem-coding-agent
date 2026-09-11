/**
 * harness domain contract: the Harness Factory surface — read the template
 * catalog, generate a runnable harness from a description, and pack one for
 * download. All the work happens in `@ibrahimsaleem/dsh-harness-factory`
 * (`ctx.harnessFactory`); this domain is a thin pass-through.
 *
 * `generate` is the one method here that both calls a model and writes to
 * disk, so it is also the slowest: a generation runs an LLM call, copies a
 * template, renders it, and MOUNTS the result to prove it runs before
 * answering. Callers should expect it to take as long as a model round trip
 * plus a preset mount, not as long as a read.
 *
 * Every method in this domain is loopback-pinned (see `PRIVILEGED_METHODS` in
 * `@deepseek-ai/dsh-client-connection`): generating a harness creates a preset
 * directory and packing one reads it back, which is the same authority as the
 * `agentPreset.copy` / `agentPreset.read` pair already pinned there.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One template the factory can build from. */
export interface HarnessTemplateEntry {
  /** Catalog id a generate request may force. */
  readonly id: string
  /** Display title. */
  readonly label: string
  /** What this shape of harness does. */
  readonly blurb: string
  /** The phases its bundled methodology walks. */
  readonly phases: readonly string[]
  /** The capability toggles a generated harness may turn on. */
  readonly toggles: readonly { readonly id: string; readonly label: string; readonly defaultOn: boolean }[]
}

/** One built harness, as the browser renders it. */
export interface GeneratedHarnessEntry {
  /** The new preset's roster id — what `session.create` takes as `agentPreset`. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** One-line description. */
  readonly description: string
  /** The catalog template it was built from. */
  readonly template: string
  /** The persona written into it, for the preview. */
  readonly persona: string
  /** The methodology skills written into it. */
  readonly skills: readonly { readonly name: string; readonly description: string }[]
  /** Capability toggle ids left on. */
  readonly enabled: readonly string[]
  /**
   * Capabilities the model asked for that the chosen template does not offer.
   * Surfaced rather than swallowed: the harness was still built, and the user
   * should learn what did not make it in.
   */
  readonly dropped: readonly string[]
}

/** The Harness Factory's browser-facing surface. */
export interface HarnessApi {
  /**
   * The template catalog the picker renders. Answers an empty list when the
   * deployment mounts no factory, rather than failing — the page then explains
   * itself instead of erroring.
   */
  templates(request: RpcRequest<{}>): Promise<RpcResponse<{
    templates: readonly HarnessTemplateEntry[]
    available: boolean
    /**
     * Whether this host can produce a self-contained download. False when no
     * runtime bundle has been built here — the small bootstrap pack still
     * works, so the page offers that one alone rather than a dead button.
     */
    canPackBundled: boolean
  }>>

  /**
   * Generate, build, and verify one harness from a natural-language
   * description. `template` forces a catalog entry; omitted, the model routes
   * to the closest one.
   *
   * The returned harness is already proven to mount — a build whose
   * composition cannot load is rolled back and reported as a failure, so this
   * never answers with a preset the roster would mark broken.
   */
  generate(
    request: RpcRequest<{ prompt: string; template?: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ harness: GeneratedHarnessEntry }>>
}
