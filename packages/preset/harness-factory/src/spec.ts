/**
 * The `HarnessSpec`: the ONLY thing a model is allowed to produce when a
 * harness is generated, and the reason the factory can promise that a
 * generated harness mounts.
 *
 * Preset authoring in this harness is deliberately copy-only
 * (`.agents/notes/implemented/simplification/2026-08-08-copy-only-preset-authoring.md`):
 * `agentPreset.write` was removed because the composition dialect includes
 * `!!js`, so "shape-checked composition text" is still arbitrary code at the
 * next mount. A generator that emitted composition YAML would re-open exactly
 * that hole.
 *
 * So the model never writes composition. It writes THIS — inert data with no
 * code, no paths, no plugin names, no row ids it invented — and the factory
 * applies it to a copy of a known-good template whose row graph a human already
 * proved. Everything here lands in a string field (a persona, a markdown
 * skill body, a description) or is checked against the template's own
 * allowlist and dropped when it does not match.
 *
 * Validation is deliberately total: `parseHarnessSpec` accepts unknown input
 * and either returns a fully-typed spec or a list of human-readable problems
 * the generator can be re-prompted with.
 * @module @ibrahimsaleem/dsh-harness-factory/spec
 */

/** Ids the roster accepts as a preset directory name (mirrors `PRESET_ID` in dsh-agent-presets). */
export const HARNESS_ID = /^[a-z0-9][a-z0-9-]*$/u

/** Upper bounds. Generous for real content, bounded so one response cannot fill a disk. */
const LIMITS = {
  id: 48,
  name: 80,
  description: 400,
  persona: 12_000,
  skillName: 64,
  skillDescription: 600,
  skillBody: 60_000,
  skills: 4,
  enable: 32,
} as const

/** One generated skill: becomes `skills/<name>/SKILL.md` inside the preset directory. */
export interface HarnessSkillSpec {
  /** Skill id and directory name; also the frontmatter `name`. */
  readonly name: string
  /** Frontmatter `description` — what the catalog shows and how the model decides to load it. */
  readonly description: string
  /** The markdown body beneath the frontmatter. */
  readonly body: string
}

/** A complete, validated description of one harness to build from a template. */
export interface HarnessSpec {
  /** Which template's row graph to copy. Must be a catalog id. */
  readonly template: string
  /** The new preset's id (its directory name). */
  readonly id: string
  /** Display name for the roster. */
  readonly name: string
  /** One-line description for the roster. */
  readonly description: string
  /** Replaces `persona.config.text` in the copied composition. */
  readonly persona: string
  /** Written into the copy's `skills/` directory. */
  readonly skills: readonly HarnessSkillSpec[]
  /**
   * Optional row toggles, by template-allowlisted toggle id. Entries the
   * template does not name are DROPPED by {@link parseHarnessSpec} rather than
   * honoured — the allowlist is the authority, never the model's output.
   */
  readonly enable: readonly string[]
}

/** A validation outcome: either a usable spec, or the problems to re-prompt with. */
export type HarnessSpecResult =
  | { readonly ok: true; readonly spec: HarnessSpec; readonly dropped: readonly string[] }
  | { readonly ok: false; readonly problems: readonly string[] }

/** What the caller must tell the validator about the chosen template. */
export interface SpecValidationContext {
  /** Every template id the catalog offers. */
  readonly templates: readonly string[]
  /** Toggle ids the chosen template permits, by template id. */
  readonly toggles: Readonly<Record<string, readonly string[]>>
  /** Preset ids already on the roster; a collision is a validation problem, not a crash later. */
  readonly taken: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one required string field, enforcing presence, type, non-emptiness and
 * a length bound in one place so every field reports the same way.
 *
 * `key` and `label` are separate because nested fields report as
 * `skills[0].name` — a path for the human reading the problem — while the
 * lookup is still the plain property `name` on the nested object.
 * @param source - the object being validated.
 * @param key - the property to read.
 * @param label - how the field is named in problem text.
 * @param max - inclusive maximum length in characters.
 * @param problems - accumulator the caller re-prompts the generator with.
 * @returns the trimmed value, or undefined when the field was unusable.
 */
function readString(
  source: Record<string, unknown>,
  key: string,
  label: string,
  max: number,
  problems: string[],
): string | undefined {
  const raw = source[key]
  if (raw === undefined || raw === null) {
    problems.push(`"${label}" is required`)
    return undefined
  }
  if (typeof raw !== 'string') {
    problems.push(`"${label}" must be a string, got ${Array.isArray(raw) ? 'array' : typeof raw}`)
    return undefined
  }
  const value = raw.trim()
  if (value.length === 0) {
    problems.push(`"${label}" must not be empty`)
    return undefined
  }
  if (value.length > max) {
    problems.push(`"${label}" must be at most ${String(max)} characters, got ${String(value.length)}`)
    return undefined
  }
  return value
}

/**
 * Validate one generated skill entry. The name doubles as a directory name, so
 * it is held to the same character class as a preset id — that rejects
 * traversal (`..`), separators, and absolute paths by construction rather than
 * by blocklist.
 */
function readSkill(raw: unknown, index: number, problems: string[]): HarnessSkillSpec | undefined {
  if (!isRecord(raw)) {
    problems.push(`"skills[${String(index)}]" must be an object`)
    return undefined
  }
  const before = problems.length
  const at = `skills[${String(index)}]`
  const name = readString(raw, 'name', `${at}.name`, LIMITS.skillName, problems)
  const description = readString(raw, 'description', `${at}.description`, LIMITS.skillDescription, problems)
  const body = readString(raw, 'body', `${at}.body`, LIMITS.skillBody, problems)
  if (name === undefined || description === undefined || body === undefined) return undefined
  if (!HARNESS_ID.test(name)) {
    problems.push(
      `"skills[${String(index)}].name" must match ${String(HARNESS_ID)} `
      + '(lowercase letters, digits and dashes; it becomes a directory name)',
    )
    return undefined
  }
  return problems.length === before ? { name, description, body } : undefined
}

/**
 * Validate unknown input — typically one model response parsed from JSON —
 * into a {@link HarnessSpec}.
 *
 * Unknown `enable` entries are reported as `dropped` rather than as problems:
 * a model naming a capability the template does not offer is asking for
 * something reasonable that this template cannot give, and failing the whole
 * generation over it would be worse than building the harness without it. The
 * caller surfaces the dropped list so the user learns what did not happen.
 * @param input - unknown value, usually `JSON.parse` of a model response.
 * @param context - the catalog facts validation is checked against.
 * @returns the validated spec plus dropped toggles, or the problems to re-prompt with.
 */
export function parseHarnessSpec(input: unknown, context: SpecValidationContext): HarnessSpecResult {
  const problems: string[] = []
  if (!isRecord(input)) {
    return { ok: false, problems: [`expected a JSON object, got ${Array.isArray(input) ? 'array' : typeof input}`] }
  }

  const template = readString(input, 'template', 'template', 64, problems)
  if (template !== undefined && !context.templates.includes(template)) {
    problems.push(`"template" must be one of: ${context.templates.join(', ')}`)
  }

  const id = readString(input, 'id', 'id', LIMITS.id, problems)
  if (id !== undefined && !HARNESS_ID.test(id)) {
    problems.push(`"id" must match ${String(HARNESS_ID)} (lowercase letters, digits and dashes)`)
  } else if (id !== undefined && context.taken.includes(id)) {
    problems.push('"id" is already taken by an existing preset; choose another')
  }

  const name = readString(input, 'name', 'name', LIMITS.name, problems)
  const description = readString(input, 'description', 'description', LIMITS.description, problems)
  const persona = readString(input, 'persona', 'persona', LIMITS.persona, problems)

  const skills: HarnessSkillSpec[] = []
  const rawSkills = input['skills'] ?? []
  if (!Array.isArray(rawSkills)) {
    problems.push('"skills" must be an array')
  } else if (rawSkills.length > LIMITS.skills) {
    problems.push(`"skills" must hold at most ${String(LIMITS.skills)} entries, got ${String(rawSkills.length)}`)
  } else {
    for (const [index, raw] of rawSkills.entries()) {
      const skill = readSkill(raw, index, problems)
      if (skill !== undefined) skills.push(skill)
    }
    const names = skills.map(skill => skill.name)
    const duplicate = names.find((value, index) => names.indexOf(value) !== index)
    if (duplicate !== undefined) problems.push(`"skills" contains two entries named "${duplicate}"`)
  }

  // Toggles are checked against the TEMPLATE's allowlist, so this can only run
  // once the template resolved. An unknown template already failed above.
  const enable: string[] = []
  const dropped: string[] = []
  const rawEnable = input['enable'] ?? []
  if (!Array.isArray(rawEnable)) {
    problems.push('"enable" must be an array of strings')
  } else if (rawEnable.length > LIMITS.enable) {
    problems.push(`"enable" must hold at most ${String(LIMITS.enable)} entries`)
  } else if (template !== undefined) {
    const allowed = context.toggles[template] ?? []
    for (const raw of rawEnable) {
      if (typeof raw !== 'string') {
        problems.push('"enable" entries must be strings')
        continue
      }
      const value = raw.trim()
      if (value.length === 0) continue
      if (allowed.includes(value)) {
        if (!enable.includes(value)) enable.push(value)
      } else if (!dropped.includes(value)) {
        dropped.push(value)
      }
    }
  }

  if (problems.length > 0) return { ok: false, problems }
  // Every field is defined here: each undefined path above pushed a problem,
  // and problems is empty. The assertions record that, without re-checking.
  return {
    ok: true,
    dropped,
    spec: {
      template: template as string,
      id: id as string,
      name: name as string,
      description: description as string,
      persona: persona as string,
      skills,
      enable,
    },
  }
}
