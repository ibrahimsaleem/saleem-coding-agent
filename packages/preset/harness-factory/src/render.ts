/**
 * Applies a validated {@link HarnessSpec} to a preset directory that
 * `agentPresets.copy()` has already created.
 *
 * This is the whole write surface of the factory, and it is deliberately
 * narrow. It touches exactly four things:
 *   - `persona.config.text` — a string scalar,
 *   - `disabled:` on rows the template's own toggle allowlist names,
 *   - `skills/<name>/SKILL.md` — markdown,
 *   - `preset.yml` — display text.
 *
 * It never adds, removes or reorders a composition row, never writes a `name:`
 * (the plugin specifier), and never introduces a `!!js` tag. The row graph that
 * mounts is the template's, byte for byte apart from the two scalar edits
 * above. That is the property that lets the factory promise a generated
 * harness runs.
 * @module @ibrahimsaleem/dsh-harness-factory/render
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { Document, isMap, isSeq, parseDocument } from 'yaml'
import type { Node, YAMLMap, YAMLSeq } from 'yaml'
import { HARNESS_ID } from './spec.ts'
import type { HarnessSpec } from './spec.ts'
import type { HarnessTemplate } from './templates.ts'

/** Raised when the copied template does not look like the composition we expect. */
export class HarnessRenderError extends Error {
  constructor(message: string) {
    super(`harness-factory: ${message}`)
    this.name = 'HarnessRenderError'
  }
}

/**
 * Walk every row in a composition, descending into `cordis:group` rows' nested
 * `config` lists, and hand each row map to `visit`. Group nesting is how the
 * realm-carrying rows (`planning`, `compaction`, `delegation`) hold the rows a
 * toggle actually names, so a flat scan would miss most of them.
 * @param seq - the composition's top-level row sequence.
 * @param visit - called once per row map, at any depth.
 */
function walkRows(seq: YAMLSeq, visit: (row: YAMLMap) => void): void {
  for (const item of seq.items) {
    if (!isMap(item)) continue
    visit(item)
    const nested = item.get('config', true) as Node | undefined
    if (isSeq(nested)) walkRows(nested, visit)
  }
}

/**
 * Find one row by its `id`, at any nesting depth.
 * @param seq - the composition's top-level row sequence.
 * @param id - the row id to match.
 * @returns the row map, or undefined when the composition carries no such row.
 */
function findRow(seq: YAMLSeq, id: string): YAMLMap | undefined {
  let found: YAMLMap | undefined
  walkRows(seq, (row) => {
    if (found === undefined && row.get('id') === id) found = row
  })
  return found
}

/**
 * Ensure a row has a `config:` MAP and return it.
 *
 * `Document.setIn` auto-vivifies only wholly-absent path segments; an existing
 * key whose value is a null scalar (`config:` with nothing under it) makes it
 * throw instead. And a plain object handed to `set` is not a YAMLMap node —
 * `createNode` is what produces one. Both traps were hit for real in
 * `credentials-local` and cost a debugging session each; this helper is where
 * that lesson lives now.
 * @param document - the composition document, the node factory for new maps.
 * @param row - the row gaining a config map.
 * @returns the row's config map, created when it was absent or null.
 */
function ensureConfigMap(document: Document, row: YAMLMap): YAMLMap {
  const existing = row.get('config', true) as Node | undefined
  if (isMap(existing)) return existing
  const created = document.createNode({}) as YAMLMap
  row.set('config', created)
  return created
}

/**
 * Rewrite the persona row's prompt text and flip the allowlisted toggles.
 * @param text - the copied composition file's contents.
 * @param spec - the validated spec being applied.
 * @param template - the template the copy came from; its toggles are the allowlist.
 * @returns the rewritten composition text.
 * @throws {HarnessRenderError} when the composition has no row sequence or no persona row.
 */
export function renderComposition(text: string, spec: HarnessSpec, template: HarnessTemplate): string {
  const document = parseDocument(text)
  const root = document.contents
  if (!isSeq(root)) {
    throw new HarnessRenderError('template composition is not a list of plugin rows')
  }

  const persona = findRow(root, 'persona')
  if (persona === undefined) {
    throw new HarnessRenderError('template composition has no row with id "persona"')
  }
  // A block scalar keeps the prompt readable in the file a user may later open
  // and edit by hand — the same shape every shipped preset uses.
  const personaConfig = ensureConfigMap(document, persona)
  const personaText = document.createNode(spec.persona) as Node & { type?: string }
  personaText.type = 'BLOCK_FOLDED'
  personaConfig.set('text', personaText)

  // Toggles: `disabled` is the only key touched, and only on rows the template
  // names. A toggle whose row is missing from the composition is a template
  // authoring mistake, not a user-facing failure — it is reported, not thrown,
  // because refusing to build an otherwise-valid harness over one absent
  // optional row would be the worse outcome.
  for (const toggle of template.toggles) {
    const row = findRow(root, toggle.row)
    if (row === undefined) continue
    const on = spec.enable.length === 0 ? toggle.defaultOn : spec.enable.includes(toggle.id)
    if (on) row.delete('disabled')
    else row.set('disabled', true)
  }

  return document.toString()
}

/** Render one skill's `SKILL.md`, frontmatter included. */
export function renderSkillMarkdown(name: string, description: string, body: string): string {
  // The description is a single frontmatter line: newlines would terminate the
  // key and silently truncate what the catalog shows.
  const oneLine = description.replace(/\s+/gu, ' ').trim()
  return `---\nname: ${name}\ndescription: ${oneLine}\n---\n\n${body.trimEnd()}\n`
}

/** Render the roster metadata file. `copy()` drops `name`/`order`, so this restores them. */
export function renderPresetMetadata(spec: HarnessSpec, order: number): string {
  const oneLine = (value: string): string => JSON.stringify(value.replace(/\s+/gu, ' ').trim())
  return `name: ${oneLine(spec.name)}\ndescription: ${oneLine(spec.description)}\norder: ${String(order)}\n`
}

/**
 * Resolve a path inside the preset directory, refusing anything that escapes it.
 *
 * Skill names are already constrained to {@link HARNESS_ID}, which admits no
 * separator and no dot, so this cannot currently fail — it is the second lock
 * on a door that opens onto arbitrary filesystem writes, and it stays because
 * the first lock is one regex edit away from being loosened.
 */
function containedPath(root: string, ...segments: string[]): string {
  const target = resolve(root, ...segments)
  const base = resolve(root)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new HarnessRenderError(`refusing to write outside the preset directory: ${target}`)
  }
  return target
}

/**
 * Apply a validated spec to the copied preset directory, in place.
 * @param presetDir - the copy's directory (the parent of its `agent.cordis.yml`).
 * @param spec - the validated spec.
 * @param template - the template the copy came from.
 * @param order - roster sort order for the generated preset.
 * @throws {HarnessRenderError} when the copied composition is not the expected shape.
 */
export async function renderHarness(
  presetDir: string,
  spec: HarnessSpec,
  template: HarnessTemplate,
  order: number,
): Promise<void> {
  const compositionPath = join(presetDir, 'agent.cordis.yml')
  const original = await readFile(compositionPath, 'utf8')
  await writeFile(compositionPath, renderComposition(original, spec, template), 'utf8')

  await writeFile(join(presetDir, 'preset.yml'), renderPresetMetadata(spec, order), 'utf8')

  for (const skill of spec.skills) {
    if (!HARNESS_ID.test(skill.name)) {
      throw new HarnessRenderError(`skill name "${skill.name}" is not a valid directory name`)
    }
    const target = containedPath(presetDir, 'skills', skill.name, 'SKILL.md')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, renderSkillMarkdown(skill.name, skill.description, skill.body), 'utf8')
  }
}
