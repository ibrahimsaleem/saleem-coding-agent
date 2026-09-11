/**
 * The generation step: one bounded LLM call that turns a user's description of
 * a harness into a validated {@link HarnessSpec}.
 *
 * This follows the one-off-call pattern established by
 * `@deepseek-ai/dsh-session-title-llm` — build `GenerateOptions`, stream
 * through a `BlockAssembler`, bound the whole thing with a deadline — rather
 * than running an agent turn. Nothing here has tools, and the model's entire
 * influence on the result is the JSON object it returns, which
 * `parseHarnessSpec` then validates against the catalog.
 *
 * One repair attempt is allowed. A model that produces malformed JSON usually
 * produces valid JSON when shown the parse error, and the second call is far
 * cheaper than making the user retype their request. A second failure is
 * reported rather than retried — beyond that the problem is the prompt or the
 * model, and looping burns the user's tokens to no end.
 * @module @ibrahimsaleem/dsh-harness-factory/generate
 */

import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the Context merge declaring `agentDefaultModel`.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { parseHarnessSpec } from './spec.ts'
import type { HarnessSpecResult, SpecValidationContext } from './spec.ts'
import { HARNESS_TEMPLATES } from './templates.ts'

/** How the caller reaches a model, and what the spec is validated against. */
export interface GenerateHarnessRequest {
  /** The user's description of the harness they want. */
  readonly prompt: string
  /** Force a template instead of letting the model route. */
  readonly template?: string
  /** Facts validation checks against (catalog ids, toggle allowlist, taken ids). */
  readonly validation: SpecValidationContext
  /** Provider route; omitted means the deployment default. */
  readonly provider?: string
  /** Model id; omitted means the deployment default. */
  readonly model?: string
  /** Cancellation for the whole generation, repair attempt included. */
  readonly signal?: AbortSignal
}

/** Raised when generation cannot produce a usable spec. */
export class HarnessGenerationError extends Error {
  /** The validation problems from the final attempt, when there were any. */
  readonly problems: readonly string[]
  constructor(message: string, problems: readonly string[] = []) {
    super(`harness-factory: ${message}`)
    this.name = 'HarnessGenerationError'
    this.problems = problems
  }
}

/** Build the system prompt: the catalog, the output contract, and the quality bar. */
export function systemPrompt(taken: readonly string[], forced?: string): string {
  const catalog = HARNESS_TEMPLATES
    .filter(template => forced === undefined || template.id === forced)
    .map((template) => {
      const toggles = template.toggles.map(toggle => `${toggle.id} (${toggle.label})`).join('; ')
      return [
        `### ${template.id} — ${template.label}`,
        template.blurb,
        `Phases: ${template.phases.join(' → ')}`,
        `Toggles: ${toggles}`,
      ].join('\n')
    })
    .join('\n\n')

  return [
    'You design "harnesses" for an AI coding-agent platform. A harness is a specialized agent:',
    'a persona (its system prompt), a methodology skill (a markdown playbook it loads before working),',
    'and a set of capabilities.',
    '',
    'The user describes the harness they want. You pick the closest template and tailor it.',
    '',
    '## Templates',
    '',
    catalog,
    '',
    forced === undefined
      ? 'Pick the single closest template. Do not invent one.'
      : `The user has already chosen the "${forced}" template. Use it.`,
    '',
    '## Output contract',
    '',
    'Reply with ONE JSON object and nothing else — no prose, no markdown fence. Fields:',
    '',
    '- `template`: the catalog id you chose.',
    '- `id`: a short kebab-case id for this harness (lowercase letters, digits, dashes).',
    taken.length > 0 ? `  Already taken, pick something else: ${taken.join(', ')}.` : '',
    '- `name`: a short human title, 2-4 words.',
    '- `description`: one sentence saying what this harness does.',
    '- `persona`: the harness\'s complete system prompt. Write it in second person ("You are ...").',
    '  State what it does, tell it to load its skill before starting, and give it the rules that must',
    '  hold even before the skill loads. You may use {{model}} and {{cwd}} as placeholders.',
    '- `skills`: an array with ONE entry — the methodology playbook:',
    '    - `name`: kebab-case id, e.g. "my-review-methodology".',
    '    - `description`: one line describing when the agent should load this skill.',
    '    - `body`: the playbook in markdown. Number the phases. Say concretely what happens in each:',
    '      which tools to use, when to fan work out across parallel subagents, when to use a forked',
    '      agent to challenge a conclusion, what evidence a finding needs, and what the final',
    '      report contains. This is the most important field — make it genuinely useful, not a sketch.',
    '- `enable`: array of toggle ids to turn on. Omit or leave empty for the template defaults.',
    '',
    '## Quality bar',
    '',
    'The harness must do real work, not describe work. Its methodology should fan tasks out across',
    'parallel subagents where they are independent, use a forked agent to argue against its own',
    'findings before reporting them, and require evidence for every claim. Prefer concrete',
    'instructions over encouragement.',
  ].filter(line => line !== '').join('\n')
}

/** Pull the first balanced JSON object out of a model response. */
export function extractJson(text: string): string | undefined {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '"') { inString = !inString; continue }
    if (inString) continue
    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return undefined
}

/**
 * Resolve the route this generation runs on.
 *
 * `GenerateOptions.provider` and `.model` are REQUIRED — the llm service has no
 * "use whatever the deployment defaults to" mode, because default resolution is
 * `agentDefaultModel`'s job, not the transport's. Omitting them produces a
 * malformed request that streams nothing, which surfaces downstream as the
 * useless "the reply contained no JSON object". So resolve explicitly here and
 * fail with a sentence that names the actual problem.
 * @param ctx - context that may carry `agentDefaultModel`.
 * @param request - the caller's optional explicit route.
 * @returns the provider and model to call.
 * @throws {HarnessGenerationError} when neither config nor a default supplies a route.
 */
function resolveRoute(ctx: Context, request: GenerateHarnessRequest): { provider: string; model: string } {
  if (request.provider !== undefined && request.model !== undefined) {
    return { provider: request.provider, model: request.model }
  }
  const selection = ctx.get('agentDefaultModel')?.currentSelection()
  const provider = request.provider ?? selection?.provider
  const model = request.model ?? selection?.model
  if (provider === undefined || model === undefined || provider === '' || model === '') {
    throw new HarnessGenerationError(
      'no model route is configured — set a default model in Settings, or give the harness-factory '
      + 'plugin an explicit provider and model in its config',
    )
  }
  return { provider, model }
}

/** Run one model call and return its text. */
async function callModel(
  ctx: Context,
  system: string,
  userText: string,
  request: GenerateHarnessRequest,
): Promise<string> {
  const assembler = new BlockAssembler()
  const route = resolveRoute(ctx, request)
  for await (const chunk of ctx.llm.stream({
    provider: route.provider,
    model: route.model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    // A harness spec carries a whole persona and a methodology playbook, so the
    // default output budget is far too small — a truncated reply reads as
    // malformed JSON and burns the repair attempt on a length problem.
    maxTokens: 16_000,
    purpose: 'harness-generation',
    ...request.signal === undefined ? {} : { signal: request.signal },
  } as never)) {
    request.signal?.throwIfAborted()
    assembler.push(chunk)
  }
  const blocks = assembler.blocks()
  const text = blocks
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('')
  if (text.length === 0) {
    // Distinguish "the model said nothing" from "the model said something
    // unusable" — they have completely different causes and fixes.
    const kinds = [...new Set(blocks.map(block => block.type))]
    throw new HarnessGenerationError(
      `the model returned no text on route ${route.provider}/${route.model}`
      + (kinds.length > 0 ? ` (blocks: ${kinds.join(', ')})` : ' (no blocks at all)'),
    )
  }
  return text
}

/**
 * Generate one harness spec from a natural-language description.
 * @param ctx - context carrying `ctx.llm`.
 * @param request - the prompt, optional forced template, and validation facts.
 * @returns the validated spec and any toggles that were dropped.
 * @throws {HarnessGenerationError} when two attempts fail to produce a valid spec.
 */
export async function generateHarnessSpec(
  ctx: Context,
  request: GenerateHarnessRequest,
): Promise<Extract<HarnessSpecResult, { ok: true }>> {
  const system = systemPrompt(request.validation.taken, request.template)
  let userText = request.prompt
  let lastProblems: readonly string[] = []

  // Two attempts: the first from the user's description, the second shown
  // exactly what was wrong with the first. See the module note on why not more.
  for (let attempt = 0; attempt < 2; attempt++) {
    request.signal?.throwIfAborted()
    const text = await callModel(ctx, system, userText, request)
    const json = extractJson(text)
    if (json === undefined) {
      lastProblems = ['the reply contained no JSON object']
    } else {
      let parsed: unknown
      try {
        parsed = JSON.parse(json)
      } catch (error) {
        lastProblems = [`the reply was not valid JSON: ${error instanceof Error ? error.message : String(error)}`]
        parsed = undefined
      }
      if (parsed !== undefined) {
        const result = parseHarnessSpec(parsed, request.validation)
        if (result.ok) return result
        lastProblems = result.problems
      }
    }
    userText = [
      request.prompt,
      '',
      'Your previous reply could not be used. Fix exactly these problems and reply with the',
      'corrected JSON object only:',
      ...lastProblems.map(problem => `- ${problem}`),
    ].join('\n')
  }

  // The problems ARE the message. A bare "it did not work" leaves the user with
  // nothing to change about their prompt and leaves whoever is debugging the
  // model route guessing; the reasons are short, specific, and the only part of
  // this failure worth reading.
  throw new HarnessGenerationError(
    `the model did not produce a usable harness specification after two attempts: ${lastProblems.join('; ')}`,
    lastProblems,
  )
}
