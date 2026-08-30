/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-harness-monitor`.
 * @module @deepseek-ai/dsh-host-harness-monitor/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-harness-monitor'

/** Cordis companion plugin name. */
export const name = 'host-harness-monitor-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the service is a read-only projection of on-disk state
 * (session logs, settings, an OS process scan) recomputed on a poll; there is
 * no in-memory authority whose relation to the disk could drift undetected.
 * The guard's one piece of mutable state (armed / armed-at) is process-local
 * and its trigger condition is re-derived from the same disk scan every tick.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
