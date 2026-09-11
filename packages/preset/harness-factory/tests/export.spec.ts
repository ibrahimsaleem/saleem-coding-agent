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
import {
  HARNESS_RUNTIME_REPO, packHarness, packLauncherCmd, packLauncherSh, packManifest, packReadme, packSettings,
} from '../src/export.ts'

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

  it('writes a manifest that identifies the folder without inventing a dependency', () => {
    const manifest = JSON.parse(packManifest('my-harness', 'Does a thing.')) as {
      name: string
      private: boolean
      scripts: Record<string, string>
      dependencies?: Record<string, string>
    }
    expect(manifest.name).toBe('my-harness')
    expect(manifest.private).toBe(true)
    expect(manifest.scripts['start']).toContain('runtime')
    // Deliberately NO dependency on the CLI: it is not published, so declaring
    // it would make `npm install` here fail and send the reader chasing a
    // registry that has nothing for them. The launcher resolves the runtime.
    expect(manifest.dependencies).toBeUndefined()
  })

  it('tells a bootstrap reader plainly that the runtime is not in the box', () => {
    // The one thing this README must not do is imply the small zip is self-sufficient.
    const readme = packReadme('my-harness', 'My Harness', 'Does a thing.', [], 'bootstrap')
    expect(readme).toContain('not** in this archive')
    expect(readme).toContain('pnpm')
  })

  it('tells a bundled reader the runtime IS included, and which platform it was built for', () => {
    const readme = packReadme('h', 'H', 'd', [], 'bundled', 'win32-x64')
    expect(readme).toContain('runtime is included')
    expect(readme).toContain('win32-x64')
    // The platform caveat is the honest half; losing it would make the pack
    // look portable when its native modules are not.
    expect(readme).toContain('platform-specific')
  })

  it('lists the phases when the harness came from a template', () => {
    const readme = packReadme('h', 'H', 'd', ['Scope', 'Scan'], 'bootstrap')
    expect(readme).toContain('1. Scope')
    expect(readme).toContain('2. Scan')
  })

  it('omits the phase section when there are none, rather than printing an empty heading', () => {
    expect(packReadme('h', 'H', 'd', [], 'bootstrap')).not.toContain('## How it works')
  })
})

describe('launchers', () => {
  it('prefers a bundled runtime, then a cached one, then an install, then bootstrap', () => {
    const sh = packLauncherSh('bootstrap')
    const bundledAt = sh.indexOf('./runtime/lib/bin.js')
    const cachedAt = sh.indexOf('./runtime/apps/cli/lib/bin.js')
    const installAt = sh.indexOf('node_modules/saleem-harness-cli')
    const cloneAt = sh.indexOf('git clone')
    // The expensive step must be last, or every run pays for the first run again.
    expect(bundledAt).toBeGreaterThan(0)
    expect(cachedAt).toBeGreaterThan(bundledAt)
    expect(installAt).toBeGreaterThan(cachedAt)
    expect(cloneAt).toBeGreaterThan(installAt)
  })

  it('names every missing tool instead of dying on the first one', () => {
    for (const script of [packLauncherSh('bootstrap'), packLauncherCmd('bootstrap')]) {
      for (const tool of ['git', 'node', 'pnpm']) expect(script).toContain(tool)
    }
  })

  it('still bootstraps from a bundled pack, so a platform mismatch is recoverable', () => {
    // A bundled pack unzipped on the wrong OS has an unusable runtime/. Falling
    // through to the build is what keeps that a slow start rather than a dead end.
    expect(packLauncherSh('bundled')).toContain('git clone')
    expect(packLauncherCmd('bundled')).toContain('git clone')
  })

  it('points the bootstrap at the published repository', () => {
    expect(packLauncherSh('bootstrap')).toContain(HARNESS_RUNTIME_REPO)
  })
})
