/**
 * Packs one generated harness into a standalone, runnable folder delivered as
 * a ZIP.
 *
 * The archive is laid out as a DSH home plus a launcher:
 *
 * ```
 * <id>/.dsh/.agent-presets/<id>/   the preset directory, verbatim
 * <id>/.dsh/settings.yaml          default preset + sandbox mode
 * <id>/run.cmd, <id>/run.sh        set DSH_HOME and boot the web profile
 * <id>/package.json                names the harness CLI this needs
 * <id>/README.md                   what it is, how to run it, what it needs
 * ```
 *
 * The preset directory is safe to relocate because `agentPresets.copy()`
 * dereferences symlinks and every template resolves its bundled skills through
 * `new URL('skills/', baseUrl)` — the preset's own directory — rather than an
 * absolute path. A harness unzipped on another machine finds its own skills.
 *
 * What the archive does NOT contain is the harness runtime itself. The
 * launcher locates an installed CLI; `README.md` says so plainly rather than
 * implying the zip is self-sufficient. See the README text below for the exact
 * wording the user reads.
 * @module @ibrahimsaleem/dsh-harness-factory/export
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, posix, relative, sep } from 'node:path'
import { zipSync } from 'fflate'

/** The CLI package a packed harness expects to find or install. */
export const HARNESS_CLI_PACKAGE = 'saleem-harness-cli'

/** One packed archive, ready to hand to a browser. */
export interface HarnessPack {
  /** Suggested download filename. */
  readonly filename: string
  /** The ZIP bytes. */
  readonly bytes: Uint8Array
}

/** Recursively collect every file under `dir` as `[relativePosixPath, bytes]`. */
async function collectFiles(dir: string, base = dir): Promise<[string, Uint8Array][]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: [string, Uint8Array][] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(full, base))
    } else if (entry.isFile()) {
      const rel = relative(base, full).split(sep).join(posix.sep)
      files.push([rel, new Uint8Array(await readFile(full))])
    }
  }
  return files
}

/** The settings file that makes the unzipped harness open on its own preset. */
export function packSettings(id: string): string {
  return [
    '# Settings for this packed harness.',
    '#',
    '# `agent-presets.default` is what makes a new session open on this harness',
    '# rather than the deployment default.',
    'agent-presets:',
    `  default: ${id}`,
    '',
    '# Confine file writes to the workspace. Widen deliberately, not by default.',
    'sandbox-policy:',
    '  mode: workspace-write',
    '',
  ].join('\n')
}

/** The `package.json` that names what this harness needs to run. */
export function packManifest(id: string, description: string): string {
  return `${JSON.stringify({
    name: id,
    private: true,
    type: 'module',
    description,
    scripts: {
      start: 'node ./node_modules/saleem-harness-cli/lib/bin.js web',
    },
    dependencies: {
      [HARNESS_CLI_PACKAGE]: '*',
    },
  }, null, 2)}\n`
}

/**
 * The POSIX launcher. It prefers a CLI already installed beside the harness,
 * then one on PATH, and otherwise explains what to do — rather than failing
 * with a bare "command not found".
 */
export function packLauncherSh(): string {
  return [
    '#!/usr/bin/env bash',
    '# Launch this harness. DSH_HOME points at the bundled .dsh so the harness',
    '# finds this preset and its skills without touching your own config.',
    'set -euo pipefail',
    'cd "$(dirname "$0")"',
    'export DSH_HOME="$PWD/.dsh"',
    '',
    'if [ -f "./node_modules/saleem-harness-cli/lib/bin.js" ]; then',
    '  exec node "./node_modules/saleem-harness-cli/lib/bin.js" web',
    'elif command -v saleem >/dev/null 2>&1; then',
    '  exec saleem web',
    'else',
    '  echo "The Saleem Harness CLI was not found."',
    '  echo',
    '  echo "This folder carries the harness definition, not the runtime. Either:"',
    '  echo "  1. run \'npm install\' here, if the CLI is published to your registry, or"',
    '  echo "  2. install the CLI, then run:  DSH_HOME=\\"$PWD/.dsh\\" saleem web"',
    '  exit 1',
    'fi',
    '',
  ].join('\n')
}

/** The Windows launcher; same resolution order as the POSIX one. */
export function packLauncherCmd(): string {
  return [
    '@echo off',
    'REM Launch this harness. DSH_HOME points at the bundled .dsh so the harness',
    'REM finds this preset and its skills without touching your own config.',
    'cd /d "%~dp0"',
    'set "DSH_HOME=%CD%\\.dsh"',
    '',
    'if exist ".\\node_modules\\saleem-harness-cli\\lib\\bin.js" (',
    '  node ".\\node_modules\\saleem-harness-cli\\lib\\bin.js" web',
    '  exit /b %ERRORLEVEL%',
    ')',
    'where saleem >nul 2>nul',
    'if %ERRORLEVEL%==0 (',
    '  saleem web',
    '  exit /b %ERRORLEVEL%',
    ')',
    'echo The Saleem Harness CLI was not found.',
    'echo.',
    'echo This folder carries the harness definition, not the runtime. Either:',
    'echo   1. run "npm install" here, if the CLI is published to your registry, or',
    'echo   2. install the CLI, then run:  set DSH_HOME=%CD%\\.dsh ^&^& saleem web',
    'exit /b 1',
    '',
  ].join('\r\n')
}

/** The README a user reads first. It is explicit about what the zip does not contain. */
export function packReadme(id: string, name: string, description: string, phases: readonly string[]): string {
  return [
    `# ${name}`,
    '',
    description,
    '',
    '## What this is',
    '',
    'A packaged agent harness: a specialized AI agent with its own system prompt, its own',
    'methodology playbook, and a fixed set of capabilities. It was generated by the Harness',
    'Factory and its definition lives in `.dsh/.agent-presets/' + id + '/`.',
    '',
    ...phases.length > 0
      ? ['## How it works', '', 'It follows these phases:', '', ...phases.map((phase, index) => `${String(index + 1)}. ${phase}`), '']
      : [],
    '## Running it',
    '',
    '```sh',
    './run.sh          # macOS / Linux',
    'run.cmd           # Windows',
    '```',
    '',
    'The launcher sets `DSH_HOME` to the bundled `.dsh` folder, so this harness runs with its',
    'own preset and skills and does not touch your existing configuration.',
    '',
    '## What you need',
    '',
    '**This folder contains the harness definition, not the harness runtime.** You need the',
    'Saleem Harness CLI available, either installed into this folder (`npm install`, if the CLI',
    'is published to a registry you can reach) or installed globally and on your `PATH`. The',
    'launcher checks both and tells you which is missing.',
    '',
    'You also need a model configured. On first run, open Settings and add an API key, or set',
    'one in `.dsh/settings.yaml` before starting.',
    '',
    '## Editing it',
    '',
    'Everything is plain text and meant to be edited:',
    '',
    `- \`.dsh/.agent-presets/${id}/agent.cordis.yml\` — the persona and the capability rows.`,
    `- \`.dsh/.agent-presets/${id}/skills/\` — the methodology playbook the agent loads.`,
    '- `.dsh/settings.yaml` — default preset, sandbox mode, model route.',
    '',
  ].join('\n')
}

/**
 * Pack one preset directory into a standalone-app ZIP.
 * @param presetDir - the preset's directory on disk.
 * @param options - the harness identity and the phase list for the README.
 * @returns the archive filename and bytes.
 */
export async function packHarness(
  presetDir: string,
  options: { id: string; name: string; description: string; phases?: readonly string[] },
): Promise<HarnessPack> {
  const { id, name, description, phases = [] } = options
  const presetFiles = await collectFiles(presetDir)

  const files: Record<string, Uint8Array> = {}
  const encoder = new TextEncoder()
  const put = (path: string, content: string | Uint8Array): void => {
    files[`${id}/${path}`] = typeof content === 'string' ? encoder.encode(content) : content
  }

  for (const [rel, bytes] of presetFiles) put(`.dsh/.agent-presets/${id}/${rel}`, bytes)
  put('.dsh/settings.yaml', packSettings(id))
  put('package.json', packManifest(id, description))
  put('run.sh', packLauncherSh())
  put('run.cmd', packLauncherCmd())
  put('README.md', packReadme(id, name, description, phases))

  return { filename: `${id}-harness.zip`, bytes: zipSync(files, { level: 6 }) }
}
