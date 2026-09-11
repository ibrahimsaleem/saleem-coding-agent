/**
 * The build pipeline end to end: copy a template, render a spec into the copy,
 * and MOUNT the result before reporting success.
 *
 * The mount probe is the claim this file exists to check. Nothing else in the
 * preset system mounts a composition before a session needs it, so without
 * these tests "a generated harness runs" would be an assertion about code that
 * had never been run.
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { beforeEach, describe, expect, it } from 'vitest'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import { HarnessFactory } from '../src/index.ts'
import type { HarnessSpec } from '../src/spec.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/**
 * A template stand-in. The shipped compositions name real `@deepseek-ai/*`
 * plugins whose mounts want a whole host around them, so these fixtures use a
 * trivial do-nothing plugin instead: what is under test is the factory's
 * pipeline — copy, render, mount, roll back — not the shipped plugins.
 *
 * The specifier is ABSOLUTE on purpose. A relative specifier in a composition
 * resolves against the preset's OWN directory, so once the factory copies a
 * template into the user root, `../plugins/noop.js` points beside the COPY
 * rather than beside the fixtures. That is correct behaviour, and the trap
 * these tests hit on their first run.
 */
const NOOP = pathToFileURL(join(FIXTURES, 'plugins', 'noop.js')).href

const TEMPLATE_COMPOSITION = `- id: persona
  name: '${NOOP}'
  config:
    text: >-
      Template persona.

- id: tool-web
  name: '${NOOP}'

- id: tool-ralph
  name: '${NOOP}'
`

let ctx: Context
let userRoot: string
let systemRoot: string
let factory: HarnessFactory

function spec(overrides: Partial<HarnessSpec> = {}): HarnessSpec {
  return {
    template: 'security',
    id: 'built-harness',
    name: 'Built Harness',
    description: 'A harness built by the factory.',
    persona: 'You are the built harness.',
    skills: [{ name: 'built-methodology', description: 'When to use it.', body: '# Method\n\n1. Do the thing.' }],
    enable: [],
    ...overrides,
  }
}

beforeEach(async () => {
  systemRoot = await mkdtemp(join(tmpdir(), 'harness-system-'))
  userRoot = await mkdtemp(join(tmpdir(), 'harness-user-'))
  // The seed id must match the catalog's `security` template seed.
  await mkdir(join(systemRoot, 'harness-security'), { recursive: true })
  await writeFile(join(systemRoot, 'harness-security', 'agent.cordis.yml'), TEMPLATE_COMPOSITION)
  await mkdir(join(systemRoot, 'harness-security', 'skills', 'security-review-methodology'), { recursive: true })
  await writeFile(
    join(systemRoot, 'harness-security', 'skills', 'security-review-methodology', 'SKILL.md'),
    '---\nname: security-review-methodology\ndescription: seed\n---\n\nSeed body.\n',
  )

  ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(AgentPresets, {
    default: 'harness-security',
    roots: [
      { path: systemRoot, trust: 'system' as const },
      { path: userRoot, trust: 'user' as const },
    ],
    includeUserRoot: false,
  })
  factory = new HarnessFactory(ctx, { order: 100 })
})

describe('HarnessFactory.build', () => {
  it('copies the template, renders the spec into it, and mounts the result', async () => {
    const built = await factory.build(spec())

    expect(built.id).toBe('built-harness')
    expect(built.template).toBe('security')

    const dir = join(userRoot, 'built-harness')
    const composition = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')
    expect(composition).toContain('You are the built harness.')
    expect(composition).not.toContain('Template persona.')

    const skill = await readFile(join(dir, 'skills', 'built-methodology', 'SKILL.md'), 'utf8')
    expect(skill).toContain('1. Do the thing.')

    const meta = await readFile(join(dir, 'preset.yml'), 'utf8')
    expect(meta).toContain('Built Harness')

    // It is on the roster and not marked broken — discovery re-reads on every call.
    const roster = await ctx.agentPresets.list()
    const entry = roster.find(preset => preset.id === 'built-harness')
    expect(entry).toBeDefined()
    expect(entry?.broken).toBeUndefined()
  })

  it('carries the template skill through when the spec does not replace it', async () => {
    await factory.build(spec({ skills: [] }))
    const seeded = join(userRoot, 'built-harness', 'skills', 'security-review-methodology', 'SKILL.md')
    expect(existsSync(seeded)).toBe(true)
  })

  it('reports which requested capabilities the template could not give', async () => {
    const built = await factory.build(spec(), ['become-root'])
    expect(built.dropped).toEqual(['become-root'])
  })

  it('leaves NO preset behind when the composition cannot mount', async () => {
    // A template whose row names a plugin that does not exist: the copy and the
    // render both succeed, and only the mount probe catches it. This is exactly
    // the failure that used to reach the user as a broken roster row.
    await writeFile(
      join(systemRoot, 'harness-security', 'agent.cordis.yml'),
      '- id: persona\n  name: ../plugins/does-not-exist.js\n',
    )

    await expect(factory.build(spec())).rejects.toThrow()
    expect(existsSync(join(userRoot, 'built-harness')), 'the half-built preset must be removed').toBe(false)
    const roster = await ctx.agentPresets.list()
    expect(roster.some(preset => preset.id === 'built-harness')).toBe(false)
  })

  it('rolls back when the template has no persona row to rewrite', async () => {
    await writeFile(
      join(systemRoot, 'harness-security', 'agent.cordis.yml'),
      '- id: not-persona\n  name: ../plugins/noop.js\n',
    )
    await expect(factory.build(spec())).rejects.toThrow(/persona/u)
    expect(existsSync(join(userRoot, 'built-harness'))).toBe(false)
  })

  it('refuses an id that is already on the roster', async () => {
    await expect(factory.build(spec({ id: 'harness-security' }))).rejects.toThrow()
  })

  it('refuses a template that is not in the catalog', async () => {
    await expect(factory.build(spec({ template: 'nonsense' }))).rejects.toThrow(/unknown template/u)
  })
})

describe('HarnessFactory.pack', () => {
  it('packs a built harness into a standalone folder', async () => {
    await factory.build(spec())
    const pack = await factory.pack('built-harness')

    expect(pack.filename).toBe('built-harness-harness.zip')
    expect(pack.bytes.byteLength).toBeGreaterThan(0)
    // ZIP local file header magic: the bytes really are an archive.
    expect(Array.from(pack.bytes.slice(0, 4))).toEqual([0x50, 0x4B, 0x03, 0x04])
  })
})
