/**
 * Package-owned invariant companion for `@ibrahimsaleem/dsh-client-ui-harness-factory`.
 * @module @ibrahimsaleem/dsh-client-ui-harness-factory/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@ibrahimsaleem/dsh-client-ui-harness-factory'

/** Cordis companion plugin name. */
export const name = 'client-ui-harness-factory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin registers one sidebar-foot trigger whose
 * disposal the HMR-safety spec proves, and every figure it shows is re-read
 * from the host `monitor.*` RPC on a poll rather than held here.
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
