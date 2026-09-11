/**
 * Standalone one-shot CLI: materialize the windows-acl workspace-root write
 * grant in a separate OS process, off the harness host's own event loop.
 *
 * `AclWriteGrant.add()`'s FIRST application to a workspace root re-propagates
 * its inheritable Allow ACE across the WHOLE EXISTING tree (see the
 * `grantWrite` doc in acl.ts) — minutes on a large workspace. sandbox-local's
 * `confine()` needs that grant in place before it can spawn a
 * workspace-write command, so materializing it inline (as
 * `materializeAclGrant` does on the first `confine()` call for a workspace)
 * blocks the WHOLE host process's event loop for that whole propagation —
 * every session, every UI update, everything — not just the one shell call.
 *
 * This CLI lets `sandbox-local` kick the SAME grant off early, in the
 * background, well before a shell command actually needs it (as soon as a
 * workspace-write session's root is known). By the time `confine()` runs
 * `materializeAclGrant` for real, `grantWrite`'s own exact-ACE idempotency
 * check (`acl.ts` `hasExactGrant`) usually finds the ACE already standing and
 * skips the expensive apply — the user's first shell command lands fast, and
 * the host stayed responsive the whole time regardless. The per-path
 * `LockFileEx` lock (`acl.ts` `withPathLock`) makes this safe to race against
 * a real `confine()` call landing first: whichever process gets there first
 * does the propagation, the other just waits on the same lock and then finds
 * the exact-ACE fast path — never redundant work, never a torn ACL.
 *
 * Argv contract: `[node, grant-cli.js, '--sid', <S-1-4-…>, '--path', <dir>]`.
 * Exits 0 on success; on any failure prints `windows-acl-grant: <detail>` to
 * stderr and exits 1. This is a best-effort warm — its caller never treats a
 * failure here as fatal, because the real `confine()` call still performs
 * the same grant inline and surfaces any genuine failure through its own
 * (already-handled) path.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/grant-cli
 */

import { existsSync, statSync } from 'node:fs'
import { AclWriteGrant } from './grant.ts'

const SIGNATURE = 'windows-acl-grant'

class GrantCliFailure extends Error {}

/** Print the failure signature line and unwind. */
function fail(detail: string): never {
  process.stderr.write(`${SIGNATURE}: ${detail}\n`)
  throw new GrantCliFailure(detail)
}

interface ParsedArgs {
  sid: string
  path: string
}

function parseArgs(raw: string[]): ParsedArgs {
  let sid: string | undefined
  let path: string | undefined
  for (let index = 0; index < raw.length; index += 2) {
    const token = raw[index]
    const value = raw[index + 1]
    if (value === undefined) fail(`missing value after ${String(token)}`)
    switch (token) {
      case '--sid': sid = value; break
      case '--path': path = value; break
      default: fail(`unknown argument: ${String(token)}`)
    }
  }
  if (sid === undefined) fail('missing --sid')
  if (path === undefined) fail('missing --path')
  return { sid, path }
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2))
  if (!existsSync(parsed.path) || !statSync(parsed.path).isDirectory()) {
    fail(`--path is not an existing directory: ${parsed.path}`)
  }
  // `standing: true` — this mirrors materializeAclGrant's own workspace-root
  // grant exactly (the cross-session reuse cache; never revoked). The SID
  // pointer this allocates is never explicitly freed: the process exits
  // immediately after, and the OS reclaims it — the same one-shot shape as
  // every other short-lived call in this package.
  AclWriteGrant.create(parsed.sid).add(parsed.path, true)
}

try {
  main()
  process.exitCode = 0
} catch (error) {
  if (!(error instanceof GrantCliFailure)) {
    process.stderr.write(`${SIGNATURE}: ${error instanceof Error ? error.message : String(error)}\n`)
  }
  process.exitCode = 1
}
