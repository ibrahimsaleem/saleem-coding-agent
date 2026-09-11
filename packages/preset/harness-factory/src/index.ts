/**
 * `ctx.harnessFactory` — builds runnable agent presets ("harnesses") from a
 * natural-language description, and packs one as a standalone runnable folder.
 *
 * ## Why it is shaped this way
 *
 * Preset authoring in this harness is copy-only on purpose. `agentPreset.write`
 * once accepted composition text and was deleted
 * (`.agents/notes/implemented/simplification/2026-08-08-copy-only-preset-authoring.md`)
 * because the composition dialect includes `!!js`: any text-accepting seam is
 * arbitrary code execution at the next mount, however carefully the text is
 * shape-checked. A generator that wrote composition YAML would re-open that.
 *
 * So this service never asks a model for composition. The pipeline is:
 *
 *   1. **generate** — one bounded LLM call returns a {@link HarnessSpec}: inert
 *      data, validated against the catalog, carrying no plugin names or paths.
 *   2. **copy** — `agentPresets.copy(seed, id)` duplicates a SHIPPED template
 *      whose row graph a human wrote and this repository tests. This is the
 *      existing, already loopback-pinned authoring call; no new write
 *      capability is introduced.
 *   3. **render** — the spec is applied to the copy's inert surfaces only:
 *      persona text, skill markdown, metadata, and `disabled:` on allowlisted
 *      rows.
 *   4. **probe** — the result is actually MOUNTED before the user is told it
 *      exists. Nothing else in the preset system does this; a broken
 *      composition normally surfaces when a session first tries to start.
 *      A failed probe rolls the preset back rather than leaving a broken row
 *      on the roster.
 *
 * The consequence worth stating plainly: a generated harness cannot be less
 * mountable than its template, because its row graph IS its template's.
 * @module @ibrahimsaleem/dsh-harness-factory
 */

import { dirname } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { generateHarnessSpec, HarnessGenerationError } from './generate.ts'
import { packHarness } from './export.ts'
import { renderHarness } from './render.ts'
import { parseHarnessSpec } from './spec.ts'
import { findTemplate, HARNESS_TEMPLATES, toggleAllowlist } from './templates.ts'
import type { HarnessPack } from './export.ts'
import type { HarnessSpec } from './spec.ts'
import type { HarnessTemplate } from './templates.ts'

export { HARNESS_TEMPLATES, findTemplate, toggleAllowlist } from './templates.ts'
export { parseHarnessSpec, HARNESS_ID } from './spec.ts'
export { renderComposition, renderSkillMarkdown, HarnessRenderError } from './render.ts'
export { packHarness, packSettings, packManifest, packReadme } from './export.ts'
export { generateHarnessSpec, systemPrompt, extractJson, HarnessGenerationError } from './generate.ts'
export type { HarnessSpec, HarnessSkillSpec, HarnessSpecResult, SpecValidationContext } from './spec.ts'
export type { HarnessTemplate, HarnessToggle } from './templates.ts'
export type { HarnessPack } from './export.ts'

/** Cordis plugin name. */
export const name = 'harness-factory'

/** Plugin config. */
export interface Config {
  /** Roster order assigned to generated harnesses (they sort after the shipped presets). */
  order?: number
  /** Provider route for the generation call; omitted means the deployment default. */
  provider?: string
  /** Model id for the generation call; omitted means the deployment default. */
  model?: string
}

/** One built harness, as the caller sees it. */
export interface GeneratedHarness {
  /** The new preset's roster id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** One-line description. */
  readonly description: string
  /** The catalog template it was built from. */
  readonly template: string
  /** The persona that was written into it. */
  readonly persona: string
  /** The skills that were written into it. */
  readonly skills: readonly { name: string; description: string }[]
  /** Capability toggle ids left on. */
  readonly enabled: readonly string[]
  /** Toggles the model asked for that the template does not offer. */
  readonly dropped: readonly string[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    harnessFactory: HarnessFactory
  }
}

/**
 * Builds harnesses from descriptions. Registers as `ctx.harnessFactory`.
 *
 * `agentPresets` is reached through `ctx.get` rather than `inject` so a
 * deployment with no roster (headless, ACP, the SDK server) loads this service
 * inert instead of failing to compose — the same treatment the apiproxy gives
 * the preset domain.
 */
export class HarnessFactory extends Service {
  static inject = ['llm']

  static Config: z<Config> = z.object({
    order: z.natural().default(100),
    provider: z.string(),
    model: z.string(),
  })

  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'harnessFactory')
    this.config = config
  }

  /** The template catalog the picker renders. */
  templates(): readonly HarnessTemplate[] {
    return HARNESS_TEMPLATES
  }

  /** The preset roster, or undefined when this deployment mounts none. */
  private presets(): Context['agentPresets'] | undefined {
    return this.ctx.get('agentPresets')
  }

  /**
   * Generate, build, and verify one harness.
   * @param request - the user's description, an optional forced template, and cancellation.
   * @returns the built harness, already mounted once to prove it runs.
   * @throws when no roster is mounted, generation fails, or the built preset does not mount.
   */
  async generate(request: { prompt: string; template?: string; signal?: AbortSignal }): Promise<GeneratedHarness> {
    const presets = this.presets()
    if (presets === undefined) {
      throw new HarnessGenerationError('this deployment mounts no agent-preset roster, so a harness cannot be created')
    }
    if (!presets.authorable) {
      throw new HarnessGenerationError('the agent-preset roster has no writable root, so a harness cannot be created')
    }
    if (request.template !== undefined && findTemplate(request.template) === undefined) {
      throw new HarnessGenerationError(`unknown template "${request.template}"`)
    }

    const roster = await presets.list()
    const result = await generateHarnessSpec(this.ctx, {
      prompt: request.prompt,
      ...request.template === undefined ? {} : { template: request.template },
      ...this.config.provider === undefined ? {} : { provider: this.config.provider },
      ...this.config.model === undefined ? {} : { model: this.config.model },
      ...request.signal === undefined ? {} : { signal: request.signal },
      validation: {
        templates: HARNESS_TEMPLATES.map(template => template.id),
        toggles: toggleAllowlist(),
        taken: roster.map(preset => preset.id),
      },
    })
    return this.build(result.spec, result.dropped, request.signal)
  }

  /**
   * Build and verify a harness from an already-validated spec — the generation
   * pipeline minus the model call. Exposed because it is the whole of what
   * generation does after the LLM, and because it is what tests drive.
   * @param spec - a validated spec.
   * @param dropped - toggles the spec asked for that its template does not offer.
   * @param signal - cancellation checked between the copy and the probe.
   * @returns the built harness.
   */
  async build(spec: HarnessSpec, dropped: readonly string[] = [], signal?: AbortSignal): Promise<GeneratedHarness> {
    const presets = this.presets()
    if (presets === undefined) throw new HarnessGenerationError('no agent-preset roster is mounted')
    const template = findTemplate(spec.template)
    if (template === undefined) throw new HarnessGenerationError(`unknown template "${spec.template}"`)

    await presets.copy(template.seed, spec.id, spec.name)
    // From here the preset exists on disk: every failure path must remove it,
    // or a half-built harness stays on the roster marked broken.
    try {
      signal?.throwIfAborted()
      const created = await presets.resolve(spec.id)
      await renderHarness(dirname(created.path), spec, template, this.config.order ?? 100)
      signal?.throwIfAborted()
      // The probe. `standingKeyFor` performs a real mount (composing every row
      // and enforcing the isolate-realm rule) and throws PresetMountError when
      // the composition cannot run. This is the step that makes "generated
      // harnesses run" a checked claim rather than a hope.
      await presets.standingKeyFor(spec.id)
    } catch (error) {
      await this.discard(spec.id)
      throw error
    }

    const enabled = template.toggles
      .filter(toggle => (spec.enable.length === 0 ? toggle.defaultOn : spec.enable.includes(toggle.id)))
      .map(toggle => toggle.id)
    return {
      id: spec.id,
      name: spec.name,
      description: spec.description,
      template: template.id,
      persona: spec.persona,
      skills: spec.skills.map(skill => ({ name: skill.name, description: skill.description })),
      enabled,
      dropped,
    }
  }

  /** Remove a generated preset, swallowing cleanup failure so it cannot mask the real error. */
  private async discard(id: string): Promise<void> {
    try {
      await this.presets()?.remove(id)
    } catch (error) {
      this.ctx.logger.warn(`harness-factory: could not remove the half-built preset "${id}"`)
      this.ctx.logger.warn(error)
    }
  }

  /**
   * Pack one harness as a standalone runnable folder.
   * @param id - the preset id to pack.
   * @returns the archive filename and bytes.
   * @throws when no roster is mounted or the preset is unknown.
   */
  async pack(id: string): Promise<HarnessPack> {
    const presets = this.presets()
    if (presets === undefined) throw new HarnessGenerationError('no agent-preset roster is mounted')
    const preset = await presets.resolve(id)
    // The phase list is the template's when this harness came from one; a
    // hand-authored preset packs fine, just without that README section.
    const template = HARNESS_TEMPLATES.find(candidate => candidate.seed === preset.id)
    return packHarness(dirname(preset.path), {
      id: preset.id,
      name: preset.name ?? preset.id,
      description: preset.description ?? `The ${preset.id} harness.`,
      phases: template?.phases ?? [],
    })
  }
}

/**
 * Validate a spec against the shipped catalog — the standalone entry point for
 * callers holding a spec from somewhere other than generation.
 * @param input - unknown value, usually parsed JSON.
 * @param taken - preset ids already on the roster.
 * @returns the validation result.
 */
export function validateSpec(input: unknown, taken: readonly string[]): ReturnType<typeof parseHarnessSpec> {
  return parseHarnessSpec(input, {
    templates: HARNESS_TEMPLATES.map(template => template.id),
    toggles: toggleAllowlist(),
    taken,
  })
}

export default HarnessFactory
