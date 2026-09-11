import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseDocument, isMap, isSeq } from 'yaml'
import { renderComposition, renderHarness, renderSkillMarkdown, HarnessRenderError } from '../src/render.ts'
import { findTemplate } from '../src/templates.ts'
import type { HarnessSpec } from '../src/spec.ts'

const TEMPLATE = findTemplate('security')!

const SPEC: HarnessSpec = {
  template: 'security',
  id: 'my-scanner',
  name: 'My Scanner',
  description: 'Scans a repo for problems.',
  persona: 'You are My Scanner.\n\nYou find bugs and prove them.',
  skills: [{ name: 'scan-methodology', description: 'When to scan.', body: '# Scan\n\n1. Look.\n2. Prove.' }],
  enable: [],
}

/** A composition shaped like the shipped templates: nested groups included. */
const COMPOSITION = `- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      Original persona text.

- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetch: false

- id: no-config-row
  name: '@deepseek-ai/dsh-tool-jobs'

- id: null-config-row
  name: '@deepseek-ai/dsh-tool-goal'
  config:

- id: delegation
  name: cordis:group
  group: true
  isolate:
    workflowEngine: true
  config:
    - id: tool-subagent
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn

    - id: tool-ralph
      name: '@deepseek-ai/dsh-tool-ralph'
`

const made: string[] = []
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-render-'))
  made.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('renderComposition', () => {
  it('replaces the persona text and leaves every other row intact', () => {
    const out = renderComposition(COMPOSITION, SPEC, TEMPLATE)
    const doc = parseDocument(out)
    expect(isSeq(doc.contents)).toBe(true)
    const rows = (doc.contents as { items: unknown[] }).items
    // Same number of top-level rows: rendering never adds or removes one.
    expect(rows).toHaveLength(5)
    expect(out).toContain('You are My Scanner.')
    expect(out).not.toContain('Original persona text.')
    // The plugin specifiers are untouched — the row graph is the template's.
    expect(out).toContain("name: '@deepseek-ai/dsh-tool-web'")
    expect(out).toContain('isolate:')
    expect(out).toContain('workflowEngine: true')
  })

  it('never introduces a !!js tag', () => {
    const out = renderComposition(COMPOSITION, { ...SPEC, persona: '!!js process.exit(1)' }, TEMPLATE)
    // The persona is a scalar, so a !!js-looking string stays a quoted string.
    const doc = parseDocument(out)
    const persona = (doc.contents as { items: { get(k: string, keep?: boolean): unknown }[] }).items[0]!
    const config = persona.get('config', true) as { get(k: string): unknown }
    expect(config.get('text')).toBe('!!js process.exit(1)')
  })

  it('flips only the rows a toggle names, at any nesting depth', () => {
    const out = renderComposition(COMPOSITION, { ...SPEC, enable: ['web-search'] }, TEMPLATE)
    const doc = parseDocument(out)
    const rowById = (id: string): { get(k: string): unknown } | undefined => {
      let found: { get(k: string): unknown } | undefined
      const walk = (seq: { items: unknown[] }): void => {
        for (const item of seq.items) {
          if (!isMap(item)) continue
          if (item.get('id') === id) found ??= item as never
          const nested = item.get('config', true)
          if (isSeq(nested)) walk(nested)
        }
      }
      walk(doc.contents as never)
      return found
    }
    // web-search was requested, so tool-web stays on.
    expect(rowById('tool-web')?.get('disabled')).toBeUndefined()
    // ralph was NOT requested, and a non-empty enable list is exhaustive.
    expect(rowById('tool-ralph')?.get('disabled')).toBe(true)
    // A nested row the toggle list names is reached through the group.
    expect(rowById('tool-subagent')?.get('disabled')).toBe(true)
  })

  it('applies template defaults when the spec names no toggles', () => {
    const out = renderComposition(COMPOSITION, { ...SPEC, enable: [] }, TEMPLATE)
    // Every shipped toggle defaults on, so nothing is disabled.
    expect(out).not.toContain('disabled: true')
  })

  it('vivifies a config: key whose value is null (the setIn trap)', () => {
    // `null-config-row` has a bare `config:`; a naive setIn would throw
    // "Expected YAML collection at config".
    const spec = { ...SPEC, enable: ['web-search'] }
    const out = renderComposition(COMPOSITION, spec, TEMPLATE)
    expect(out).toContain('null-config-row')
  })

  it('throws when the template has no persona row', () => {
    expect(() => renderComposition('- id: other\n  name: x\n', SPEC, TEMPLATE))
      .toThrow(HarnessRenderError)
  })

  it('throws when the composition is not a row list', () => {
    expect(() => renderComposition('just: a map\n', SPEC, TEMPLATE)).toThrow(HarnessRenderError)
  })
})

describe('renderSkillMarkdown', () => {
  it('emits frontmatter the skill loader can read', () => {
    const md = renderSkillMarkdown('my-skill', 'Use when scanning.', '# Body\n\ntext')
    expect(md.startsWith('---\nname: my-skill\ndescription: Use when scanning.\n---\n')).toBe(true)
    expect(md).toContain('# Body')
  })

  it('folds a multi-line description onto one line so frontmatter stays valid', () => {
    const md = renderSkillMarkdown('s', 'line one\nline two\n\nline three', 'body')
    expect(md).toContain('description: line one line two line three\n')
    expect(md.split('---')[1]!.trim().split('\n')).toHaveLength(2)
  })
})

describe('renderHarness', () => {
  it('writes the composition, metadata and skills into the preset directory', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'agent.cordis.yml'), COMPOSITION, 'utf8')
    await renderHarness(dir, SPEC, TEMPLATE, 42)

    expect(readFileSync(join(dir, 'agent.cordis.yml'), 'utf8')).toContain('You are My Scanner.')
    const meta = readFileSync(join(dir, 'preset.yml'), 'utf8')
    expect(meta).toContain('name: "My Scanner"')
    expect(meta).toContain('order: 42')
    const skill = readFileSync(join(dir, 'skills', 'scan-methodology', 'SKILL.md'), 'utf8')
    expect(skill).toContain('name: scan-methodology')
    expect(skill).toContain('1. Look.')
  })

  it('replaces a template skill file rather than appending to it', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'agent.cordis.yml'), COMPOSITION, 'utf8')
    mkdirSync(join(dir, 'skills', 'scan-methodology'), { recursive: true })
    writeFileSync(join(dir, 'skills', 'scan-methodology', 'SKILL.md'), 'OLD CONTENT', 'utf8')
    await renderHarness(dir, SPEC, TEMPLATE, 1)
    const skill = readFileSync(join(dir, 'skills', 'scan-methodology', 'SKILL.md'), 'utf8')
    expect(skill).not.toContain('OLD CONTENT')
  })

  it('refuses a skill name that is not a safe directory name', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'agent.cordis.yml'), COMPOSITION, 'utf8')
    const bad = { ...SPEC, skills: [{ name: '../escaped', description: 'd', body: 'b' }] }
    await expect(renderHarness(dir, bad, TEMPLATE, 1)).rejects.toThrow(HarnessRenderError)
  })
})
