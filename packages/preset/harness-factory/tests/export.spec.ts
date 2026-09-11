/**
 * The packed harness must be a real, relocatable folder — the download is
 * worthless if the archive is missing the preset, or if the unzipped copy
 * cannot find its own skills on another machine.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { packHarness, packManifest, packReadme, packSettings } from '../src/export.ts'

const made: string[] = []
function presetDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-pack-'))
  made.push(root)
  mkdirSync(join(root, 'skills', 'my-methodology'), { recursive: true })
  writeFileSync(join(root, 'agent.cordis.yml'), '- id: persona\n  name: x\n', 'utf8')
  writeFileSync(join(root, 'preset.yml'), 'name: "My Harness"\n', 'utf8')
  writeFileSync(join(root, 'skills', 'my-methodology', 'SKILL.md'), '---\nname: my-methodology\n---\n\nBody.\n', 'utf8')
  return root
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('packHarness', () => {
  it('produces an archive holding the preset, settings, launchers and README', async () => {
    const pack = await packHarness(presetDir(), {
      id: 'my-harness',
      name: 'My Harness',
      description: 'Does a thing.',
      phases: ['Scope', 'Scan', 'Report'],
    })
    const entries = unzipSync(pack.bytes)
    const names = Object.keys(entries).sort()

    expect(names).toEqual([
      'my-harness/.dsh/.agent-presets/my-harness/agent.cordis.yml',
      'my-harness/.dsh/.agent-presets/my-harness/preset.yml',
      'my-harness/.dsh/.agent-presets/my-harness/skills/my-methodology/SKILL.md',
      'my-harness/.dsh/settings.yaml',
      'my-harness/README.md',
      'my-harness/package.json',
      'my-harness/run.cmd',
      'my-harness/run.sh',
    ])
  })

  it('round-trips the preset files byte for byte', async () => {
    const dir = presetDir()
    const pack = await packHarness(dir, { id: 'my-harness', name: 'My Harness', description: 'd' })
    const entries = unzipSync(pack.bytes)
    const skill = entries['my-harness/.dsh/.agent-presets/my-harness/skills/my-methodology/SKILL.md']
    expect(strFromU8(skill!)).toBe('---\nname: my-methodology\n---\n\nBody.\n')
  })

  it('nests the whole payload under one folder so unzipping never litters', async () => {
    const pack = await packHarness(presetDir(), { id: 'my-harness', name: 'n', description: 'd' })
    for (const name of Object.keys(unzipSync(pack.bytes))) {
      expect(name.startsWith('my-harness/')).toBe(true)
    }
  })

  it('names the archive after the harness', async () => {
    const pack = await packHarness(presetDir(), { id: 'abc', name: 'n', description: 'd' })
    expect(pack.filename).toBe('abc-harness.zip')
  })
})

describe('packed files', () => {
  it('points the settings default at this harness, so it opens on itself', () => {
    expect(packSettings('my-harness')).toContain('default: my-harness')
  })

  it('keeps the packed harness sandboxed by default', () => {
    expect(packSettings('x')).toContain('mode: workspace-write')
  })

  it('writes a manifest naming the CLI the launcher needs', () => {
    const manifest = JSON.parse(packManifest('my-harness', 'Does a thing.')) as {
      name: string
      dependencies: Record<string, string>
    }
    expect(manifest.name).toBe('my-harness')
    expect(manifest.dependencies['saleem-harness-cli']).toBeDefined()
  })

  it('tells the reader plainly that the runtime is not in the box', () => {
    // The one thing this README must not do is imply the zip is self-sufficient.
    const readme = packReadme('my-harness', 'My Harness', 'Does a thing.', [])
    expect(readme).toContain('not the harness runtime')
  })

  it('lists the phases when the harness came from a template', () => {
    const readme = packReadme('h', 'H', 'd', ['Scope', 'Scan'])
    expect(readme).toContain('1. Scope')
    expect(readme).toContain('2. Scan')
  })

  it('omits the phase section when there are none, rather than printing an empty heading', () => {
    expect(packReadme('h', 'H', 'd', [])).not.toContain('## How it works')
  })
})
