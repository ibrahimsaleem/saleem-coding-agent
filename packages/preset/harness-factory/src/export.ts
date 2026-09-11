/**
 * Packs one generated harness into a standalone, runnable folder delivered as
 * a ZIP.
 *
 * The archive is laid out as a DSH home plus a launcher:
 *
 * ```
 * <id>/.dsh/.agent-presets/<id>/   the preset directory, verbatim
 * <id>/.dsh/settings.yaml          default preset + sandbox mode
 * <id>/run.cmd, <id>/run.sh        set DSH_HOME, find a runtime, launch
 * <id>/README.md                   what it is, how to run it, what it needs
 * <id>/runtime/                    (bundled mode only) the harness runtime
 * ```
 *
 * The preset directory is safe to relocate because `agentPresets.copy()`
 * dereferences symlinks and every template resolves its bundled skills through
 * `new URL('skills/', baseUrl)` — the preset's own directory — rather than an
 * absolute path. A harness unzipped on another machine finds its own skills.
 *
 * ## The two modes, and why both exist
 *
 * The runtime is a 60-package monorepo with native modules, so "put the whole
 * thing in the zip" and "keep the zip small" cannot both be true:
 *
 *  - **bootstrap** (small): the launcher clones and builds the runtime on first
 *    run and caches it beside the harness. Portable across platforms, because
 *    native modules are built on the target machine. Needs git, node and pnpm,
 *    and the first run takes minutes.
 *  - **bundled** (self-contained): a prebuilt runtime tree ships inside the
 *    archive. First run is instant and needs only node — but the archive is
 *    hundreds of megabytes and its native modules are built for ONE platform,
 *    so a Windows-built bundle does not run on macOS. The launcher detects that
 *    mismatch and falls back to bootstrapping rather than failing cryptically.
 *
 * Neither is strictly better, which is why the export offers both and the
 * README of each says plainly what it needs.
 * @module @ibrahimsaleem/dsh-harness-factory/export
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, posix, relative, sep } from 'node:path'
import { zipSync } from 'fflate'

/** The repository a bootstrapping launcher clones its runtime from. */
export const HARNESS_RUNTIME_REPO = 'https://github.com/ibrahimsaleem/metaharnessfactory.git'

/** How a packed harness obtains the code that runs it. */
export type HarnessPackMode = 'bootstrap' | 'bundled'

/** One packed archive, ready to hand to a browser. */
export interface HarnessPack {
  /** Suggested download filename. */
  readonly filename: string
  /** The ZIP bytes. */
  readonly bytes: Uint8Array
  /** Which runtime strategy the archive carries. */
  readonly mode: HarnessPackMode
}

/** Directories never worth copying into a runtime bundle. */
const RUNTIME_SKIP = new Set(['.git', '.github', 'tests', 'test', '__tests__', '.turbo', '.vitest'])

/**
 * Recursively collect every file under `dir` as `[relativePosixPath, bytes]`.
 * @param dir - directory to walk.
 * @param base - root the returned paths are relative to.
 * @param skip - directory names to prune (used to keep runtime bundles lean).
 */
async function collectFiles(dir: string, base = dir, skip?: ReadonlySet<string>): Promise<[string, Uint8Array][]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: [string, Uint8Array][] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (skip?.has(entry.name) === true) continue
      files.push(...await collectFiles(full, base, skip))
    } else if (entry.isFile()) {
      const rel = relative(base, full).split(sep).join(posix.sep)
      files.push([rel, new Uint8Array(await readFile(full))])
    }
    // Symlinks are skipped deliberately: a ZIP entry cannot carry one portably,
    // and a pnpm runtime tree is full of them pointing into a store that will
    // not exist on the target machine. `collectRuntime` resolves what matters
    // by reading through them as files when they point at files.
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

/** The `package.json` that identifies the unzipped folder. */
export function packManifest(id: string, description: string): string {
  return `${JSON.stringify({
    name: id,
    private: true,
    type: 'module',
    description,
    scripts: {
      start: 'node ./runtime/lib/bin.js web',
    },
  }, null, 2)}\n`
}

/**
 * The POSIX launcher.
 *
 * Resolution order is: a runtime bundled in the archive, then one built by a
 * previous bootstrap, then an installed CLI beside the harness or on PATH, and
 * only then a bootstrap. Each step is cheap to check and the expensive one is
 * last, so a second run never pays for the first run's work twice.
 */
export function packLauncherSh(mode: HarnessPackMode): string {
  return [
    '#!/usr/bin/env bash',
    '# Launch this harness. DSH_HOME points at the bundled .dsh so the harness',
    '# finds this preset and its skills without touching your own config.',
    'set -euo pipefail',
    'cd "$(dirname "$0")"',
    'export DSH_HOME="$PWD/.dsh"',
    '',
    'run_it() { exec node "$1" web; }',
    '',
    '# 1. A runtime shipped in this archive, or built by an earlier bootstrap.',
    'if [ -f "./runtime/lib/bin.js" ]; then run_it "./runtime/lib/bin.js"; fi',
    'if [ -f "./runtime/apps/cli/lib/bin.js" ]; then run_it "./runtime/apps/cli/lib/bin.js"; fi',
    '',
    '# 2. An installation the user already has.',
    'if [ -f "./node_modules/saleem-harness-cli/lib/bin.js" ]; then run_it "./node_modules/saleem-harness-cli/lib/bin.js"; fi',
    'if command -v saleem >/dev/null 2>&1; then exec saleem web; fi',
    '',
    ...mode === 'bundled'
      ? [
        '# This archive shipped a runtime, so reaching here means it was removed or',
        '# its native modules do not match this machine. Bootstrapping rebuilds them.',
        'echo "The bundled runtime is missing or unusable on this platform; building one instead."',
        '',
      ]
      : [],
    '# 3. Build one. Slow the first time, instant afterwards.',
    'missing=""',
    'for tool in git node pnpm; do',
    '  command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"',
    'done',
    'if [ -n "$missing" ]; then',
    '  echo "This harness needs a runtime, and cannot build one because these are missing:$missing"',
    '  echo',
    '  echo "Install them, then run this script again. Node 22+ is required;"',
    '  echo "pnpm can be installed with:  npm install -g pnpm"',
    '  exit 1',
    'fi',
    '',
    'echo "First run: fetching and building the harness runtime. This takes a few minutes."',
    'echo "It is cached in ./runtime, so later runs start immediately."',
    `git clone --depth 1 ${HARNESS_RUNTIME_REPO} runtime`,
    'cd runtime',
    'pnpm install --frozen-lockfile',
    'pnpm run build',
    'cd ..',
    'run_it "./runtime/apps/cli/lib/bin.js"',
    '',
  ].join('\n')
}

/** The Windows launcher; same resolution order as the POSIX one. */
export function packLauncherCmd(mode: HarnessPackMode): string {
  return [
    '@echo off',
    'setlocal',
    'REM Launch this harness. DSH_HOME points at the bundled .dsh so the harness',
    'REM finds this preset and its skills without touching your own config.',
    'cd /d "%~dp0"',
    'set "DSH_HOME=%CD%\\.dsh"',
    '',
    'REM 1. A runtime shipped in this archive, or built by an earlier bootstrap.',
    'if exist ".\\runtime\\lib\\bin.js" ( node ".\\runtime\\lib\\bin.js" web & exit /b %ERRORLEVEL% )',
    'if exist ".\\runtime\\apps\\cli\\lib\\bin.js" ( node ".\\runtime\\apps\\cli\\lib\\bin.js" web & exit /b %ERRORLEVEL% )',
    '',
    'REM 2. An installation the user already has.',
    'if exist ".\\node_modules\\saleem-harness-cli\\lib\\bin.js" ( node ".\\node_modules\\saleem-harness-cli\\lib\\bin.js" web & exit /b %ERRORLEVEL% )',
    'where saleem >nul 2>nul && ( saleem web & exit /b %ERRORLEVEL% )',
    '',
    ...mode === 'bundled'
      ? ['echo The bundled runtime is missing or unusable on this platform; building one instead.', '']
      : [],
    'REM 3. Build one. Slow the first time, instant afterwards.',
    'set "MISSING="',
    'where git  >nul 2>nul || set "MISSING=%MISSING% git"',
    'where node >nul 2>nul || set "MISSING=%MISSING% node"',
    'where pnpm >nul 2>nul || set "MISSING=%MISSING% pnpm"',
    'if not "%MISSING%"=="" (',
    '  echo This harness needs a runtime, and cannot build one because these are missing:%MISSING%',
    '  echo.',
    '  echo Install them, then run this script again. Node 22+ is required;',
    '  echo pnpm can be installed with:  npm install -g pnpm',
    '  exit /b 1',
    ')',
    '',
    'echo First run: fetching and building the harness runtime. This takes a few minutes.',
    'echo It is cached in .\\runtime, so later runs start immediately.',
    `git clone --depth 1 ${HARNESS_RUNTIME_REPO} runtime || exit /b 1`,
    'pushd runtime',
    'call pnpm install --frozen-lockfile || ( popd & exit /b 1 )',
    'call pnpm run build || ( popd & exit /b 1 )',
    'popd',
    'node ".\\runtime\\apps\\cli\\lib\\bin.js" web',
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n')
}

/** The README a user reads first. It states exactly what this archive needs. */
export function packReadme(
  id: string,
  name: string,
  description: string,
  phases: readonly string[],
  mode: HarnessPackMode,
  platform?: string,
): string {
  return [
    `# ${name}`,
    '',
    description,
    '',
    '## What this is',
    '',
    'A packaged agent harness: a specialized AI agent with its own system prompt, its own',
    'methodology playbook, and a fixed set of capabilities. Its definition lives in',
    `\`.dsh/.agent-presets/${id}/\`.`,
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
    'own preset and skills and does not touch any existing configuration on the machine.',
    '',
    '## What you need',
    '',
    ...mode === 'bundled'
      ? [
        '**The runtime is included** in `./runtime`, so you only need **Node 22+**. The first run',
        'starts immediately.',
        '',
        ...platform === undefined
          ? []
          : [
            `That runtime was built for **${platform}**. Its native modules are platform-specific,`,
            'so on a different OS or CPU the launcher ignores it and builds a fresh one instead —',
            'which needs `git` and `pnpm` as well, and takes a few minutes once.',
            '',
          ],
      ]
      : [
        'The runtime is **not** in this archive — it is a large monorepo with native modules, and',
        'shipping it would tie the download to one platform. Instead the first run fetches and',
        'builds it into `./runtime`, then caches it there so later runs start immediately.',
        '',
        'For that first run you need **Node 22+**, **git**, and **pnpm**',
        '(`npm install -g pnpm`). The launcher checks for all three and names any that are missing.',
        'If you already have the harness CLI installed, the launcher finds it and skips this step.',
        '',
      ],
    'You also need a model configured. On first launch, open Settings and add an API key, or set',
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
 * Collect a prebuilt runtime tree for a bundled pack.
 * @param runtimeDir - the deployed runtime root.
 * @returns archive entries under `runtime/`.
 */
async function collectRuntime(runtimeDir: string): Promise<[string, Uint8Array][]> {
  const info = await stat(runtimeDir)
  if (!info.isDirectory()) throw new Error(`harness-factory: runtime path is not a directory: ${runtimeDir}`)
  return collectFiles(runtimeDir, runtimeDir, RUNTIME_SKIP)
}

/**
 * Pack one preset directory into a standalone-app ZIP.
 * @param presetDir - the preset's directory on disk.
 * @param options - harness identity, README phases, runtime mode and source.
 * @returns the archive filename, bytes and mode.
 */
export async function packHarness(
  presetDir: string,
  options: {
    id: string
    name: string
    description: string
    phases?: readonly string[]
    /** Runtime strategy; defaults to the small, portable one. */
    mode?: HarnessPackMode
    /** Prebuilt runtime root, required for `bundled`. */
    runtimeDir?: string
    /** Platform label recorded in the README of a bundled pack. */
    runtimePlatform?: string
  },
): Promise<HarnessPack> {
  const { id, name, description, phases = [], mode = 'bootstrap', runtimeDir, runtimePlatform } = options
  const files: Record<string, Uint8Array> = {}
  const encoder = new TextEncoder()
  const put = (path: string, content: string | Uint8Array): void => {
    files[`${id}/${path}`] = typeof content === 'string' ? encoder.encode(content) : content
  }

  for (const [rel, bytes] of await collectFiles(presetDir)) put(`.dsh/.agent-presets/${id}/${rel}`, bytes)
  put('.dsh/settings.yaml', packSettings(id))
  put('package.json', packManifest(id, description))
  put('run.sh', packLauncherSh(mode))
  put('run.cmd', packLauncherCmd(mode))
  put('README.md', packReadme(id, name, description, phases, mode, runtimePlatform))

  if (mode === 'bundled') {
    if (runtimeDir === undefined) {
      throw new Error('harness-factory: a bundled pack needs a prebuilt runtime directory')
    }
    for (const [rel, bytes] of await collectRuntime(runtimeDir)) put(`runtime/${rel}`, bytes)
  }

  return {
    filename: `${id}-harness${mode === 'bundled' ? '-standalone' : ''}.zip`,
    // Level 6 on a 200MB+ runtime is the difference between a slow download and
    // a slow pack; the runtime is mostly already-compressed JS either way.
    bytes: zipSync(files, { level: mode === 'bundled' ? 4 : 6 }),
    mode,
  }
}
