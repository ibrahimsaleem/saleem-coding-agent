/**
 * Build the self-contained runtime bundle that a "standalone" harness export
 * ships inside its archive.
 *
 * ## Why this is a script and not something the export does on demand
 *
 * A `pnpm deploy` of the CLI takes minutes and needs a package manager. Neither
 * belongs inside an HTTP request, so the bundle is built once, here, and the
 * factory reads it from `.dsh-runtime/`.
 *
 * ## Why it repairs the deploy afterwards
 *
 * `pnpm deploy --prod` installs `dependencies` and drops `devDependencies`.
 * This repo's convention pairs every workspace relationship as
 * peerDependency + devDependency, so a peer that nothing else pulls in
 * transitively — `@deepseek-ai/cordis-plugin-group` is the live example —
 * simply is not there, and the deployed CLI dies at its first import.
 *
 * Fixing that by promoting packages to `dependencies` would change a
 * repository-wide dependency policy that a gate enforces, for the benefit of
 * one packaging path. So this script repairs the tree instead: it boots the
 * deployed CLI, reads the module it could not find, copies that package in from
 * `vendor/` or the workspace, and repeats. Packaging glue stays in the
 * packaging script.
 *
 * ## Why it ends by running the thing
 *
 * The whole point of the bundle is that it works on a machine that has nothing
 * else. A bundle that was never executed is a guess, so the last step boots it
 * and fails the build if it does not start. A standalone export can then never
 * ship a runtime this script has not actually run.
 *
 * Usage: `pnpm run build:runtime-bundle`
 * @module scripts/build-runtime-bundle
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Where the factory looks for the bundle. */
const OUT_DIR = '.dsh-runtime'
/** The workspace package whose deployment is the runtime. */
const CLI_PACKAGE = 'saleem-harness-cli'
/** Bound on the repair loop, so a genuinely broken tree fails instead of spinning. */
const MAX_REPAIRS = 40
/** Port the boot probe binds; any free port works, it is never connected to. */
const PROBE_PORT = 39_517

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, OUT_DIR)

/** Run a command, inheriting stdio, and fail the script on a non-zero exit. */
function run(command: string, args: readonly string[], cwd = root): void {
  const result = spawnSync(command, [...args], { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) {
    throw new Error(`build-runtime-bundle: ${command} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
  }
}

/** Fail the build if the tree still holds symlinks a ZIP would silently drop. */
function assertNoSymlinks(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error(
        `build-runtime-bundle: ${join(dir, entry.name)} is a symlink. A ZIP cannot carry one, so the `
        + 'packed runtime would be missing it. The hoisted node-linker should have prevented this.',
      )
    }
    if (entry.isDirectory()) assertNoSymlinks(join(dir, entry.name))
  }
}

/**
 * Boot the deployed CLI the way a user will — `web`, with its own DSH_HOME —
 * and return the module it could not resolve, if any.
 *
 * This deliberately does NOT use `--help`. `--help` returns before the plugin
 * tree loads, so it proves only that `bin.js` is reachable; the first bundle
 * passed that check and then died on its first real boot with half the plugin
 * graph missing. Booting the actual profile is the only check that means
 * anything.
 */
function bootProblem(): string | undefined {
  const home = mkdtempSync(join(tmpdir(), 'dsh-bundle-probe-'))
  try {
    const result = spawnSync(
      process.execPath,
      [join(out, 'lib', 'bin.js'), 'web', '--no-open', '--port', String(PROBE_PORT)],
      { cwd: out, encoding: 'utf8', timeout: 180_000, env: { ...process.env, DSH_HOME: home } },
    )
    const output = `${result.stdout}${result.stderr}`
    // A successful boot binds the port and never returns, so the timeout IS the
    // success signal here; a failed boot exits on its own with a stack.
    if (result.error !== undefined && 'code' in result.error && result.error.code === 'ETIMEDOUT') return undefined
    if (/saleem web: http/u.test(output)) return undefined

    const missing = /Cannot find package '([^']+)'/u.exec(output)?.[1]
    if (missing !== undefined) return missing
    // A missing build chunk names an absolute path inside a deployed package;
    // the owning package is the `node_modules/<name>` segment of that path.
    const chunk = /Cannot find module '([^']*node_modules[^']+)'/u.exec(output)?.[1]
    const owner = chunk === undefined
      ? undefined
      : /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/u.exec(chunk)?.[1]?.replaceAll('\\', '/')
    if (owner !== undefined) return owner
    throw new Error(
      'build-runtime-bundle: the deployed runtime failed to start for a reason this script cannot repair:\n'
      + output.slice(0, 4000),
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

/**
 * Locate a workspace or vendored package's directory by its package name.
 *
 * Generic on purpose: the set of peers a `--prod` deploy drops is not a fixed
 * list, and hard-coding one means the next missing package is a cryptic
 * failure instead of an automatic repair.
 */
function sourceOf(packageName: string): string | undefined {
  for (const pattern of ['vendor/*', 'packages/*/*']) {
    for (const dir of globSync(pattern, { cwd: root })) {
      const full = join(root, dir)
      const manifest = join(full, 'package.json')
      if (!existsSync(manifest)) continue
      try {
        const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
        const name = typeof parsed === 'object' && parsed !== null ? (parsed as { name?: unknown }).name : undefined
        if (name === packageName) return full
      } catch {
        // A malformed manifest in the tree is not this script's problem to report.
      }
    }
  }
  return undefined
}

/** Copy one package into the bundle's node_modules, built output included. */
function installInto(packageName: string, from: string): void {
  const target = join(out, 'node_modules', ...packageName.split('/'))
  // Replace rather than merge: a partially-deployed package (one whose `files`
  // list omitted a hashed build chunk) must end up with the complete `lib/`.
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  // `dereference` matters: a pnpm tree is symlinks into a store that will not
  // exist on the target machine, and a ZIP cannot carry a symlink portably.
  cpSync(from, target, {
    recursive: true,
    dereference: true,
    filter: source => !source.includes('node_modules') && !source.includes('.git'),
  })
}

function main(): void {
  console.log(`build-runtime-bundle: deploying ${CLI_PACKAGE} into ${OUT_DIR}/`)
  rmSync(out, { recursive: true, force: true })
  // `node-linker=hoisted` is load-bearing, not a tuning knob. pnpm's default
  // tree is a symlink farm pointing into `.pnpm`, and a ZIP entry cannot carry
  // a symlink — so a default-linked bundle unzips with every top-level package
  // missing and dies on its first import. Hoisted produces a flat, real-file
  // tree that survives the round trip. (Verified the hard way: the first
  // bundle unzipped and failed with "Cannot find package
  // '@deepseek-ai/dsh-app-boot'".)
  run('pnpm', [
    'deploy', '--filter', CLI_PACKAGE, '--prod', '--legacy',
    '--config.node-linker=hoisted',
    out,
  ])

  console.log('build-runtime-bundle: repairing peer dependencies the prod deploy dropped')
  const repaired: string[] = []
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const missing = bootProblem()
    if (missing === undefined) {
      console.log(`build-runtime-bundle: runtime starts cleanly${repaired.length > 0 ? ` after adding ${repaired.join(', ')}` : ''}`)
      // The boot above proves the tree runs HERE. This proves it will still run
      // after a round trip through a ZIP, which is the only way anyone receives it.
      console.log('build-runtime-bundle: checking the tree survives archiving')
      assertNoSymlinks(out)
      console.log(`build-runtime-bundle: bundle ready at ${out}`)
      return
    }
    if (repaired.includes(missing)) {
      throw new Error(`build-runtime-bundle: copied ${missing} but it is still unresolved; the bundle cannot be repaired automatically`)
    }
    const from = sourceOf(missing)
    if (from === undefined) {
      throw new Error(
        `build-runtime-bundle: the runtime needs "${missing}", which is not a vendored package this script knows how to copy. `
        + 'Add it to sourceOf(), or declare it as a real dependency of the package that imports it.',
      )
    }
    console.log(`  + ${missing}`)
    installInto(missing, from)
    repaired.push(missing)
  }
  throw new Error(`build-runtime-bundle: still unresolved after ${String(MAX_REPAIRS)} repairs`)
}

main()
